function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Check whether a circle (player/monster) can occupy a world position,
 * considering walls + obstacleMap via worldState.isWalkable().
 *
 * @param {WorldState} worldState
 * @param {number} worldX
 * @param {number} worldZ
 * @param {number} radius
 * @param {number} tileSize
 * @returns {boolean}
 */
export function canOccupyCircle(worldState, worldX, worldZ, radius, tileSize) {
  if (!worldState?.isWalkable) return true;
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;

  const ts = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  const r = Number.isFinite(radius) && radius > 0 ? radius : 0;

  const gridX = Math.floor(worldX / ts);
  const gridY = Math.floor(worldZ / ts);

  if (!worldState.isWalkable(gridX, gridY)) return false;
  if (!(r > 0)) return true;

  // Expand search range based on radius (usually 1 tile).
  const rTiles = Math.max(1, Math.ceil(r / ts) + 1);
  const rSq = r * r;

  for (let gy = gridY - rTiles; gy <= gridY + rTiles; gy++) {
    for (let gx = gridX - rTiles; gx <= gridX + rTiles; gx++) {
      if (worldState.isWalkable(gx, gy)) continue;

      const tileMinX = gx * ts;
      const tileMaxX = tileMinX + ts;
      const tileMinZ = gy * ts;
      const tileMaxZ = tileMinZ + ts;

      const nearestX = clamp(worldX, tileMinX, tileMaxX);
      const nearestZ = clamp(worldZ, tileMinZ, tileMaxZ);

      const dx = worldX - nearestX;
      const dz = worldZ - nearestZ;
      if (dx * dx + dz * dz < rSq) {
        return false;
      }
    }
  }

  return true;
}

