export const FLOOR_MAP = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
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
  | "arch";

export type FloorElement = {
  id: string;
  kind: FloorElementKind;
  gx: number;
  gy: number;
  variant?: "gold" | "teal" | "rose" | "violet";
};

export const FLOOR_ELEMENTS: FloorElement[] = [
  { id: "plaza-fountain", kind: "fountain", gx: 7, gy: 5, variant: "teal" },
  { id: "plaza-fountain-2", kind: "fountain", gx: 8, gy: 5, variant: "teal" },
  { id: "plaza-fountain-3", kind: "fountain", gx: 7, gy: 6, variant: "teal" },
  { id: "plaza-fountain-4", kind: "fountain", gx: 8, gy: 6, variant: "teal" },
  { id: "northwest-planter", kind: "planter", gx: 2, gy: 2 },
  { id: "northwest-planter-2", kind: "planter", gx: 3, gy: 2 },
  { id: "northeast-planter", kind: "planter", gx: 11, gy: 2 },
  { id: "northeast-planter-2", kind: "planter", gx: 12, gy: 2 },
  { id: "southwest-crates", kind: "crate", gx: 2, gy: 8 },
  { id: "southwest-crates-2", kind: "crate", gx: 3, gy: 8 },
  { id: "southeast-crystals", kind: "crystal", gx: 12, gy: 8, variant: "violet" },
  { id: "southeast-crystals-2", kind: "crystal", gx: 13, gy: 8, variant: "rose" },
  { id: "west-arch", kind: "arch", gx: 5, gy: 5, variant: "gold" },
  { id: "east-arch", kind: "arch", gx: 10, gy: 5, variant: "gold" },
  { id: "north-obelisk", kind: "obelisk", gx: 7, gy: 2, variant: "violet" },
  { id: "north-obelisk-2", kind: "obelisk", gx: 8, gy: 2, variant: "violet" },
  { id: "market-banner", kind: "banner", gx: 5, gy: 9, variant: "rose" },
  { id: "market-banner-2", kind: "banner", gx: 10, gy: 9, variant: "teal" },
  { id: "lamp-0", kind: "lamp", gx: 1, gy: 1, variant: "gold" },
  { id: "lamp-1", kind: "lamp", gx: 14, gy: 1, variant: "gold" },
  { id: "lamp-2", kind: "lamp", gx: 1, gy: 12, variant: "gold" },
  { id: "lamp-3", kind: "lamp", gx: 14, gy: 12, variant: "gold" },
  { id: "lamp-4", kind: "lamp", gx: 4, gy: 4, variant: "gold" },
  { id: "lamp-5", kind: "lamp", gx: 11, gy: 4, variant: "gold" },
  { id: "lamp-6", kind: "lamp", gx: 4, gy: 10, variant: "gold" },
  { id: "lamp-7", kind: "lamp", gx: 11, gy: 10, variant: "gold" }
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
