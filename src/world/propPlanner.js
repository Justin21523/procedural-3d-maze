import { TILE_TYPES, ROOM_TYPES } from './tileTypes.js';
import { CONFIG } from '../core/config.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed, x, y) {
  const sx = Math.imul((x | 0) ^ 0x9E3779B9, 0x85EBCA6B);
  const sy = Math.imul((y | 0) ^ 0xC2B2AE35, 0x27D4EB2F);
  const s = (seed >>> 0) ^ sx ^ sy;
  return s >>> 0;
}

function pickKind(roomType, rand) {
  switch (roomType) {
    case ROOM_TYPES.CLASSROOM:
      return rand() < 0.6 ? 'deskChair' : 'chair';
    case ROOM_TYPES.OFFICE:
      return rand() < 0.6 ? 'deskChairOffice' : 'chairOffice';
    case ROOM_TYPES.BATHROOM:
      return rand() < 0.55 ? 'toilet' : 'sink';
    case ROOM_TYPES.STORAGE:
      return 'boxStack';
    case ROOM_TYPES.LIBRARY:
      return 'bookshelf';
    case ROOM_TYPES.GYM:
      return 'gymSet';
    case ROOM_TYPES.BEDROOM:
      return 'bedroomSet';
    default:
      return null;
  }
}

/**
 * Plans lightweight props as collision obstacles.
 * - Deterministic per-tile (seed + x/y hash) so visuals can match collision.
 * - Avoids corridors + pool to keep navigation stable.
 */
export function planPropObstacles(worldState, options = {}) {
  const ws = worldState;
  const grid = ws?.grid || null;
  const roomMap = ws?.roomMap || null;
  if (!grid || !roomMap) {
    return { seed: 0, plan: null };
  }

  const enabled = (CONFIG.PROP_OBSTACLES_ENABLED ?? true) && !CONFIG.LOW_PERF_MODE;
  if (!enabled) {
    ws.propPlan = null;
    return { seed: 0, plan: null };
  }

  const height = grid.length;
  const width = grid[0]?.length || 0;
  const plan = new Array(height);
  for (let y = 0; y < height; y++) {
    plan[y] = new Array(width).fill(null);
  }

  const baseSeed =
    (Number.isFinite(options.seed) ? options.seed : null) ??
    (Number.isFinite(ws.propSeed) ? ws.propSeed : null) ??
    Math.floor(Math.random() * 1_000_000_000);
  const seed = (baseSeed >>> 0);
  ws.propSeed = seed;

  const baseRoomChance = clamp(Number(CONFIG.PROP_OBSTACLE_ROOM_CHANCE ?? 0.12) || 0.12, 0, 1);
  const margin = Math.max(0, Math.round(CONFIG.PROP_OBSTACLE_MARGIN ?? 1));

  const derivedMax = Math.max(0, Math.round(width * height * 0.06));
  let maxCount = null;

  const rawMax = options.maxCount;
  if (rawMax !== undefined && rawMax !== null && rawMax !== '') {
    const n = Number(rawMax);
    if (Number.isFinite(n)) {
      maxCount = Math.max(0, Math.round(n));
    }
  }

  if (maxCount === null && Number.isFinite(CONFIG.PROP_OBSTACLE_MAX_COUNT)) {
    maxCount = Math.max(0, Math.round(CONFIG.PROP_OBSTACLE_MAX_COUNT));
  }
  if (maxCount === null) {
    maxCount = derivedMax;
  }

  if (maxCount <= 0) {
    ws.propPlan = plan;
    return { seed, plan, count: 0, maxCount };
  }

  const candidates = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] !== TILE_TYPES.FLOOR) continue;

      const roomType = roomMap?.[y]?.[x];
      if (roomType === ROOM_TYPES.CORRIDOR || roomType === ROOM_TYPES.POOL) continue;
      if (!ws.isWalkable?.(x, y)) continue;
      if (margin > 0 && ws.isWalkableWithMargin && !ws.isWalkableWithMargin(x, y, margin)) continue;

      const rand = mulberry32(hashSeed(seed, x, y));
      if (rand() > baseRoomChance) continue;

      const kind = pickKind(roomType, rand);
      if (!kind) continue;

      const rotation = rand() * Math.PI * 2;
      const entry = { kind, rotation, roomType };
      const score = mulberry32(hashSeed(seed ^ 0x9E3779B9, x, y))();
      candidates.push({ x, y, entry, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  let placed = 0;
  for (const c of candidates) {
    if (placed >= maxCount) break;
    if (!ws.isWalkable?.(c.x, c.y)) continue;
    if (margin > 0 && ws.isWalkableWithMargin && !ws.isWalkableWithMargin(c.x, c.y, margin)) continue;

    plan[c.y][c.x] = c.entry;
    ws.setObstacle?.(c.x, c.y, true);
    placed += 1;
  }

  ws.propPlan = plan;
  return { seed, plan, count: placed, maxCount };
}
