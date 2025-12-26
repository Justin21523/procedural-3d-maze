import { CONFIG } from '../../core/config.js';
import { manhattan } from './perception.js';

export class NoiseInvestigationModule {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.noiseMemorySeconds = options.noiseMemorySeconds ?? (CONFIG.AI_NOISE_MEMORY ?? 2.0);
    this.investigateTime = options.investigateTime ?? (CONFIG.AI_INVESTIGATE_TIME ?? 6.0);
    this.searchRadius = options.searchRadius ?? (CONFIG.AI_SEARCH_RADIUS ?? 4);
    this.visitTTL = options.visitTTL ?? (CONFIG.MONSTER_VISIT_TTL ?? 45_000);

    this.investigation = null;
  }

  reset() {
    this.investigation = null;
  }

  tick({
    now,
    monsterGrid,
    lastHeardNoise,
    isWalkableTile,
    visitedTiles,
    posKey
  }) {
    if (!this.enabled) return null;
    if (!monsterGrid) return null;
    if (typeof now !== 'number') return null;

    const noise = lastHeardNoise;
    const memory = this.noiseMemorySeconds;

    if (noise?.grid && (now - (noise.heardAt || 0)) <= memory) {
      const originGrid = noise.grid;
      const shouldRestart =
        !this.investigation ||
        (noise.priority || 0) > (this.investigation.priority || 0) ||
        (originGrid.x !== this.investigation.originGrid?.x || originGrid.y !== this.investigation.originGrid?.y);

      if (shouldRestart) {
        this.investigation = {
          originGrid: { x: originGrid.x, y: originGrid.y },
          phase: 'travel',
          targetGrid: { x: originGrid.x, y: originGrid.y },
          nextPickTime: 0,
          until: now + this.investigateTime,
          priority: noise.priority || 0,
          searchRadius: this.searchRadius
        };
      }
    }

    const inv = this.investigation;
    if (!inv) return null;
    if (now > inv.until) {
      this.investigation = null;
      return null;
    }

    const distToOrigin = manhattan(monsterGrid, inv.originGrid);
    if (inv.phase === 'travel' && distToOrigin <= 1) {
      inv.phase = 'search';
      inv.targetGrid = null;
      inv.nextPickTime = 0;
    }

    if (inv.phase === 'search') {
      const distToTarget = inv.targetGrid ? manhattan(monsterGrid, inv.targetGrid) : Infinity;
      if (!inv.targetGrid || distToTarget <= 1 || now >= (inv.nextPickTime || 0)) {
        inv.targetGrid = this.pickSearchTarget(monsterGrid, inv.originGrid, inv.searchRadius, {
          isWalkableTile,
          visitedTiles,
          posKey
        });
        inv.nextPickTime = now + 1.2;
      }
    }

    return inv.targetGrid || inv.originGrid;
  }

  pickSearchTarget(monsterGrid, originGrid, radius, { isWalkableTile, visitedTiles, posKey }) {
    if (!originGrid || !monsterGrid) return originGrid;
    if (typeof isWalkableTile !== 'function') return originGrid;

    const r = Math.max(1, Math.min(8, radius || 4));
    const now = Date.now();
    let best = null;

    for (let i = 0; i < 18; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * r);
      const dy = Math.floor((Math.random() * 2 - 1) * r);
      const x = originGrid.x + dx;
      const y = originGrid.y + dy;
      if (!isWalkableTile(x, y)) continue;

      const dist = manhattan(monsterGrid, { x, y });

      let novelty = 1.0;
      if (visitedTiles && typeof visitedTiles.get === 'function' && typeof posKey === 'function') {
        const key = posKey({ x, y });
        const lastVisit = visitedTiles.get(key);
        if (lastVisit) {
          const age = now - lastVisit;
          novelty = Math.max(0, Math.min(1, age / (this.visitTTL || 45_000)));
        }
      }

      const score = dist * 1.1 + novelty * 14 + Math.random() * 2;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : { x: originGrid.x, y: originGrid.y };
  }
}

