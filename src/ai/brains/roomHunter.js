import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer } from '../components/perception/vision.js';
import { NoiseInvestigationModule } from '../components/perception/noiseInvestigation.js';
import { FlankCoverTactics } from '../components/tactics/flankCoverTactics.js';

/**
 * RoomHunterBrain
 * - Stays inside a home room/region and patrols.
 * - If player enters vision range & (optionally) line of sight, it chases.
 * - Loses interest after chaseTimeout without seeing the player, then returns home.
 */
export class RoomHunterBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    const startGrid = this.getMonsterGridPosition();

    this.homeCenter =
      config.homeCenter ||
      monster.homeCenter ||
      { x: startGrid.x, y: startGrid.y };

    this.homeRadius =
      config.homeRadius ??
      monster.homeRadius ??
      7;

    this.visionRange =
      config.visionRange ??
      monster.visionRange ??
      12;

    this.chaseTimeout =
      config.chaseTimeout ??
      6.0;

    this.explorationSamples =
      config.explorationSamples ??
      CONFIG.AUTOPILOT_EXPLORE_SAMPLES ??
      80;

    this.state = 'patrol'; // 'patrol' | 'chase' | 'returning'
    this.targetType = 'patrol';
    this.lastSeenPlayerTime = 0;
    this.lastKnownPlayerGrid = null;
    this.lastKnownPlayerTime = 0;
    this.lostSearch = null;

    this.investigationModule = new NoiseInvestigationModule({
      enabled: config.investigateEnabled ?? true,
      noiseMemorySeconds: config.noiseMemorySeconds,
      investigateTime: config.investigateTime,
      searchRadius: config.searchRadius,
      visitTTL: this.visitTTL
    });

    this.tactics = new FlankCoverTactics(worldState, monster, config.tactics || {});
  }

  updateLastKnown(grid, now) {
    if (!grid || !Number.isFinite(grid.x) || !Number.isFinite(grid.y)) return;
    this.lastKnownPlayerGrid = { x: grid.x, y: grid.y };
    this.lastKnownPlayerTime = Number.isFinite(now) ? now : this.now();
    this.lostSearch = null;
  }

  hasRecentNoise(now) {
    const noise = this.lastHeardNoise;
    if (!noise?.grid) return false;
    const memory = this.config.noiseMemorySeconds ?? (CONFIG.AI_NOISE_MEMORY ?? 2.0);
    return now - (noise.heardAt || 0) <= memory;
  }

  hasRecentScent(now) {
    const scent = this.lastSmelledScent;
    if (!scent?.grid) return false;
    const memory = this.config.scentMemorySeconds ?? (CONFIG.AI_SCENT_MEMORY ?? 8.0);
    if (now - (scent.smelledAt || 0) > memory) return false;
    const intensity = Number.isFinite(scent.intensity) ? scent.intensity : (Number.isFinite(scent.strength) ? scent.strength : 0);
    return intensity > 0.05;
  }

  tickLostSearch(now, monsterGrid) {
    const inv = this.lostSearch;
    if (!inv?.originGrid || !monsterGrid) return null;
    if (now > inv.until) {
      this.lostSearch = null;
      return null;
    }

    const origin = inv.originGrid;
    const distToTarget = inv.targetGrid ? this.manhattan(monsterGrid, inv.targetGrid) : Infinity;
    if (!inv.targetGrid || distToTarget <= 1 || now >= (inv.nextPickTime || 0)) {
      inv.targetGrid = this.pickLocalSearchTarget(monsterGrid, origin, inv.searchRadius || 4);
      inv.nextPickTime = now + 1.2;
    }
    return inv.targetGrid || origin;
  }

  pickLocalSearchTarget(monsterGrid, originGrid, radius) {
    if (!originGrid || !monsterGrid) return originGrid;
    if (typeof this.isWalkableTile !== 'function') return originGrid;

    const r = Math.max(1, Math.min(8, Math.round(Number(radius) || 4)));
    const nowMs = Date.now();
    let best = null;

    for (let i = 0; i < 18; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * r);
      const dy = Math.floor((Math.random() * 2 - 1) * r);
      const x = originGrid.x + dx;
      const y = originGrid.y + dy;
      if (!this.isWalkableTile(x, y)) continue;

      const dist = this.manhattan(monsterGrid, { x, y });

      let novelty = 1.0;
      const key = this.posKey({ x, y });
      const lastVisit = this.visitedTiles.get(key);
      if (lastVisit) {
        const age = nowMs - lastVisit;
        novelty = Math.max(0, Math.min(1, age / (this.visitTTL || 45_000)));
      }

      const score = dist * 1.1 + novelty * 14 + Math.random() * 2;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : { x: originGrid.x, y: originGrid.y };
  }

  /**
   * Patrol target: exploration-style picking but restricted to home region
   */
  pickPatrolTarget(monsterGrid) {
    // Prefer explicit tiles if provided
    const tiles =
      this.config.homeTiles ||
      this.monster.homeTiles;

    const pickRandomHomeTile = () => {
      if (Array.isArray(tiles) && tiles.length > 0) {
        const t = tiles[Math.floor(Math.random() * tiles.length)];
        return { x: t.x, y: t.y };
      }

      if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
        return { x: this.homeCenter.x, y: this.homeCenter.y };
      }

      for (let i = 0; i < 40; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;
        const d = this.manhattan(tile, this.homeCenter);
        if (d <= this.homeRadius) {
          return { x: tile.x, y: tile.y };
        }
      }

      return { x: this.homeCenter.x, y: this.homeCenter.y };
    };

    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return pickRandomHomeTile();
    }

    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = pickRandomHomeTile();
      if (!tile) continue;

      const dist = this.manhattan(monsterGrid, tile);
      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);

      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      const score = dist * 0.8 + novelty * 20;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    if (!best) {
      return pickRandomHomeTile();
    }
    return { x: best.x, y: best.y };
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();
    const now = this.now();

    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange, { monsterYaw: yaw, visionFOV, monster: this.monster })
      : false;

    if (canSee && playerGrid) {
      this.lastSeenPlayerTime = now;
      this.updateLastKnown(playerGrid, now);
      this.state = 'chase';
      this.investigationModule.reset();
    } else if (this.state === 'chase') {
      const hasNoise = this.hasRecentNoise(now);
      const noise = this.lastHeardNoise;
      if (hasNoise && noise?.grid) {
        if ((noise.priority || 0) >= 2) {
          this.lastSeenPlayerTime = now;
        }
        this.updateLastKnown(noise.grid, now);
      }

      const hasScent = this.hasRecentScent(now);
      const scent = this.lastSmelledScent;
      if (hasScent && scent?.grid) {
        this.lastSeenPlayerTime = now;
        this.updateLastKnown(scent.grid, now);
      }

      if (now - this.lastSeenPlayerTime > this.chaseTimeout) {
        this.state = 'returning';
        this.tactics.reset();
        this.investigationModule.reset();
        this.lostSearch = null;
      }
    } else {
      const noise = this.lastHeardNoise;
      const hasNoise = this.hasRecentNoise(now);
      if (hasNoise && noise?.grid && (noise.priority || 0) >= 2) {
        this.lastSeenPlayerTime = now;
        this.updateLastKnown(noise.grid, now);
        this.state = 'chase';
        this.tactics.reset();
      } else {
        const scent = this.lastSmelledScent;
        const hasScent = this.hasRecentScent(now);
        if (hasScent && scent?.grid) {
          this.lastSeenPlayerTime = now;
          this.updateLastKnown(scent.grid, now);
          this.state = 'chase';
          this.tactics.reset();
        }
      }
    }

    if (this.state === 'returning') {
      const distHome = this.manhattan(monsterGrid, this.homeCenter);
      if (distHome <= 1) {
        this.state = 'patrol';
      }
    }

    if (this.state === 'chase') {
      if (canSee) {
        this.lostSearch = null;
        const tactic = this.tactics.tick({
          now,
          monsterGrid,
          playerGrid,
          isWalkableTile: (x, y) => this.isWalkableTile(x, y)
        });
        this.targetType = tactic.mode === 'cover' ? 'cover' : (tactic.mode === 'flank' ? 'flank' : 'chase');
        return tactic.targetGrid || playerGrid || this.lastKnownPlayerGrid || this.homeCenter;
      }

      // Lost sight: investigate noises if available, otherwise go to last known player tile.
      const invTarget = this.investigationModule.tick({
        now,
        monsterGrid,
        lastHeardNoise: this.lastHeardNoise,
        isWalkableTile: (x, y) => this.isWalkableTile(x, y),
        visitedTiles: this.visitedTiles,
        posKey: (pos) => this.posKey(pos)
      });

      if (invTarget) {
        this.targetType = 'investigate';
        return invTarget;
      }

      const scent = this.lastSmelledScent;
      if (this.hasRecentScent(now) && scent?.grid) {
        this.targetType = 'scent';
        return scent.grid;
      }

      const lastKnown = this.lastKnownPlayerGrid;
      if (lastKnown) {
        const dist = this.manhattan(monsterGrid, lastKnown);
        if (dist <= 1 && !this.lostSearch) {
          const searchRadius = this.config.lostSearchRadius ?? this.config.searchRadius ?? (CONFIG.AI_SEARCH_RADIUS ?? 4);
          const searchTime = this.config.lostSearchTime ?? this.config.investigateTime ?? (CONFIG.AI_INVESTIGATE_TIME ?? 6.0);
          this.lostSearch = {
            originGrid: { x: lastKnown.x, y: lastKnown.y },
            until: now + Math.max(0.5, Number(searchTime) || 6.0),
            nextPickTime: 0,
            targetGrid: null,
            searchRadius
          };
        }

        const searchTarget = this.tickLostSearch(now, monsterGrid);
        if (searchTarget) {
          this.targetType = 'search';
          return searchTarget;
        }

        this.targetType = 'lastKnown';
        return lastKnown;
      }

      this.targetType = 'returning';
      this.state = 'returning';
      return this.homeCenter;
    }

    if (this.state === 'returning') {
      this.targetType = 'returning';
      return this.homeCenter;
    }

    this.state = 'patrol';
    this.targetType = 'patrol';
    return this.pickPatrolTarget(monsterGrid);
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.targetType === 'chase' || this.targetType === 'flank' || this.targetType === 'investigate') {
      return distToPlayer > 3;
    }
    return false;
  }

  tick(deltaTime) {
    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const now = this.now();
    const monsterGrid = this.getMonsterGridPosition();
    const playerGrid = this.getPlayerGridPosition();

    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange, { monsterYaw: yaw, visionFOV, monster: this.monster })
      : false;

    if (this.state === 'chase' && canSee && playerGrid) {
      const tactic = this.tactics.tick({
        now,
        monsterGrid,
        playerGrid,
        isWalkableTile: (x, y) => this.isWalkableTile(x, y)
      });
      if (tactic.holdPosition) {
        this.recordVisit(monsterGrid);
        return { move: { x: 0, y: 0 }, lookYaw: this.computeLookYawToPlayer(), sprint: false };
      }
    }

    return super.tick(deltaTime);
  }
}
