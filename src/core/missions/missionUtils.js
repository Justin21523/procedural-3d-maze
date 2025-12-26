import { CONFIG } from '../config.js';

export function gridToWorldCenter(gridPos, tileSize = null) {
  const ts = tileSize ?? CONFIG.TILE_SIZE ?? 1;
  return {
    x: (gridPos.x + 0.5) * ts,
    z: (gridPos.y + 0.5) * ts
  };
}

export function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function pickRoomTiles(worldState, allowedRoomTypes = null) {
  const rooms = worldState?.getRooms ? worldState.getRooms() : [];
  const allowedSet = Array.isArray(allowedRoomTypes) && allowedRoomTypes.length > 0
    ? new Set(allowedRoomTypes)
    : null;

  const tiles = [];
  for (const room of rooms) {
    if (!room || !Array.isArray(room.tiles)) continue;
    if (allowedSet && !allowedSet.has(room.type)) continue;
    for (const t of room.tiles) {
      if (!t) continue;
      tiles.push({ x: t.x, y: t.y, roomType: room.type });
    }
  }
  return tiles;
}

export function pickDistinctTiles(worldState, count, options = {}) {
  const ws = worldState;
  const desired = Math.max(0, Math.round(count || 0));
  if (!ws?.isWalkableWithMargin || desired <= 0) return [];

  const allowedRoomTypes = options.allowedRoomTypes ?? null;
  const minDistFrom = options.minDistFrom || [];
  const minDist = Number.isFinite(options.minDist) ? options.minDist : 6;
  const margin = Number.isFinite(options.margin) ? options.margin : 1;
  const maxAttempts = Math.max(desired * 120, 300);

  const candidates = pickRoomTiles(ws, allowedRoomTypes);
  if (candidates.length === 0) return [];

  const used = new Set();
  const picked = [];

  const isFarEnough = (tile) => {
    for (const avoid of minDistFrom) {
      if (!avoid) continue;
      const d = manhattan(tile, avoid);
      if (d < minDist) return false;
    }
    return true;
  };

  for (let i = 0; i < maxAttempts && picked.length < desired; i++) {
    const t = candidates[Math.floor(Math.random() * candidates.length)];
    if (!t) continue;
    const key = `${t.x},${t.y}`;
    if (used.has(key)) continue;
    if (!ws.isWalkableWithMargin(t.x, t.y, margin)) continue;
    if (!isFarEnough(t)) continue;
    used.add(key);
    picked.push({ x: t.x, y: t.y, roomType: t.roomType });
  }

  // Fallback: allow closer placements if strict filter produced too few tiles.
  if (picked.length < desired) {
    for (let i = 0; i < candidates.length && picked.length < desired; i++) {
      const t = candidates[Math.floor(Math.random() * candidates.length)];
      if (!t) continue;
      const key = `${t.x},${t.y}`;
      if (used.has(key)) continue;
      if (!ws.isWalkableWithMargin(t.x, t.y, margin)) continue;
      used.add(key);
      picked.push({ x: t.x, y: t.y, roomType: t.roomType });
    }
  }

  return picked.slice(0, desired);
}

