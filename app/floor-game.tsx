"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gridToScreen, screenToGrid, TILE_HEIGHT, TILE_WIDTH } from "@/client/iso";
import type { Database } from "@/lib/database.types";
import { createSupabaseBrowserClient, getSupabaseBrowserConfigError } from "@/lib/supabase/client";
import CapitalPanel from "./capital-panel";
import ChatPanel from "./chat-panel";
import DuelPanel from "./duel-panel";
import SeasonPanel from "./season-panel";
import TapePanel from "./tape-panel";
import TradingPanel from "./trading-panel";
import {
  FLOOR_ELEMENTS,
  FLOOR_MAP,
  GRID_HEIGHT,
  GRID_WIDTH,
  type Facing,
  type FloorElement,
  isWalkable,
  nearestSpawn,
  tapeSideAt
} from "@/shared/floor-map";

// ── Sprite sheet layout ───────────────────────────────────────
// The sheet is 1280×800 with items arranged in two rows.
// Measurements are approximate pixel crops from the source PNG.
// Row 1 (y≈0..395): desk | ticker-tower | corner-tower
// Row 2 (y≈395..800): candlestick-screen | bull | lamp | up-pad | down-pad | trader
const SPRITE_SRC = "/sprites.png";

type SpriteKey =
  | "desk"
  | "ticker-tower"
  | "corner-tower"
  | "candlestick-screen"
  | "bull"
  | "lamp"
  | "pad-up"
  | "pad-down"
  | "trader";

type SpriteRect = { sx: number; sy: number; sw: number; sh: number };

// Crop rects tuned to the reference sprite sheet (1280×800)
const SPRITES: Record<SpriteKey, SpriteRect> = {
  "desk":               { sx: 0,    sy: 0,   sw: 430, sh: 395 },
  "ticker-tower":       { sx: 430,  sy: 0,   sw: 290, sh: 395 },
  "corner-tower":       { sx: 900,  sy: 0,   sw: 380, sh: 395 },
  "candlestick-screen": { sx: 0,    sy: 395, sw: 280, sh: 405 },
  "bull":               { sx: 290,  sy: 395, sw: 340, sh: 405 },
  "lamp":               { sx: 730,  sy: 395, sw: 240, sh: 405 },
  "pad-up":             { sx: 130,  sy: 640, sw: 210, sh: 160 },
  "pad-down":           { sx: 530,  sy: 640, sw: 210, sh: 160 },
  "trader":             { sx: 980,  sy: 395, sw: 300, sh: 405 },
};

// Render sizes on the iso grid (dest width/height in CSS pixels)
const SPRITE_SIZES: Record<SpriteKey, { dw: number; dh: number; offsetY: number }> = {
  "desk":               { dw: 140, dh: 120, offsetY: -90 },
  "ticker-tower":       { dw: 72,  dh: 140, offsetY: -130 },
  "corner-tower":       { dw: 80,  dh: 150, offsetY: -138 },
  "candlestick-screen": { dw: 90,  dh: 90,  offsetY: -78 },
  "bull":               { dw: 120, dh: 120, offsetY: -108 },
  "lamp":               { dw: 56,  dh: 80,  offsetY: -68 },
  "pad-up":             { dw: 96,  dh: 56,  offsetY: -30 },
  "pad-down":           { dw: 96,  dh: 56,  offsetY: -30 },
  "trader":             { dw: 52,  dh: 90,  offsetY: -80 },
};

type Player = Database["public"]["Tables"]["players"]["Row"];
type Point = { gx: number; gy: number };
type VisualPlayer = Player & {
  from: Point;
  to: Point;
  movedAt: number;
};

const STALE_AFTER_MS = 30_000;
const STEP_MS = 220;
const PATH_STEP_PAUSE_MS = 42;

function pointKey(point: Point) {
  return `${point.gx}:${point.gy}`;
}

function facingForStep(from: Point, to: Point): Facing {
  if (to.gx > from.gx) return "east";
  if (to.gx < from.gx) return "west";
  if (to.gy < from.gy) return "north";
  return "south";
}

