"use client";
// updated
import { useCallback, useEffect, useRef, useState } from "react";
import { gridToScreen, screenToGrid, TILE_HEIGHT, TILE_WIDTH } from "@/client/iso";
import type { Database } from "@/lib/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import CapitalPanel from "./capital-panel";
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
      const plaza = gx >= 5 && gx <= 10 && gy >= 4 && gy <= 8;
      const edge = gx === 0 || gy === 0 || gx === GRID_WIDTH - 1 || gy === GRID_HEIGHT - 1;
      const tapeSide = tapeSideAt(gx, gy);
      const fill = tapeSide === "up" ? "#2e7352" : tapeSide === "down" ? "#753648" : blocked ? "#29313a" : plaza ? "#53616b" : edge ? "#334048" : "#45525b";
      const stroke = tapeSide === "up" ? "#8df2bc" : tapeSide === "down" ? "#ff9bad" : blocked ? "#20262d" : plaza ? "#78858c" : "#60707a";

      drawDiamond(gx, gy, fill, stroke);

      if (tapeSide && !blocked) {
        const point = gridToScreen(gx, gy);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = tapeSide === "up" ? `rgba(141, 242, 188, ${0.14 + pulse * 0.03})` : `rgba(255, 155, 173, ${0.14 + pulse * 0.03})`;
        ctx.beginPath();
        ctx.ellipse(point.x, point.y + TILE_HEIGHT / 2, 30, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#f9fbf4";
        ctx.font = "800 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tapeSide.toUpperCase(), point.x, point.y + TILE_HEIGHT / 2);
      }

      if (plaza && !blocked) {
        const point = gridToScreen(gx, gy);
        ctx.beginPath();
        ctx.moveTo(point.x - TILE_WIDTH / 2 + 10, point.y + TILE_HEIGHT / 2);
        ctx.lineTo(point.x, point.y + TILE_HEIGHT - 10);
        ctx.lineTo(point.x + TILE_WIDTH / 2 - 10, point.y + TILE_HEIGHT / 2);
        ctx.strokeStyle = `rgba(255, 211, 128, ${0.08 + pulse * 0.02})`;
        ctx.stroke();
      }

      if (!blocked) {
        const point = gridToScreen(gx, gy);
        ctx.beginPath();
        ctx.moveTo(point.x - TILE_WIDTH / 2 + 8, point.y + TILE_HEIGHT / 2);
        ctx.lineTo(point.x, point.y + TILE_HEIGHT - 8);
        ctx.lineTo(point.x + TILE_WIDTH / 2 - 8, point.y + TILE_HEIGHT / 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.stroke();
      }
    }

    function drawTileOverlay(point: Point, fillStyle: string, strokeStyle: string) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      drawDiamond(point.gx, point.gy, fillStyle, strokeStyle, 5);
      ctx.restore();
    }

    function drawElement(element: FloorElement, now: number) {
      const point = gridToScreen(element.gx, element.gy);
      const baseY = point.y + TILE_HEIGHT / 2;
      const bob = Math.sin(now / 450 + element.gx + element.gy) * 2;
      const variantColor =
        element.variant === "rose"
          ? "#ff8fa3"
          : element.variant === "violet"
            ? "#b994ff"
            : element.variant === "teal"
              ? "#7bdff2"
              : "#ffc247";

      ctx.save();

      if (element.kind === "lamp") {
        ctx.globalCompositeOperation = "lighter";
        const glow = ctx.createRadialGradient(point.x, baseY - 34, 4, point.x, baseY - 34, 58);
        glow.addColorStop(0, "rgba(255, 194, 71, 0.42)");
        glow.addColorStop(1, "rgba(255, 194, 71, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 34, 58, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "#1b2025";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(point.x, baseY - 4);
        ctx.lineTo(point.x, baseY - 42);
        ctx.stroke();
        ctx.fillStyle = variantColor;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 47, 8, 0, Math.PI * 2);
        ctx.fill();
      }

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

      if (element.kind === "crystal") {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(185, 148, 255, 0.18)";
        ctx.beginPath();
        ctx.arc(point.x, baseY - 22, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = variantColor;
        ctx.strokeStyle = "#211b31";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(point.x, baseY - 58 + bob);
        ctx.lineTo(point.x + 15, baseY - 25);
        ctx.lineTo(point.x + 5, baseY - 6);
        ctx.lineTo(point.x - 13, baseY - 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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

      if (element.kind === "obelisk") {
        ctx.fillStyle = "#252836";
        ctx.strokeStyle = variantColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(point.x, baseY - 78);
        ctx.lineTo(point.x + 18, baseY - 16);
        ctx.lineTo(point.x, baseY - 4);
        ctx.lineTo(point.x - 18, baseY - 16);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = variantColor;
        ctx.beginPath();
        ctx.arc(point.x, baseY - 42 + bob, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (element.kind === "arch") {
        ctx.strokeStyle = "#1c2228";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(point.x - 22, baseY);
        ctx.lineTo(point.x - 22, baseY - 44);
        ctx.quadraticCurveTo(point.x, baseY - 72, point.x + 22, baseY - 44);
        ctx.lineTo(point.x + 22, baseY);
        ctx.stroke();
        ctx.strokeStyle = variantColor;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.restore();
    }

    function drawPlayer(player: VisualPlayer, isLocal: boolean, now: number) {
      const progress = Math.min(1, (now - player.movedAt) / STEP_MS);
      const gx = player.from.gx + (player.to.gx - player.from.gx) * progress;
      const gy = player.from.gy + (player.to.gy - player.from.gy) * progress;
      const point = gridToScreen(gx, gy);
      const baseY = point.y + TILE_HEIGHT / 2;
      const stride = Math.sin(now / 90) * (progress < 1 ? 3 : 1);

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.ellipse(point.x, baseY + 9, 21, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(point.x, baseY - 20 + stride, 13, 0, Math.PI * 2);
      ctx.fillStyle = isLocal ? "#ffc247" : "#7bdff2";
      ctx.fill();
      ctx.strokeStyle = "#15191d";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = isLocal ? "#2b2420" : "#16323a";
      ctx.beginPath();
      ctx.ellipse(point.x, baseY - 4, 10, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#f6f2e9";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(player.name.slice(0, 14), point.x, baseY - 43);

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
      const backdrop = ctx.createLinearGradient(0, 0, width, height);
      backdrop.addColorStop(0, "#10161a");
      backdrop.addColorStop(0.55, "#151a1e");
      backdrop.addColorStop(1, "#0f1316");
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 194, 71, 0.08)";
      for (let i = 0; i < 24; i += 1) {
        const x = (i * 149 + now / 22) % (width + 120) - 60;
        const y = (i * 83 + Math.sin(now / 900 + i) * 18) % (height + 80) - 40;
        ctx.beginPath();
        ctx.arc(x, y, 1.3 + (i % 3) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

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
          draw: () => drawTileOverlay(pathPoint, "rgba(255, 194, 71, 0.12)", "rgba(255, 218, 122, 0.56)")
        });
      }

      if (selected) {
        drawables.push({
          order: selected.gx + selected.gy + 0.18,
          draw: () => drawTileOverlay(selected, "rgba(123, 223, 242, 0.13)", "rgba(123, 223, 242, 0.7)")
        });
      }

      if (hover && isWalkable(hover.gx, hover.gy) && !pathKeys.has(pointKey(hover))) {
        drawables.push({
          order: hover.gx + hover.gy + 0.2,
          draw: () => drawTileOverlay(hover, "rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.38)")
        });
      }

      for (const element of FLOOR_ELEMENTS) {
        drawables.push({
          order: element.gx + element.gy + 0.42,
          draw: () => drawElement(element, now)
        });
      }

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

export default function FloorGame() {
  const [supabase, setSupabase] = useState<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Map<string, VisualPlayer>>(new Map());
  const [status, setStatus] = useState("Disconnected");

  const [selectedTile, setSelectedTile] = useState<Point | null>(null);
  const [queuedPath, setQueuedPath] = useState<Point[]>([]);
  const localPlayerRef = useRef<Player | null>(null);
  const walkRunRef = useRef(0);

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  useEffect(() => {
    setSupabase(createSupabaseBrowserClient());
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
        throw new Error("Supabase is not configured.");
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

  if (!localPlayer) {
    return <PlayerEntry onJoin={join} />;
  }

  const onlineCount = Array.from(players.values()).filter((player) => isFresh(player, Date.now())).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>The Floor</strong>
          <span>
            {localPlayer.name} at ({localPlayer.gx}, {localPlayer.gy})
          </span>
        </div>
        <div className="hud">
          <div className="hud-pill">
            <span>{onlineCount}</span>
            <small>online</small>
          </div>
          <div className="hud-pill">
            <span>{queuedPath.length}</span>
            <small>steps</small>
          </div>
          <div className="status">
            <span className={`status-dot ${status === "Realtime connected" ? "ready" : ""}`} />
            <span>{status}</span>
          </div>
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
            <TradingPanel localPlayerId={localPlayer.id} supabase={supabase} />
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
            <TapePanel localPlayerId={localPlayer.id} supabase={supabase} />
            <SeasonPanel />
          </div>
        ) : null}
      </section>
    </main>
  );
}
