import { CONFIG } from '../../../core/config.js';

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function countWalkableNeighbors(isWalkableTile, x, y) {
  if (typeof isWalkableTile !== 'function') return 0;
  let count = 0;
  if (isWalkableTile(x + 1, y)) count++;
  if (isWalkableTile(x - 1, y)) count++;
  if (isWalkableTile(x, y + 1)) count++;
  if (isWalkableTile(x, y - 1)) count++;
  return count;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeDir(dir) {
  const dx = Number(dir?.x) || 0;
  const dy = Number(dir?.y) || 0;
  const len = Math.hypot(dx, dy) || 0;
  if (len <= 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * SearchModule
 * A reusable local search helper (used after losing target).
 * - Prefers junctions/branch tiles
 * - Avoids recently visited tiles (when visitedTiles/posKey provided)
 * - Supports a preferred direction bias (last seen direction)
 */
export class SearchModule {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.defaultRadius =
      clampInt(options.radius ?? (CONFIG.AI_SEARCH_RADIUS ?? 4), 1, 16, 4);
    this.repickSeconds =
      Number.isFinite(options.repickSeconds) ? Math.max(0.2, options.repickSeconds) : 1.05;
    this.visitTTL =
      options.visitTTL ?? (CONFIG.MONSTER_VISIT_TTL ?? 45_000);

    this.plan = null;
  }

  reset() {
    this.plan = null;
  }

  begin(originGrid, options = {}) {
    if (!originGrid) return false;
    const radius = clampInt(options.radius ?? this.defaultRadius, 1, 32, this.defaultRadius);
    const preferredDir = normalizeDir(options.preferredDir);
    this.plan = {
      originGrid: { x: originGrid.x, y: originGrid.y },
      radius,
      preferredDir,
      queue: [],
      index: 0,
      nextPickAt: 0,
      targetGrid: null
    };
    return true;
  }

  buildQueue(originGrid, radius, preferredDir, { isWalkableTile } = {}) {
    const origin = originGrid || null;
    if (!origin) return [];
    const r = clampInt(radius, 1, 32, 4);
    const candidates = [];

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= 0 || dist > r) continue;
        const x = origin.x + dx;
        const y = origin.y + dy;
        if (typeof isWalkableTile === 'function' && !isWalkableTile(x, y)) continue;

        const degree = countWalkableNeighbors(isWalkableTile, x, y);
        const isJunction = degree >= 3;
        const dirScore = preferredDir ? (dx * preferredDir.x + dy * preferredDir.y) : 0;
        candidates.push({ x, y, dist, degree, isJunction, dirScore });
      }
    }

    candidates.sort((a, b) => {
      if (a.isJunction !== b.isJunction) return a.isJunction ? -1 : 1;
      if (Math.abs(a.dirScore - b.dirScore) > 1e-6) return b.dirScore - a.dirScore;
      if (a.degree !== b.degree) return b.degree - a.degree;
      return b.dist - a.dist;
    });

    return candidates.map((c) => ({ x: c.x, y: c.y }));
  }

  tick({ now, monsterGrid, originGrid, preferredDir, radius, isWalkableTile, visitedTiles, posKey } = {}) {
    if (!this.enabled) return null;
    if (!monsterGrid) return null;
    if (typeof now !== 'number') return null;

    if (originGrid) {
      if (!this.plan || !this.plan.originGrid || this.plan.originGrid.x !== originGrid.x || this.plan.originGrid.y !== originGrid.y) {
        this.begin(originGrid, { radius, preferredDir });
      } else if (preferredDir) {
        this.plan.preferredDir = normalizeDir(preferredDir);
      }
    }

    const plan = this.plan;
    if (!plan?.originGrid) return null;

    if (!plan.queue || plan.queue.length === 0) {
      plan.queue = this.buildQueue(plan.originGrid, plan.radius, plan.preferredDir, { isWalkableTile });
      plan.index = 0;
    }

    const shouldPick =
      !plan.targetGrid ||
      manhattan(monsterGrid, plan.targetGrid) <= 1 ||
      now >= (plan.nextPickAt || 0);

    if (shouldPick) {
      plan.nextPickAt = now + this.repickSeconds;

      const len = plan.queue.length || 0;
      const nowMs = Date.now();
      const expireMs = nowMs - (this.visitTTL || 45_000);

      let picked = null;
      for (let i = 0; i < Math.max(1, len); i++) {
        const idx = (plan.index + i) % Math.max(1, len);
        const t = plan.queue[idx] || null;
        if (!t) continue;
        if (typeof isWalkableTile === 'function' && !isWalkableTile(t.x, t.y)) continue;

        if (visitedTiles && typeof visitedTiles.get === 'function' && typeof posKey === 'function') {
          const key = posKey({ x: t.x, y: t.y });
          const last = visitedTiles.get(key);
          if (last && last > expireMs) continue;
        }

        picked = { x: t.x, y: t.y };
        plan.index = (idx + 1) % Math.max(1, len);
        break;
      }

      if (!picked) {
        plan.queue = this.buildQueue(plan.originGrid, plan.radius, plan.preferredDir, { isWalkableTile });
        plan.index = 0;
        picked = plan.queue?.[0] || plan.originGrid;
      }

      plan.targetGrid = picked ? { x: picked.x, y: picked.y } : { x: plan.originGrid.x, y: plan.originGrid.y };
    }

    return plan.targetGrid || plan.originGrid;
  }
}
