export const TILE_WIDTH = 80;
export const TILE_HEIGHT = 40;
export const ORIGIN_X = 720;
export const ORIGIN_Y = 36;

export function gridToScreen(gx: number, gy: number) {
  return {
    x: ORIGIN_X + (gx - gy) * (TILE_WIDTH / 2),
    y: ORIGIN_Y + (gx + gy) * (TILE_HEIGHT / 2)
  };
}

export function screenToGrid(px: number, py: number) {
  const localX = px - ORIGIN_X;
  const localY = py - ORIGIN_Y;

  return {
    gx: Math.floor(localY / TILE_HEIGHT + localX / TILE_WIDTH),
    gy: Math.floor(localY / TILE_HEIGHT - localX / TILE_WIDTH)
  };
}
