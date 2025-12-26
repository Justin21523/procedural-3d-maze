import { TASK_STATUS } from './taskStatus.js';
import { MoveToTask } from './moveToTask.js';

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function buildAllowedRoomSet(roomTypes) {
  if (!Array.isArray(roomTypes) || roomTypes.length === 0) return null;
  const set = new Set();
  roomTypes.forEach((t) => set.add(t));
  return set.size > 0 ? set : null;
}

function pickRandomRoomTile(worldState, allowedRoomSet, options = {}) {
  const ws = worldState;
  if (!ws?.getRooms) return null;

  const rooms = ws.getRooms();
  const candidateRooms = allowedRoomSet
    ? rooms.filter((r) => r && allowedRoomSet.has(r.type))
    : rooms;

  const margin = Number.isFinite(options.margin) ? Math.max(0, options.margin) : 1;
  const minDist = Number.isFinite(options.minDist) ? Math.max(0, options.minDist) : 0;
  const minDistFrom = Array.isArray(options.minDistFrom) ? options.minDistFrom.filter(Boolean) : [];
  const attempts = clampInt(options.attempts, 20, 2000, 240);

  if (!Array.isArray(candidateRooms) || candidateRooms.length === 0) return null;

  const isFarEnough = (tile) => {
    if (minDist <= 0 || minDistFrom.length === 0) return true;
    for (const avoid of minDistFrom) {
      if (!avoid) continue;
      if (manhattan(tile, avoid) < minDist) return false;
    }
    return true;
  };

  for (let i = 0; i < attempts; i++) {
    const room = candidateRooms[Math.floor(Math.random() * candidateRooms.length)];
    const tiles = Array.isArray(room?.tiles) ? room.tiles : null;
    if (!tiles || tiles.length === 0) continue;
    const t = tiles[Math.floor(Math.random() * tiles.length)];
    if (!t) continue;
    if (!ws.isWalkableWithMargin?.(t.x, t.y, margin)) continue;
    if (!isFarEnough(t)) continue;
    return { x: t.x, y: t.y };
  }

  return null;
}

export class SearchTask {
  constructor(options = {}) {
    this.name = 'search';
    this.roomTypes = Array.isArray(options.roomTypes) ? options.roomTypes.slice() : null;
    this.waypoints = clampInt(options.waypoints, 1, 50, 4);
    this.threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0;
    this.margin = Number.isFinite(options.margin) ? Math.max(0, options.margin) : 1;
    this.minDist = Number.isFinite(options.minDist) ? Math.max(0, options.minDist) : 3;
    this.minDistFrom = Array.isArray(options.minDistFrom) ? options.minDistFrom.slice() : [];
    this.attemptsPerWaypoint = clampInt(options.attemptsPerWaypoint, 20, 2000, 240);
    this.completeWhen = typeof options.completeWhen === 'function' ? options.completeWhen : null;
    this.abortWhen = typeof options.abortWhen === 'function' ? options.abortWhen : null;

    this.started = false;
    this.remaining = this.waypoints;
    this.moveTask = null;
  }

  start(ctx = null) {
    this.started = true;
    this.pickNextTarget(ctx);
  }

  pickNextTarget(ctx = null) {
    const ws = ctx?.worldState || ctx?.ws || null;
    const allowedRoomSet = buildAllowedRoomSet(this.roomTypes);

    const avoid = [];
    const agentGrid = typeof ctx?.getGridPos === 'function' ? ctx.getGridPos() : ctx?.gridPos;
    if (agentGrid) avoid.push(agentGrid);
    this.minDistFrom.forEach((p) => avoid.push(p));

    const target = pickRandomRoomTile(ws, allowedRoomSet, {
      margin: this.margin,
      minDist: this.minDist,
      minDistFrom: avoid,
      attempts: this.attemptsPerWaypoint
    });

    if (!target) {
      this.moveTask = null;
      return false;
    }

    this.moveTask = new MoveToTask(target, { threshold: this.threshold });
    this.moveTask.start(ctx);
    return true;
  }

  tick(dt, ctx = null) {
    void dt;
    if (this.abortWhen) {
      try {
        if (this.abortWhen(ctx)) return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      } catch {
        return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      }
    }

    if (this.completeWhen) {
      try {
        if (this.completeWhen(ctx)) return { status: TASK_STATUS.SUCCESS, intent: { type: 'complete' } };
      } catch {
        // ignore
      }
    }

    if (!this.moveTask) {
      const ok = this.pickNextTarget(ctx);
      if (!ok) return { status: TASK_STATUS.FAILED, intent: { type: 'search', message: 'No targets' } };
    }

    const res = this.moveTask.tick(dt, ctx);
    if (res?.status === TASK_STATUS.FAILED) return res;
    if (res?.status === TASK_STATUS.RUNNING) {
      return { ...res, intent: { ...(res.intent || {}), task: 'search' } };
    }

    this.remaining -= 1;
    if (this.remaining <= 0) {
      return { status: TASK_STATUS.SUCCESS, intent: { type: 'search', message: 'Done' } };
    }

    const ok = this.pickNextTarget(ctx);
    if (!ok) return { status: TASK_STATUS.FAILED, intent: { type: 'search', message: 'No targets' } };
    return { status: TASK_STATUS.RUNNING, intent: { type: 'search', message: 'Next' } };
  }
}

