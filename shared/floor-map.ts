// 24 cols × 20 rows
// 0 = walkable, 1 = blocked prop/wall tile
// Districts:
//   Central Plaza       : cols 9-14, rows 6-11 (open)
//   North Trading Row   : cols 2-22, row 1-2   (lamp corridor)
//   East Portfolio Desks: cols 18-22, rows 4-12 (blocked desk pads)
//   South Market        : cols 4-19, rows 15-18 (open market)
//   West Risk Lane      : cols 1-5,  rows 5-14  (open lane)
//   Corner Towers       : cols 0,23 rows 0,19
//   UP pad              : cols 4-5,  rows 16-17
//   DOWN pad            : cols 18-19,rows 16-17
export const FLOOR_MAP = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 0
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 1
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0], // 2
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0], // 3
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 4
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 5
  [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], // 6
  [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], // 7
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 8
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 9
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 10
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 11
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0], // 12
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0], // 13
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 14
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 15
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 16
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 17
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 18
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 19
] as const;

export const GRID_HEIGHT = FLOOR_MAP.length;
export const GRID_WIDTH = FLOOR_MAP[0].length;

export type Facing = "north" | "south" | "east" | "west";
export type TapeSide = "up" | "down";

export type TapePad = {
  side: TapeSide;
  label: string;
  tiles: Array<{ gx: number; gy: number }>;
};

export const TAPE_PADS: TapePad[] = [
  {
    side: "up",
    label: "UP",
    tiles: [
      { gx: 4, gy: 16 },
      { gx: 5, gy: 16 },
      { gx: 4, gy: 17 },
      { gx: 5, gy: 17 }
    ]
  },
  {
    side: "down",
    label: "DOWN",
    tiles: [
      { gx: 18, gy: 16 },
      { gx: 19, gy: 16 },
      { gx: 18, gy: 17 },
      { gx: 19, gy: 17 }
    ]
  }
];

export type FloorElementKind =
  | "fountain"
  | "lamp"
  | "planter"
  | "crystal"
  | "crate"
  | "banner"
  | "obelisk"
  | "arch"
  | "desk"        // trading desk (sprite: desk)
  | "ticker"      // tall ticker tower (sprite: ticker-tower)
  | "tower"       // corner tower (sprite: corner-tower)
  | "screen";     // candlestick terminal screen (sprite: candlestick-screen)

export type FloorElement = {
  id: string;
  kind: FloorElementKind;
  gx: number;
  gy: number;
  variant?: "gold" | "teal" | "rose" | "violet";
};

