export const FLOOR_MAP = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
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
      { gx: 4, gy: 11 },
      { gx: 5, gy: 11 },
      { gx: 4, gy: 12 },
      { gx: 5, gy: 12 }
    ]
  },
  {
    side: "down",
    label: "DOWN",
    tiles: [
      { gx: 10, gy: 11 },
      { gx: 11, gy: 11 },
      { gx: 10, gy: 12 },
      { gx: 11, gy: 12 }
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
  | "terminal"
  | "tower"
  | "desk"
  | "statue"
  | "ticker";

export type FloorElement = {
  id: string;
  kind: FloorElementKind;
  gx: number;
  gy: number;
  variant?: "gold" | "teal" | "rose" | "violet" | "emerald" | "amber" | "cyan" | "red";
};

export const FLOOR_ELEMENTS: FloorElement[] = [
  { id: "northwest-tower", kind: "tower", gx: 1, gy: 1, variant: "emerald" },
  { id: "northeast-tower", kind: "tower", gx: 22, gy: 1, variant: "emerald" },
  { id: "southwest-tower", kind: "tower", gx: 1, gy: 18, variant: "emerald" },
  { id: "southeast-tower", kind: "tower", gx: 22, gy: 18, variant: "emerald" },
  { id: "main-ticker", kind: "ticker", gx: 7, gy: 2, variant: "emerald" },
  { id: "left-ticker", kind: "ticker", gx: 5, gy: 3, variant: "cyan" },
  { id: "right-ticker", kind: "ticker", gx: 10, gy: 3, variant: "amber" },
  { id: "desk-0", kind: "desk", gx: 4, gy: 5, variant: "emerald" },
  { id: "desk-1", kind: "desk", gx: 5, gy: 7, variant: "emerald" },
  { id: "desk-2", kind: "desk", gx: 7, gy: 4, variant: "cyan" },
  { id: "desk-3", kind: "desk", gx: 8, gy: 8, variant: "emerald" },
  { id: "desk-4", kind: "desk", gx: 10, gy: 7, variant: "amber" },
  { id: "desk-5", kind: "desk", gx: 12, gy: 5, variant: "emerald" },
  { id: "terminal-0", kind: "terminal", gx: 6, gy: 5, variant: "emerald" },
  { id: "terminal-1", kind: "terminal", gx: 9, gy: 5, variant: "emerald" },
  { id: "terminal-2", kind: "terminal", gx: 6, gy: 6, variant: "cyan" },
  { id: "terminal-3", kind: "terminal", gx: 9, gy: 6, variant: "amber" },
  { id: "bull-core", kind: "statue", gx: 7, gy: 7, variant: "emerald" },
  { id: "east-ticker", kind: "ticker", gx: 17, gy: 4, variant: "emerald" },
  { id: "east-ticker-2", kind: "ticker", gx: 20, gy: 5, variant: "cyan" },
  { id: "portfolio-desk-0", kind: "desk", gx: 17, gy: 8, variant: "emerald" },
  { id: "portfolio-desk-1", kind: "desk", gx: 19, gy: 9, variant: "amber" },
  { id: "portfolio-desk-2", kind: "desk", gx: 21, gy: 11, variant: "cyan" },
  { id: "risk-terminal-0", kind: "terminal", gx: 15, gy: 10, variant: "red" },
  { id: "risk-terminal-1", kind: "terminal", gx: 18, gy: 12, variant: "emerald" },
  { id: "south-market-ticker", kind: "ticker", gx: 13, gy: 15, variant: "amber" },
  { id: "south-desk-0", kind: "desk", gx: 9, gy: 16, variant: "emerald" },
  { id: "south-desk-1", kind: "desk", gx: 12, gy: 17, variant: "cyan" },
  { id: "south-desk-2", kind: "desk", gx: 16, gy: 17, variant: "emerald" },
  { id: "tape-up-arch", kind: "arch", gx: 5, gy: 10, variant: "emerald" },
  { id: "tape-down-arch", kind: "arch", gx: 11, gy: 10, variant: "rose" },
  { id: "lamp-0", kind: "lamp", gx: 3, gy: 1, variant: "gold" },
  { id: "lamp-1", kind: "lamp", gx: 12, gy: 1, variant: "gold" },
  { id: "lamp-2", kind: "lamp", gx: 3, gy: 12, variant: "gold" },
  { id: "lamp-3", kind: "lamp", gx: 20, gy: 16, variant: "gold" },
  { id: "lamp-4", kind: "lamp", gx: 2, gy: 6, variant: "gold" },
  { id: "lamp-5", kind: "lamp", gx: 13, gy: 6, variant: "gold" },
  { id: "lamp-6", kind: "lamp", gx: 18, gy: 3, variant: "gold" },
  { id: "lamp-7", kind: "lamp", gx: 6, gy: 15, variant: "gold" },
  { id: "lamp-8", kind: "lamp", gx: 15, gy: 18, variant: "gold" },
  { id: "lamp-9", kind: "lamp", gx: 22, gy: 12, variant: "gold" }
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
  if (isWalkable(11, 7)) {
    return { gx: 11, gy: 7 };
  }

  for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
    for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
      if (isWalkable(gx, gy)) {
        return { gx, gy };
      }
    }
  }

  throw new Error("Floor map has no walkable spawn tile.");
}