function isFresh(player: Player, now: number) {
  return now - new Date(player.last_seen).getTime() <= STALE_AFTER_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function findPath(start: Point, target: Point): Point[] | null {
  if (!isWalkable(target.gx, target.gy)) return null;

  const startKey = pointKey(start);
  const targetKey = pointKey(target);
  const queue: Point[] = [start];
  const cameFrom = new Map<string, string | null>([[startKey, null]]);
  const points = new Map<string, Point>([[startKey, start]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentKey = pointKey(current);

    if (currentKey === targetKey) {
      const path: Point[] = [];
      let key: string | null = currentKey;

      while (key) {
        const point = points.get(key);
        if (point) path.push(point);
        key = cameFrom.get(key) ?? null;
      }

      return path.reverse();
    }

    const neighbors: Point[] = [
      { gx: current.gx + 1, gy: current.gy },
      { gx: current.gx - 1, gy: current.gy },
      { gx: current.gx, gy: current.gy + 1 },
      { gx: current.gx, gy: current.gy - 1 }
    ];

    for (const next of neighbors) {
      const nextKey = pointKey(next);
      if (cameFrom.has(nextKey) || !isWalkable(next.gx, next.gy)) continue;
      cameFrom.set(nextKey, currentKey);
      points.set(nextKey, next);
      queue.push(next);
    }
  }

  return null;
}

function upsertVisual(previous: VisualPlayer | undefined, player: Player): VisualPlayer {
  const oldTo = previous?.to ?? { gx: player.gx, gy: player.gy };
  const nextTo = { gx: player.gx, gy: player.gy };
  const changed = oldTo.gx !== nextTo.gx || oldTo.gy !== nextTo.gy;

  return {
    ...player,
    from: changed ? oldTo : (previous?.from ?? nextTo),
    to: nextTo,
    movedAt: changed ? performance.now() : (previous?.movedAt ?? performance.now())
  };
}

function PlayerEntry({ onJoin }: { onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Pick a name first.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await onJoin(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enter the floor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entry-wrap">
      <section className="entry-panel">
        <h1>The Floor</h1>
        <p>Enter a temporary name for this browser session.</p>
        <form className="entry-form" onSubmit={submit}>
          <input
            autoFocus
            maxLength={32}
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button disabled={submitting} type="submit">
            {submitting ? "Entering..." : "Enter"}
          </button>
          <div className="error" role="status">
            {error}
          </div>
        </form>
      </section>
    </main>
  );
}

function FloorCanvas({
  localPlayer,
  players,
  queuedPath,
  selectedTile,
  onTileClick
}: {
  localPlayer: Player;
  players: Map<string, VisualPlayer>;
  queuedPath: Point[];
  selectedTile: Point | null;
  onTileClick: (target: Point) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef(players);
  const localRef = useRef(localPlayer);
  const clickRef = useRef(onTileClick);
  const hoverRef = useRef<Point | null>(null);
  const pathRef = useRef<Point[]>(queuedPath);
  const selectedRef = useRef<Point | null>(selectedTile);
  const spriteImgRef = useRef<HTMLImageElement | null>(null);

  // Preload sprite sheet once
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = SPRITE_SRC;
    img.onload = () => { spriteImgRef.current = img; };
  }, []);

  useEffect(() => {
    playerRef.current = players;
  }, [players]);

  useEffect(() => {
    localRef.current = localPlayer;
  }, [localPlayer]);

  useEffect(() => {
    clickRef.current = onTileClick;
  }, [onTileClick]);

  useEffect(() => {
    pathRef.current = queuedPath;
  }, [queuedPath]);

  useEffect(() => {
    selectedRef.current = selectedTile;
  }, [selectedTile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = canvas;

    function resize() {
      const rect = surface.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      surface.width = Math.max(1, Math.floor(rect.width * scale));
      surface.height = Math.max(1, Math.floor(rect.height * scale));
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = canvas;

    let frame = 0;
    const context = surface.getContext("2d");
    if (!context) return;
    const ctx = context;

    function drawSprite(key: SpriteKey, cx: number, baseY: number, glowColor?: string) {
      const img = spriteImgRef.current;
      if (!img) return;
      const { sx, sy, sw, sh } = SPRITES[key];
      const { dw, dh, offsetY } = SPRITE_SIZES[key];
      const dx = cx - dw / 2;
      const dy = baseY + offsetY;
      if (glowColor) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 22;
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    }

    function drawDiamond(gx: number, gy: number, fillStyle: string, strokeStyle: string, inset = 0) {
      const point = gridToScreen(gx, gy);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y + inset);
      ctx.lineTo(point.x + TILE_WIDTH / 2 - inset, point.y + TILE_HEIGHT / 2);
      ctx.lineTo(point.x, point.y + TILE_HEIGHT - inset);
      ctx.lineTo(point.x - TILE_WIDTH / 2 + inset, point.y + TILE_HEIGHT / 2);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function drawTile(gx: number, gy: number, blocked: boolean, now: number) {
      const pulse = Math.sin(now / 650 + gx * 0.45 + gy * 0.3);
      const plaza = gx >= 8 && gx <= 15 && gy >= 6 && gy <= 12;
      const deskLane = (gx <= 5 && gy >= 5 && gy <= 13) || (gx >= 18 && gy >= 4 && gy <= 12);
      const marketLane = gy >= 15 && gy <= 18 && gx >= 4 && gx <= 19;
      const edge = gx === 0 || gy === 0 || gx === GRID_WIDTH - 1 || gy === GRID_HEIGHT - 1;
      const tapeSide = tapeSideAt(gx, gy);

      // Palette: navy floor with neon/amber/danger tones
      const fill = tapeSide === "up"
        ? `rgba(0,${60 + Math.round(pulse * 10)},35,0.9)`
        : tapeSide === "down"
          ? `rgba(${80 + Math.round(pulse * 8)},10,30,0.9)`
            : blocked
              ? "#0d1520"
              : plaza
                ? "#122130"
                : deskLane
                  ? "#0e1b23"
                  : marketLane
                    ? "#111a2a"
                    : edge
                      ? "#07131b"
                      : "#0a1621";
      const stroke = tapeSide === "up"
        ? `rgba(0,255,157,${0.55 + pulse * 0.18})`
        : tapeSide === "down"
          ? `rgba(255,77,109,${0.55 + pulse * 0.18})`
          : blocked
            ? "#0a1018"
            : plaza
              ? "rgba(255,194,71,0.18)"
              : deskLane
                ? "rgba(0,255,157,0.13)"
                : marketLane
                  ? "rgba(116,226,255,0.12)"
              : "rgba(255,255,255,0.08)";

      drawDiamond(gx, gy, fill, stroke);

      // reflective sheen on walkable tiles
      if (!blocked) {
        const point = gridToScreen(gx, gy);
        const sheen = ctx.createLinearGradient(point.x - TILE_WIDTH / 2, point.y, point.x + TILE_WIDTH / 2, point.y + TILE_HEIGHT);
        sheen.addColorStop(0, "rgba(255,255,255,0.04)");
        sheen.addColorStop(0.5, "rgba(255,255,255,0.01)");
        sheen.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + TILE_WIDTH / 2, point.y + TILE_HEIGHT / 2);
        ctx.lineTo(point.x, point.y + TILE_HEIGHT);
        ctx.lineTo(point.x - TILE_WIDTH / 2, point.y + TILE_HEIGHT / 2);
        ctx.closePath();
        ctx.fillStyle = sheen;
        ctx.fill();
        ctx.restore();
      }

      if (tapeSide && !blocked) {
        const point = gridToScreen(gx, gy);
        // Neon glow under pad
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const padColor = tapeSide === "up" ? "rgba(0,255,157,0.22)" : "rgba(255,77,109,0.22)";
        ctx.fillStyle = padColor;
        ctx.beginPath();
        ctx.ellipse(point.x, point.y + TILE_HEIGHT / 2, 38, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        // Pad sprite centered on tile
        const padKey: SpriteKey = tapeSide === "up" ? "pad-up" : "pad-down";
        drawSprite(padKey, point.x, point.y + TILE_HEIGHT / 2 - 4, tapeSide === "up" ? "#00ff9d" : "#ff4d6d");
        ctx.restore();
      }

      if (plaza && !blocked) {
        const point = gridToScreen(gx, gy);
        ctx.beginPath();
        ctx.moveTo(point.x - TILE_WIDTH / 2 + 8, point.y + TILE_HEIGHT / 2);
        ctx.lineTo(point.x, point.y + TILE_HEIGHT - 8);
        ctx.lineTo(point.x + TILE_WIDTH / 2 - 8, point.y + TILE_HEIGHT / 2);
        ctx.strokeStyle = `rgba(255,194,71,${0.1 + pulse * 0.04})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if ((deskLane || marketLane) && !blocked && !tapeSide) {
        const point = gridToScreen(gx, gy);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = deskLane ? "rgba(0,255,157,0.16)" : "rgba(101,234,255,0.13)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x - TILE_WIDTH / 2 + 10, point.y + TILE_HEIGHT / 2);
        ctx.lineTo(point.x + TILE_WIDTH / 2 - 10, point.y + TILE_HEIGHT / 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function drawTileOverlay(point: Point, fillStyle: string, strokeStyle: string) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      drawDiamond(point.gx, point.gy, fillStyle, strokeStyle, 5);
      ctx.restore();
    }

    function drawMarketScreen(x: number, y: number, width: number, height: number, label: string, color: string, now: number) {
      ctx.save();
      ctx.fillStyle = "rgba(3, 9, 15, 0.82)";
      ctx.strokeStyle = "rgba(0, 255, 157, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 4);
      ctx.fill();
      ctx.stroke();

      const glass = ctx.createLinearGradient(x, y, x + width, y + height);
      glass.addColorStop(0, "rgba(0,255,157,0.12)");
      glass.addColorStop(0.48, "rgba(255,194,71,0.04)");
      glass.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glass;
      ctx.fillRect(x + 1, y + 1, width - 2, height - 2);

      ctx.fillStyle = color;
      ctx.font = "800 8px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, x + 8, y + 7);

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        const lineY = y + 22 + i * ((height - 32) / 4);
        ctx.beginPath();
        ctx.moveTo(x + 8, lineY);
        ctx.lineTo(x + width - 8, lineY);
        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 20; i += 1) {
        const px = x + 10 + i * ((width - 20) / 19);
        const wave = Math.sin(now / 760 + i * 0.7) * 0.5 + Math.cos(now / 1150 + i * 0.32) * 0.5;
        const py = y + height - 13 - ((wave + 1) / 2) * (height - 36) - (i % 5) * 1.5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawOfficeShell(width: number, height: number, now: number) {
      const top = Math.max(58, height * 0.07);
      const horizon = Math.max(178, height * 0.31);
      const center = width * 0.5;
      const pulse = Math.sin(now / 1200) * 0.5 + 0.5;

      ctx.save();

      const glass = ctx.createLinearGradient(0, top, 0, horizon + 110);
      glass.addColorStop(0, "rgba(5, 14, 28, 0.92)");
      glass.addColorStop(0.56, "rgba(3, 9, 17, 0.66)");
      glass.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glass;
      ctx.fillRect(0, top, width, horizon + 112);

      ctx.strokeStyle = "rgba(96, 164, 210, 0.12)";
      ctx.lineWidth = 1;
      for (let x = 44; x < width + 80; x += 92) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x - 34, horizon + 96);
        ctx.stroke();
      }

      drawMarketScreen(Math.max(28, center - 470), top + 24, Math.min(285, width * 0.26), 124, "MARKET OVERVIEW", "#00ff9d", now);
      drawMarketScreen(Math.max(54, center - 148), top + 64, Math.min(176, width * 0.18), 88, "GLOBAL RISK", "#65eaff", now + 700);
      drawMarketScreen(Math.min(width - 222, center + 80), top + 68, Math.min(200, width * 0.2), 82, "OPTIONS DESK", "#ffc247", now + 1200);

      const officeW = Math.min(360, Math.max(240, width * 0.25));
      const officeH = 132;
      const officeX = Math.min(width - officeW - 28, Math.max(center + 210, width - officeW - 72));
      const officeY = top + 16;

      ctx.fillStyle = "rgba(5, 9, 14, 0.76)";
      ctx.strokeStyle = "rgba(255, 194, 71, 0.32)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(officeX, officeY, officeW, officeH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,194,71,${0.4 + pulse * 0.18})`;
      ctx.shadowColor = "#ffc247";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(officeX + 16, officeY + 18);
      ctx.lineTo(officeX + officeW - 16, officeY + 18);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#ffda7a";
      ctx.font = "900 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("BOSS OFFICE", officeX + officeW / 2, officeY + 45);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      for (let i = 0; i < 7; i += 1) {
        ctx.fillRect(officeX + 24 + i * ((officeW - 70) / 6), officeY + 72 + (i % 2) * 9, 22, 20);
      }

      ctx.strokeStyle = "rgba(190, 220, 230, 0.14)";
      ctx.lineWidth = 2;
      const stairStartY = officeY + officeH - 4;
      for (const offset of [-44, 44]) {
        ctx.beginPath();
        ctx.moveTo(officeX + officeW / 2 + offset, stairStartY);
        ctx.lineTo(center + offset * 1.6, horizon + 162);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0, 255, 157, 0.26)";
      for (let i = 0; i < 8; i += 1) {
        const y = stairStartY + i * 15;
        ctx.beginPath();
        ctx.moveTo(officeX + officeW / 2 - 42 - i * 12, y);
        ctx.lineTo(officeX + officeW / 2 + 42 + i * 12, y);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(0,255,157,${0.28 + pulse * 0.1})`;
      ctx.shadowColor = "#00ff9d";
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(center - 420, height - 150);
      ctx.lineTo(center - 154, height - 150);
      ctx.lineTo(center - 108, height - 122);
      ctx.lineTo(center + 108, height - 122);
      ctx.lineTo(center + 154, height - 150);
      ctx.lineTo(center + 420, height - 150);
      ctx.stroke();
      ctx.restore();
    }

    function drawFloorFoundation(now: number) {
      const top = gridToScreen(0, 0);
      const right = gridToScreen(GRID_WIDTH - 1, 0);
      const bottom = gridToScreen(GRID_WIDTH - 1, GRID_HEIGHT - 1);
      const left = gridToScreen(0, GRID_HEIGHT - 1);
      const pulse = Math.sin(now / 1100) * 0.5 + 0.5;

      const rim = [
        { x: top.x, y: top.y - 4 },
        { x: right.x + TILE_WIDTH / 2 + 18, y: right.y + TILE_HEIGHT / 2 },
        { x: bottom.x, y: bottom.y + TILE_HEIGHT + 18 },
        { x: left.x - TILE_WIDTH / 2 - 18, y: left.y + TILE_HEIGHT / 2 }
      ];
      const drop = 28;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(rim[0].x, rim[0].y + drop);
      ctx.lineTo(rim[1].x, rim[1].y + drop);
      ctx.lineTo(rim[2].x, rim[2].y + drop);
      ctx.lineTo(rim[3].x, rim[3].y + drop);
      ctx.closePath();
      ctx.fillStyle = "rgba(1, 5, 9, 0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 36;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(rim[0].x, rim[0].y);
      ctx.lineTo(rim[1].x, rim[1].y);
      ctx.lineTo(rim[2].x, rim[2].y);
      ctx.lineTo(rim[3].x, rim[3].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(7, 17, 23, 0.72)";
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(0,255,157,${0.42 + pulse * 0.16})`;
      ctx.shadowColor = "#00ff9d";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rim[0].x, rim[0].y + 4);
      ctx.lineTo(rim[1].x, rim[1].y + 4);
      ctx.lineTo(rim[2].x, rim[2].y + 4);
      ctx.lineTo(rim[3].x, rim[3].y + 4);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,194,71,${0.32 + pulse * 0.12})`;
      ctx.shadowColor = "#ffc247";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rim[3].x + 54, rim[3].y + 14);
      ctx.lineTo(rim[2].x - 60, rim[2].y + 14);
      ctx.stroke();
      ctx.restore();
    }

    function drawBrandPlate(width: number, height: number, now: number) {
      if (width < 760 || height < 620) return;
      const plateW = Math.min(340, width * 0.34);
      const plateH = 54;
      const x = width / 2 - plateW / 2;
      const y = height - 84;
      const pulse = Math.sin(now / 900) * 0.5 + 0.5;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(0,255,157,${0.48 + pulse * 0.18})`;
      ctx.shadowColor = "#00ff9d";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 34, y);
      ctx.lineTo(x + plateW - 34, y);
      ctx.lineTo(x + plateW, y + plateH / 2);
      ctx.lineTo(x + plateW - 34, y + plateH);
      ctx.lineTo(x + 34, y + plateH);
      ctx.lineTo(x, y + plateH / 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(2, 16, 18, 0.82)";
      ctx.fill();
      ctx.stroke();

      ctx.font = "900 26px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#d9fff1";
      ctx.shadowBlur = 24;
      ctx.fillText("THE FLOOR", width / 2, y + plateH / 2 + 1);
      ctx.restore();
    }

    function drawElement(element: FloorElement, now: number) {
      const point = gridToScreen(element.gx, element.gy);
      const baseY = point.y + TILE_HEIGHT / 2;
      const bob = Math.sin(now / 450 + element.gx + element.gy) * 2;
      const variantColor =
        element.variant === "rose"
          ? "#ff4d6d"
          : element.variant === "violet"
            ? "#a64dff"
            : element.variant === "teal"
              ? "#00ff9d"
              : "#ffc247";

      ctx.save();

      // ── Sprite-mapped kinds ──────────────────────────────────
      if (element.kind === "lamp") {
        // Ambient glow underneath sprite
        ctx.globalCompositeOperation = "lighter";
        const glowA = `rgba(255,194,71,0.3)`;
        const glowB = `rgba(255,194,71,0)`;
        const glow = ctx.createRadialGradient(point.x, baseY - 10, 4, point.x, baseY - 10, 52);
        glow.addColorStop(0, glowA);
        glow.addColorStop(1, glowB);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 10, 52, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("lamp", point.x, baseY, "#ffc247");
        ctx.restore();
        return;
      }

      if (element.kind === "obelisk") {
        // Use corner-tower sprite for obelisks (ticker walls in east district)
        const spriteKey: SpriteKey = element.id.includes("north") ? "corner-tower" : "ticker-tower";
        // Glow halo
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 40, 8, point.x, baseY - 40, 60);
        g.addColorStop(0, `rgba(0,255,157,0.22)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 40, 60, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite(spriteKey, point.x, baseY, "#00ff9d");
        ctx.restore();
        return;
      }

      if (element.kind === "crystal") {
        // Use candlestick-screen sprite for crystals (terminal screens)
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 30, 4, point.x, baseY - 30, 48);
        g.addColorStop(0, `rgba(0,255,157,0.18)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 30, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("candlestick-screen", point.x, baseY, "#00ff9d");
        ctx.restore();
        return;
      }

      if (element.kind === "arch" || element.kind === "desk") {
        // Trading desk sprite
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 20, 4, point.x, baseY - 20, 70);
        g.addColorStop(0, `rgba(0,255,157,0.14)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 20, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("desk", point.x, baseY);
        ctx.restore();
        return;
      }

      if (element.kind === "ticker") {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 50, 8, point.x, baseY - 50, 65);
        g.addColorStop(0, `rgba(0,255,157,0.25)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 50, 65, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("ticker-tower", point.x, baseY, "#00ff9d");
        ctx.restore();
        return;
      }

      if (element.kind === "tower") {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 55, 8, point.x, baseY - 55, 65);
        g.addColorStop(0, `rgba(0,255,157,0.28)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 55, 65, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("corner-tower", point.x, baseY, "#00ff9d");
        ctx.restore();
        return;
      }

      if (element.kind === "screen") {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(point.x, baseY - 30, 4, point.x, baseY - 30, 44);
        g.addColorStop(0, `rgba(0,255,157,0.2)`);
        g.addColorStop(1, `rgba(0,255,157,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 30, 44, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        drawSprite("candlestick-screen", point.x, baseY, "#00ff9d");
        ctx.restore();
        return;
      }

      // ── Remaining primitive kinds ────────────────────────────
      if (element.kind === "fountain") {
        ctx.fillStyle = "#29343c";
        ctx.beginPath();
        ctx.ellipse(point.x, baseY - 2, 34, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#778a93";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "rgba(123, 223, 242, 0.72)";
        ctx.beginPath();
        ctx.ellipse(point.x, baseY - 5, 24, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(204, 249, 255, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(point.x - 7, baseY - 14);
        ctx.quadraticCurveTo(point.x, baseY - 32 + bob, point.x + 8, baseY - 14);
        ctx.stroke();
      }

      if (element.kind === "planter") {
        ctx.fillStyle = "#2d2520";
        ctx.beginPath();
        ctx.ellipse(point.x, baseY + 2, 28, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#63c17b";
        for (let i = 0; i < 5; i += 1) {
          const offset = (i - 2) * 8;
          ctx.beginPath();
          ctx.ellipse(point.x + offset, baseY - 11 - Math.abs(offset) / 4, 5, 14, offset / 20, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (element.kind === "crate") {
        ctx.fillStyle = "#6c4a2f";
        ctx.strokeStyle = "#2b2018";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(point.x - 20, baseY - 28, 40, 30);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#a9784d";
        ctx.beginPath();
        ctx.moveTo(point.x - 18, baseY - 26);
        ctx.lineTo(point.x + 18, baseY);
        ctx.moveTo(point.x + 18, baseY - 26);
        ctx.lineTo(point.x - 18, baseY);
        ctx.stroke();
      }

      if (element.kind === "banner") {
        ctx.strokeStyle = "#1b2025";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(point.x - 10, baseY);
        ctx.lineTo(point.x - 10, baseY - 62);
        ctx.stroke();
        ctx.fillStyle = variantColor;
        ctx.beginPath();
        ctx.moveTo(point.x - 7, baseY - 58);
        ctx.lineTo(point.x + 30, baseY - 50 + bob);
        ctx.lineTo(point.x - 7, baseY - 34);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    function drawPlayer(player: VisualPlayer, isLocal: boolean, now: number) {
      const progress = Math.min(1, (now - player.movedAt) / STEP_MS);
      const gx = player.from.gx + (player.to.gx - player.from.gx) * progress;
      const gy = player.from.gy + (player.to.gy - player.from.gy) * progress;
      const point = gridToScreen(gx, gy);
      const baseY = point.y + TILE_HEIGHT / 2;

      ctx.save();

      // Shadow ellipse
      ctx.beginPath();
      ctx.ellipse(point.x, baseY + 8, 18, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fill();

      // Glow halo for local player
      if (isLocal) {
        ctx.globalCompositeOperation = "lighter";
        const halo = ctx.createRadialGradient(point.x, baseY - 24, 4, point.x, baseY - 24, 36);
        halo.addColorStop(0, "rgba(0,255,157,0.32)");
        halo.addColorStop(1, "rgba(0,255,157,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 24, 36, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      // Trader sprite
      drawSprite("trader", point.x, baseY, isLocal ? "#00ff9d" : undefined);

      // Name tag above sprite
      ctx.shadowColor = isLocal ? "rgba(0,255,157,0.7)" : "rgba(0,0,0,0.9)";
      ctx.shadowBlur = isLocal ? 10 : 5;
      ctx.fillStyle = isLocal ? "#00ff9d" : "#c8e8f0";
      ctx.font = `${isLocal ? "700" : "600"} 11px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(player.name.slice(0, 14), point.x, baseY - 98);

      ctx.restore();
    }

    // ── draw bull statue at central plaza (sprite) ──────────
    function drawBull(now: number) {
      const plazaCenterGx = 12;
      const plazaCenterGy = 8;
      const point = gridToScreen(plazaCenterGx, plazaCenterGy);
      const baseY = point.y + TILE_HEIGHT / 2 - 8;
      const pulse = Math.sin(now / 700) * 0.5 + 0.5;

      ctx.save();
      // Outer platform glow
      ctx.globalCompositeOperation = "lighter";
      const platformGlow = ctx.createRadialGradient(point.x, baseY + 4, 6, point.x, baseY + 4, 80);
      platformGlow.addColorStop(0, `rgba(0,255,157,${0.28 + pulse * 0.12})`);
      platformGlow.addColorStop(1, "rgba(0,255,157,0)");
      ctx.fillStyle = platformGlow;
      ctx.beginPath();
      ctx.ellipse(point.x, baseY + 4, 80, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // Platform ring
      ctx.strokeStyle = `rgba(0,255,157,${0.55 + pulse * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = "rgba(0,35,20,0.75)";
      ctx.beginPath();
      ctx.ellipse(point.x, baseY + 6, 52, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Bull sprite on top
      ctx.globalCompositeOperation = "source-over";
      drawSprite("bull", point.x, baseY, "#00ff9d");
      ctx.restore();
    }

    function draw() {
      const scale = window.devicePixelRatio || 1;
      const width = surface.width / scale;
      const height = surface.height / scale;
      const now = performance.now();
      const dateNow = Date.now();
      const path = pathRef.current;
      const pathKeys = new Set(path.map(pointKey));
      const selected = selectedRef.current;
      const hover = hoverRef.current;

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // ── Night city skybox ──────────────────────────────────
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.55);
      sky.addColorStop(0,   "#020510");
      sky.addColorStop(0.5, "#060d1a");
      sky.addColorStop(1,   "#0a0e1a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // distant city skyline silhouette
      ctx.save();
      ctx.fillStyle = "#0c1220";
      const buildingSeeds = [14, 38, 22, 52, 8, 44, 30, 18, 60, 6, 36, 50];
      const skylineY = height * 0.28;
      buildingSeeds.forEach((seed, i) => {
        const bx = (i / buildingSeeds.length) * width - 20 + (seed % 5) * 14;
        const bh = 28 + (seed % 40);
        const bw = 16 + (seed % 28);
        ctx.fillRect(bx, skylineY - bh, bw, bh);
        // windows
        ctx.fillStyle = "#1a2540";
        for (let wr = 0; wr < Math.floor(bh / 10); wr++) {
          for (let wc = 0; wc < Math.floor(bw / 8); wc++) {
            if ((seed + wr + wc + Math.floor(now / 3200)) % 4 !== 0) {
              ctx.fillRect(bx + wc * 8 + 2, skylineY - bh + wr * 10 + 2, 4, 5);
            }
          }
        }
        ctx.fillStyle = "#0c1220";
      });
      // neon horizon glow
      const horizonGlow = ctx.createLinearGradient(0, skylineY - 8, 0, skylineY + 24);
      horizonGlow.addColorStop(0, "rgba(0,255,157,0.09)");
      horizonGlow.addColorStop(0.4, "rgba(100,0,255,0.06)");
      horizonGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, skylineY - 8, width, 32);
      ctx.restore();

      // floor area background
      const floorBg = ctx.createLinearGradient(0, height * 0.3, 0, height);
      floorBg.addColorStop(0, "#0a0e1a");
      floorBg.addColorStop(1, "#06090f");
      ctx.fillStyle = floorBg;
      ctx.fillRect(0, height * 0.3, width, height * 0.7);

      drawOfficeShell(width, height, now);

      // subtle floor reflections (horizontal shimmers)
      ctx.save();
      ctx.globalAlpha = 0.04;
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 6; i++) {
        const ry = height * 0.5 + i * 22 + Math.sin(now / 2200 + i) * 4;
        const rGrad = ctx.createLinearGradient(0, ry, width, ry);
        rGrad.addColorStop(0, "rgba(0,255,157,0)");
        rGrad.addColorStop(0.4, `rgba(0,255,157,${0.5 + (i % 2) * 0.3})`);
        rGrad.addColorStop(0.6, `rgba(100,0,255,${0.3 + (i % 2) * 0.2})`);
        rGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rGrad;
        ctx.fillRect(0, ry, width, 2);
      }
      ctx.restore();

      // ambient particle stars
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 32; i++) {
        const px = ((i * 173 + now / 28) % (width + 60)) - 30;
        const py = ((i * 97 + Math.sin(now / 1100 + i) * 20) % (height * 0.45)) - 10;
        const alpha = 0.12 + (i % 3) * 0.06 + Math.sin(now / 600 + i) * 0.04;
        const col = i % 3 === 0 ? `rgba(0,255,157,${alpha})` : i % 3 === 1 ? `rgba(255,194,71,${alpha * 0.7})` : `rgba(150,80,255,${alpha * 0.5})`;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, 0.9 + (i % 3) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      drawFloorFoundation(now);

      const drawables: Array<{ order: number; draw: () => void }> = [];

      for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
        for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
          const blocked = FLOOR_MAP[gy][gx] === 1;
          drawables.push({
            order: gx + gy,
            draw: () => drawTile(gx, gy, blocked, now)
          });
        }
      }

      for (const pathPoint of path) {
        drawables.push({
          order: pathPoint.gx + pathPoint.gy + 0.16,
          draw: () => drawTileOverlay(pathPoint, "rgba(0,255,157,0.08)", "rgba(0,255,157,0.55)")
        });
      }

      if (selected) {
        drawables.push({
          order: selected.gx + selected.gy + 0.18,
          draw: () => drawTileOverlay(selected, "rgba(255,194,71,0.1)", "rgba(255,194,71,0.7)")
        });
      }

      if (hover && isWalkable(hover.gx, hover.gy) && !pathKeys.has(pointKey(hover))) {
        drawables.push({
          order: hover.gx + hover.gy + 0.2,
          draw: () => drawTileOverlay(hover, "rgba(255,255,255,0.05)", "rgba(255,255,255,0.28)")
        });
      }

      for (const element of FLOOR_ELEMENTS) {
        drawables.push({
          order: element.gx + element.gy + 0.42,
          draw: () => drawElement(element, now)
        });
      }

      // bull statue — center of expanded plaza
      drawables.push({
        order: 12 + 8 + 0.45,
        draw: () => drawBull(now)
      });

      for (const player of playerRef.current.values()) {
        if (!isFresh(player, dateNow)) continue;
        drawables.push({
          order: player.to.gx + player.to.gy + 0.5,
          draw: () => drawPlayer(player, player.id === localRef.current.id, now)
        });
      }

      drawables.sort((a, b) => a.order - b.order);
      for (const drawable of drawables) {
        drawable.draw();
      }

      drawBrandPlate(width, height, now);

      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const target = screenToGrid(event.clientX - rect.left, event.clientY - rect.top);
    clickRef.current(target);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    hoverRef.current = screenToGrid(event.clientX - rect.left, event.clientY - rect.top);
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        hoverRef.current = null;
      }}
      onPointerMove={handlePointerMove}
    />
  );
}

type TabId = "trade" | "tape" | "season" | "hierarchy" | "chat";

const TABS: { id: TabId; label: string }[] = [
  { id: "trade",     label: "Trade" },
  { id: "tape",      label: "Tape" },
  { id: "season",    label: "Season" },
  { id: "hierarchy", label: "Rank" },
  { id: "chat",      label: "Chat" }
];

export default function FloorGame() {
  const [supabase, setSupabase] = useState<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Map<string, VisualPlayer>>(new Map());
  const [status, setStatus] = useState("Disconnected");
  const [activeTab, setActiveTab] = useState<TabId>("trade");
  const [configError, setConfigError] = useState("");

  const [selectedTile, setSelectedTile] = useState<Point | null>(null);
  const [queuedPath, setQueuedPath] = useState<Point[]>([]);
  const localPlayerRef = useRef<Player | null>(null);
  const walkRunRef = useRef(0);

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  useEffect(() => {
    try {
      const error = getSupabaseBrowserConfigError();
      setConfigError(error);
      setSupabase(error ? null : createSupabaseBrowserClient());
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Supabase is not configured.");
    }
  }, []);

  const loadPlayer = useCallback(
    async (client: ReturnType<typeof createSupabaseBrowserClient>) => {
      const {
        data: { session }
      } = await client.auth.getSession();

      if (!session) return null;

      const { data } = await client.from("players").select("*").eq("id", session.user.id).maybeSingle();
      return data;
    },
    []
  );

  useEffect(() => {
    let active = true;

    async function boot() {
      if (!supabase) return;
      const player = await loadPlayer(supabase);
      if (!active || !player) return;
      setLocalPlayer(player);
      setPlayers(new Map([[player.id, upsertVisual(undefined, player)]]));
    }

    boot();
    return () => {
      active = false;
    };
  }, [loadPlayer, supabase]);

  useEffect(() => {
    if (!localPlayer || !supabase) return;
    const client = supabase;

    let staleTimer = 0;
    const channel = client
      .channel("players-table")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players"
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const next = payload.new as Player;

          setPlayers((previous) => {
            const updated = new Map(previous);
            updated.set(next.id, upsertVisual(updated.get(next.id), next));
            return updated;
          });

          if (next.id === localPlayer.id) {
            setLocalPlayer(next);
          }
        }
      )
      .subscribe((nextStatus) => {
        setStatus(nextStatus === "SUBSCRIBED" ? "Realtime connected" : "Connecting...");
      });

    async function refreshPlayers() {
      const { data } = await client.from("players").select("*");
      const now = Date.now();
      setPlayers((previous) => {
        const updated = new Map(previous);
        for (const player of data ?? []) {
          if (isFresh(player, now)) {
            updated.set(player.id, upsertVisual(updated.get(player.id), player));
          }
        }
        for (const [id, player] of updated) {
          if (!isFresh(player, now)) updated.delete(id);
        }
        return updated;
      });
    }

    refreshPlayers();
    staleTimer = window.setInterval(refreshPlayers, 5000);

    return () => {
      window.clearInterval(staleTimer);
      client.removeChannel(channel);
    };
  }, [localPlayer, supabase]);

  useEffect(() => {
    if (!localPlayer || !supabase) return;
    const client = supabase;

    const heartbeat = window.setInterval(async () => {
      const lastSeen = new Date().toISOString();
      await client.from("players").update({ last_seen: lastSeen }).eq("id", localPlayer.id);
    }, 10_000);

    return () => window.clearInterval(heartbeat);
  }, [localPlayer, supabase]);

  const join = useCallback(
    async (name: string) => {
      if (!supabase) {
        throw new Error(configError || "Supabase is not configured.");
      }

      const {
        data: { session: existingSession }
      } = await supabase.auth.getSession();
      const session =
        existingSession ??
        (
          await supabase.auth.signInAnonymously()
        ).data.session;

      if (!session) {
        throw new Error("Anonymous Supabase sessions must be enabled.");
      }

      const spawn = nearestSpawn();
      const { data: existingPlayer, error: existingError } = await supabase
        .from("players")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existingPlayer) {
        const lastSeen = new Date().toISOString();
        const { data, error } = await supabase
          .from("players")
          .update({
            name,
            last_seen: lastSeen
          })
          .eq("id", session.user.id)
          .select("*")
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? "Could not refresh player.");
        }

        setLocalPlayer(data);
        setPlayers(new Map([[data.id, upsertVisual(undefined, data)]]));
        return;
      }

      const { data, error } = await supabase
        .from("players")
        .insert({
          id: session.user.id,
          name,
          gx: spawn.gx,
          gy: spawn.gy,
          facing: "south",
          last_seen: new Date().toISOString()
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Could not create player.");
      }

      setLocalPlayer(data);
      setPlayers(new Map([[data.id, upsertVisual(undefined, data)]]));
    },
    [configError, supabase]
  );

  const move = useCallback(
    async (target: Point) => {
      const startingPlayer = localPlayerRef.current;
      if (!startingPlayer || !supabase) return;

      setSelectedTile(target);

      const path = findPath({ gx: startingPlayer.gx, gy: startingPlayer.gy }, target);
      if (!path || path.length <= 1) {
        setQueuedPath([]);
        return;
      }

      const runId = walkRunRef.current + 1;
      walkRunRef.current = runId;
      let cursor: Player = startingPlayer;
      const steps = path.slice(1);
      setQueuedPath(steps);

      for (let index = 0; index < steps.length; index += 1) {
        if (walkRunRef.current !== runId) return;

        const step = steps[index];
        const targetFacing = facingForStep(cursor, step);
        const optimistic: Player = {
          ...cursor,
          gx: step.gx,
          gy: step.gy,
          facing: targetFacing,
          last_seen: new Date().toISOString()
        };

        setPlayers((previous) => {
          const updated = new Map(previous);
          updated.set(cursor.id, upsertVisual(updated.get(cursor.id), optimistic));
          return updated;
        });

        const {
          data: { session }
        } = await supabase.auth.getSession();

        const response = await fetch("/api/move", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
          },
          body: JSON.stringify({
            playerId: cursor.id,
            gx: step.gx,
            gy: step.gy,
            facing: targetFacing
          })
        });

        const result = (await response.json()) as {
          player?: { gx: number; gy: number; facing: Facing };
          error?: string;
        };

        if (walkRunRef.current !== runId) return;

        if (!result.player) {
          setQueuedPath([]);
          return;
        }

        const reconciled: Player = {
          ...cursor,
          ...result.player,
          last_seen: new Date().toISOString()
        };

        cursor = reconciled;
        localPlayerRef.current = reconciled;
        setLocalPlayer(reconciled);
        setPlayers((previous) => {
          const updated = new Map(previous);
          updated.set(reconciled.id, upsertVisual(updated.get(reconciled.id), reconciled));
          return updated;
        });
        setQueuedPath(steps.slice(index + 1));

        if (!response.ok) break;
        await sleep(PATH_STEP_PAUSE_MS);
      }
    },
    [supabase]
  );

  if (configError) {
    return (
      <main className="entry-wrap">
        <section className="entry-panel">
          <h1>The Floor</h1>
          <p>Add Supabase environment values, then restart the app.</p>
          <div className="error" role="status">
            {configError}
          </div>
        </section>
      </main>
    );
  }

  if (!localPlayer) {
    return <PlayerEntry onJoin={join} />;
  }

  const onlineCount = Array.from(players.values()).filter((player) => isFresh(player, Date.now())).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>The Floor</strong>
          <span className="brand-sub">{localPlayer.name}</span>
        </div>
        <div className="hud">
          <div className="hud-chip">
            <span className="val">{onlineCount}</span>
            <span className="lbl">online</span>
          </div>
          <div className="hud-chip">
            <span className="val">{queuedPath.length}</span>
            <span className="lbl">steps</span>
          </div>
          <div className="hud-chip">
            <span className={`status-dot ${status === "Realtime connected" ? "ready" : ""}`} />
            <span className="lbl">{status === "Realtime connected" ? "live" : "connecting"}</span>
          </div>
          <a
            href="https://x.com/thefloorsolana"
            target="_blank"
            rel="noopener noreferrer"
            className="topbar-x-link"
            aria-label="Follow The Floor on X"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>@thefloorsolana</span>
          </a>
        </div>
      </header>
      <section className="play-space">
        <section className="stage">
          <FloorCanvas
            localPlayer={localPlayer}
            players={players}
            queuedPath={queuedPath}
            selectedTile={selectedTile}
            onTileClick={move}
          />
        </section>
        {supabase ? (
          <div className="side-panels">
            <nav className="panel-tabs" role="tablist" aria-label="Panel sections">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`panel-tab${activeTab === tab.id ? " active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="panel-body" role="tabpanel">
              {activeTab === "trade" && (
                <TradingPanel localPlayerId={localPlayer.id} supabase={supabase} />
              )}
              {activeTab === "tape" && (
                <TapePanel localPlayerId={localPlayer.id} supabase={supabase} />
              )}
              {activeTab === "season" && (
                <SeasonPanel />
              )}
              {activeTab === "hierarchy" && (
                <>
                  <DuelPanel
                    localPlayer={localPlayer}
                    supabase={supabase}
                    onRankedUpdate={(patch) => {
                      const updated = { ...localPlayer, ...patch };
                      localPlayerRef.current = updated;
                      setLocalPlayer(updated);
                      setPlayers((previous) => {
                        const next = new Map(previous);
                        next.set(updated.id, upsertVisual(next.get(updated.id), updated));
                        return next;
                      });
                    }}
                  />
                  <CapitalPanel localPlayerId={localPlayer.id} supabase={supabase} />
                </>
              )}
              {activeTab === "chat" && (
                <ChatPanel supabase={supabase} playerName={localPlayer.name} />
              )}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