export const FLOOR_ELEMENTS: FloorElement[] = [
  // ── Corner towers (4 corners) ──────────────────────────────
  { id: "tower-nw",   kind: "tower",  gx: 2,  gy: 2,  variant: "teal" },
  { id: "tower-ne",   kind: "tower",  gx: 20, gy: 2,  variant: "teal" },
  { id: "tower-sw",   kind: "tower",  gx: 2,  gy: 12, variant: "teal" },
  { id: "tower-se",   kind: "tower",  gx: 20, gy: 12, variant: "teal" },

  // ── Central plaza — ticker walls flanking entry ─────────────
  { id: "ticker-w",   kind: "ticker", gx: 5,  gy: 6,  variant: "teal" },
  { id: "ticker-w2",  kind: "ticker", gx: 5,  gy: 7,  variant: "teal" },
  { id: "ticker-e",   kind: "ticker", gx: 17, gy: 6,  variant: "teal" },
  { id: "ticker-e2",  kind: "ticker", gx: 17, gy: 7,  variant: "teal" },

  // ── East portfolio / risk desks ────────────────────────────
  { id: "desk-e1",    kind: "arch",   gx: 19, gy: 4,  variant: "gold" },
  { id: "desk-e2",    kind: "arch",   gx: 21, gy: 5,  variant: "gold" },
  { id: "desk-e3",    kind: "arch",   gx: 19, gy: 9,  variant: "gold" },
  { id: "desk-e4",    kind: "arch",   gx: 21, gy: 10, variant: "gold" },

  // ── East terminal screens ──────────────────────────────────
  { id: "screen-e1",  kind: "crystal", gx: 20, gy: 4,  variant: "teal" },
  { id: "screen-e2",  kind: "crystal", gx: 20, gy: 9,  variant: "teal" },

  // ── West risk lane desks ───────────────────────────────────
  { id: "desk-w1",    kind: "arch",   gx: 1,  gy: 5,  variant: "gold" },
  { id: "desk-w2",    kind: "arch",   gx: 3,  gy: 6,  variant: "gold" },
  { id: "desk-w3",    kind: "arch",   gx: 1,  gy: 10, variant: "gold" },
  { id: "desk-w4",    kind: "arch",   gx: 3,  gy: 11, variant: "gold" },

  // ── West terminal screens ──────────────────────────────────
  { id: "screen-w1",  kind: "crystal", gx: 2,  gy: 5,  variant: "teal" },
  { id: "screen-w2",  kind: "crystal", gx: 2,  gy: 10, variant: "teal" },

  // ── North corridor ticker boards ───────────────────────────
  { id: "ticker-n1",  kind: "obelisk", gx: 8,  gy: 1,  variant: "teal" },
  { id: "ticker-n2",  kind: "obelisk", gx: 11, gy: 1,  variant: "teal" },
  { id: "ticker-n3",  kind: "obelisk", gx: 14, gy: 1,  variant: "teal" },

  // ── South market area ─────────────────────────────────────
  { id: "market-desk-1", kind: "arch",  gx: 7,  gy: 15, variant: "gold" },
  { id: "market-desk-2", kind: "arch",  gx: 9,  gy: 15, variant: "gold" },
  { id: "market-desk-3", kind: "arch",  gx: 13, gy: 15, variant: "gold" },
  { id: "market-desk-4", kind: "arch",  gx: 15, gy: 15, variant: "gold" },
  { id: "market-screen-1", kind: "crystal", gx: 8,  gy: 15, variant: "teal" },
  { id: "market-screen-2", kind: "crystal", gx: 14, gy: 15, variant: "teal" },
  { id: "market-banner",   kind: "banner", gx: 6,  gy: 18, variant: "rose" },
  { id: "market-banner-2", kind: "banner", gx: 16, gy: 18, variant: "teal" },

  // ── Lamps — corners + crossroads ─────────────────────────
  { id: "lamp-0",  kind: "lamp", gx: 1,  gy: 1,  variant: "gold" },
  { id: "lamp-1",  kind: "lamp", gx: 22, gy: 1,  variant: "gold" },
  { id: "lamp-2",  kind: "lamp", gx: 1,  gy: 18, variant: "gold" },
  { id: "lamp-3",  kind: "lamp", gx: 22, gy: 18, variant: "gold" },
  { id: "lamp-4",  kind: "lamp", gx: 6,  gy: 4,  variant: "gold" },
  { id: "lamp-5",  kind: "lamp", gx: 16, gy: 4,  variant: "gold" },
  { id: "lamp-6",  kind: "lamp", gx: 6,  gy: 13, variant: "gold" },
  { id: "lamp-7",  kind: "lamp", gx: 16, gy: 13, variant: "gold" },
  { id: "lamp-8",  kind: "lamp", gx: 11, gy: 9,  variant: "gold" },

  // ── Planters along paths ──────────────────────────────────
  { id: "planter-nw", kind: "planter", gx: 4,  gy: 4  },
  { id: "planter-ne", kind: "planter", gx: 18, gy: 4  },
  { id: "planter-sw", kind: "planter", gx: 4,  gy: 14 },
  { id: "planter-se", kind: "planter", gx: 18, gy: 14 },

  // ── Central plaza fountain pair ───────────────────────────
  { id: "plaza-fountain",   kind: "fountain", gx: 10, gy: 8, variant: "teal" },
  { id: "plaza-fountain-2", kind: "fountain", gx: 13, gy: 8, variant: "teal" },
];

export function isWalkable(gx: number, gy: number): boolean {
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) {
    return false;
  }

  if (gx < 0 || gy < 0 || gx >= GRID_WIDTH || gy >= GRID_HEIGHT) {
    return false;
  }

  return FLOOR_MAP[gy][gx] === 0;
}

export function tapeSideAt(gx: number, gy: number): TapeSide | null {
  for (const pad of TAPE_PADS) {
    if (pad.tiles.some((tile) => tile.gx === gx && tile.gy === gy)) {
      return pad.side;
    }
  }

  return null;
}

export function nearestSpawn(): { gx: number; gy: number } {
  for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
    for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
      if (isWalkable(gx, gy)) {
        return { gx, gy };
      }
    }
  }

  throw new Error("Floor map has no walkable spawn tile.");
}
