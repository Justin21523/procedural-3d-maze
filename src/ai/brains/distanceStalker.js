import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer as canSeePlayerGrid } from '../components/perception/vision.js';
import { SearchModule } from '../components/perception/search.js';

/**
 * DistanceStalkerBrain
 * - Follows the player, but tries to maintain a preferred distance (followDistance).
 * - Detection uses vision + recent noise (preferred) with a fallback to "player sprinting".
 */
export class DistanceStalkerBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.visionRange =
      config.visionRange ??
      monster.visionRange ??
      12;

    this.hearingRange =
      config.hearingRange ??
      monster.stats?.hearingRange ??
      8;

    this.followDistance =
      config.followDistance ??
      8;

    this.distanceTolerance =
      config.distanceTolerance ??
      1;

    this.memoryDuration =
      config.memoryDuration ??
      6.0;

    this.followWhenPlayerSprints =
      config.followWhenPlayerSprints ??
      true;

    this.followWhenHasLineOfSight =
      config.followWhenHasLineOfSight ??
      true;

    this.noiseMemorySeconds =
      config.noiseMemorySeconds ??
      (CONFIG.AI_NOISE_MEMORY ?? 2.0);

    this.scentMemorySeconds =
      config.scentMemorySeconds ??
      (CONFIG.AI_SCENT_MEMORY ?? 8.0);

    this.planInterval =
      config.planInterval ??
      0.45;

    this.explorationSamples =
      config.explorationSamples ??
      40;

    this.minExploreDistance =
      config.minExploreDistance ??
      10;

    this.mode = 'wander'; // 'wander' | 'follow'
    this.lastDetectedTime = 0;
    this.lastSeenPlayerGrid = null;
    this.lastSeenDir = null;
    this.lastKnownPlayerGrid = null;
    this.desiredTarget = null;

    // Search after losing contact
    this.searchUntil = 0;
    this.searchStartedAt = 0;
    this.searchSweepBaseDir = null;
    this.searchRadius =
      config.searchRadius ??
      (CONFIG.AI_SEARCH_RADIUS ?? 4);
    this.searchDurationSeconds =
      config.searchDurationSeconds ??
      (CONFIG.AI_SEARCH_SECONDS ?? 7.0);
    this.searchModule = new SearchModule({
      enabled: true,
      radius: this.searchRadius,
      repickSeconds: 1.05,
      visitTTL: this.visitTTL
    });
  }

  playerIsSprinting() {
    if (!this.playerRef) return false;
    if (typeof this.playerRef.isSprinting === 'function') {
      return this.playerRef.isSprinting();
    }
    const input = this.playerRef.input;
    if (input && typeof input.isSprinting === 'function') {
      return input.isSprinting();
    }
    return false;
  }

  canSeePlayer(monsterGrid, playerGrid) {
    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    return canSeePlayerGrid(this.worldState, monsterGrid, playerGrid, this.visionRange, {
      monster: this.monster,
      monsterYaw: yaw,
      visionFOV,
      requireLineOfSight: this.followWhenHasLineOfSight
    });
  }

  hasRecentUsefulNoise(now) {
    if (!this.followWhenPlayerSprints) return false;
    const noise = this.lastHeardNoise;
    if (!noise?.grid) return false;
    if (now - (noise.heardAt || 0) > this.noiseMemorySeconds) return false;

    const kind = String(noise.kind || '').toLowerCase();
    const priority = noise.priority || 0;
    const isSprint = kind.includes('sprint');
    const isLoud = priority >= 2 || kind.includes('gun') || kind.includes('alert');
    return isLoud || isSprint;
  }

  hasRecentScent(now) {
    const scent = this.lastSmelledScent;
    if (!scent?.grid) return false;
    if (now - (scent.smelledAt || 0) > this.scentMemorySeconds) return false;
    const intensity = Number.isFinite(scent.intensity) ? scent.intensity : (Number.isFinite(scent.strength) ? scent.strength : 0);
    return intensity > 0.05;
  }

  canHearPlayerDistance(monsterGrid, playerGrid) {
    if (!this.followWhenPlayerSprints) return false;
    if (!this.playerIsSprinting()) return false;
    const dist = this.manhattan(monsterGrid, playerGrid);
    return dist <= this.hearingRange;
  }

  updateDetection(monsterGrid, playerGrid) {
    const now = this.now();
    const smelled = this.hasRecentScent(now);
    const suppressed = this.monster?.aiChaseSuppressed === true;

    if (!playerGrid) {
      if (smelled && this.lastSmelledScent?.grid) {
        this.lastDetectedTime = now;
        this.lastKnownPlayerGrid = { x: this.lastSmelledScent.grid.x, y: this.lastSmelledScent.grid.y };
        if (this.mode !== 'follow') {
          this.currentPath = [];
          this.currentTarget = null;
          this.lastPlanTime = 0;
        }
        this.mode = suppressed ? 'search' : 'follow';
        if (suppressed) {
          this.beginSearch(this.lastKnownPlayerGrid, now, { durationSeconds: Math.min(3.5, this.searchDurationSeconds) });
        }
        return;
      }
      if (this.mode === 'follow' && now - this.lastDetectedTime > this.memoryDuration) {
        if (this.lastKnownPlayerGrid) {
          this.beginSearch(this.lastKnownPlayerGrid, now);
          this.mode = 'search';
        } else {
          this.mode = 'wander';
        }
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      if (this.mode === 'search' && now > (this.searchUntil || 0)) {
        this.mode = 'wander';
        this.lastKnownPlayerGrid = null;
        this.searchModule?.reset?.();
      }
      return;
    }

    const saw = this.canSeePlayer(monsterGrid, playerGrid);
    const heardNoise = this.hasRecentUsefulNoise(now);
    const heardSprint = this.canHearPlayerDistance(monsterGrid, playerGrid);

    if (saw || heardNoise || heardSprint || smelled) {
      this.lastDetectedTime = now;

      if (saw) {
        if (this.lastSeenPlayerGrid && (playerGrid.x !== this.lastSeenPlayerGrid.x || playerGrid.y !== this.lastSeenPlayerGrid.y)) {
          const dx = Math.sign(playerGrid.x - this.lastSeenPlayerGrid.x);
          const dy = Math.sign(playerGrid.y - this.lastSeenPlayerGrid.y);
          if (dx !== 0 || dy !== 0) this.lastSeenDir = { x: dx, y: dy };
        }
        this.lastSeenPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
        this.lastKnownPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      } else if (heardNoise && this.lastHeardNoise?.grid) {
        this.lastKnownPlayerGrid = { x: this.lastHeardNoise.grid.x, y: this.lastHeardNoise.grid.y };
      } else if (smelled && this.lastSmelledScent?.grid) {
        this.lastKnownPlayerGrid = { x: this.lastSmelledScent.grid.x, y: this.lastSmelledScent.grid.y };
      } else {
        this.lastKnownPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      }

      if (this.mode !== 'follow') {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }

      if (suppressed) {
        this.mode = 'search';
        this.beginSearch(this.lastKnownPlayerGrid, now, { durationSeconds: Math.min(3.5, this.searchDurationSeconds) });
      } else {
        this.mode = 'follow';
      }
      return;
    }

    if (this.mode === 'follow' && now - this.lastDetectedTime > this.memoryDuration) {
      if (this.lastKnownPlayerGrid) {
        this.beginSearch(this.lastKnownPlayerGrid, now);
        this.mode = 'search';
      } else {
        this.mode = 'wander';
      }
      this.currentPath = [];
      this.currentTarget = null;
      this.lastPlanTime = 0;
    }

    if (this.mode === 'search' && now > (this.searchUntil || 0)) {
      this.mode = 'wander';
      this.lastKnownPlayerGrid = null;
      this.searchModule?.reset?.();
      this.currentPath = [];
      this.currentTarget = null;
      this.lastPlanTime = 0;
    }
  }

  beginSearch(originGrid, now, options = {}) {
    if (!originGrid) return;
    const t = Number.isFinite(now) ? now : this.now();
    const radius = Math.max(1, Math.min(10, Math.round(Number(options.radius ?? this.searchRadius) || 4)));
    const preferredDir = options.preferredDir ?? this.lastSeenDir ?? null;
    this.searchModule?.begin?.(originGrid, { radius, preferredDir });
    this.searchStartedAt = t;
    this.searchSweepBaseDir = preferredDir ? { x: Number(preferredDir.x) || 0, y: Number(preferredDir.y) || 0 } : null;
    const dur = Math.max(0.5, Number(options.durationSeconds ?? this.searchDurationSeconds) || 7.0);
    this.searchUntil = Math.max(this.searchUntil || 0, t + dur);
  }

  getSearchSweepDir(now) {
    const base = this.searchSweepBaseDir || this.lastSeenDir || null;
    if (!base) return null;
    const dx = Math.sign(Number(base.x) || 0);
    const dy = Math.sign(Number(base.y) || 0);
    if (dx === 0 && dy === 0) return null;
    const elapsed = Math.max(0, now - (this.searchStartedAt || now));
    if (elapsed < 1.2) return { x: dx, y: dy };
    if (elapsed < 2.4) return { x: -dy, y: dx };
    if (elapsed < 3.6) return { x: dy, y: -dx };
    return { x: -dx, y: -dy };
  }

  tickSearch(monsterGrid, now) {
    return this.searchModule?.tick?.({
      now,
      monsterGrid,
      originGrid: this.searchModule?.plan?.originGrid || null,
      preferredDir: this.getSearchSweepDir(now) || null,
      radius: this.searchRadius,
      isWalkableTile: (x, y) => this.isWalkableTile(x, y),
      visitedTiles: this.visitedTiles,
      posKey: (pos) => this.posKey(pos)
    }) ?? null;
  }

  pickWanderTarget(monsterGrid) {
    if (!this.worldState?.findRandomWalkableTile) {
      return { x: monsterGrid.x, y: monsterGrid.y };
    }

    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const dist = this.manhattan(monsterGrid, tile);
      if (dist < this.minExploreDistance) continue;

      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);
      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      const score = dist * 0.8 + novelty * 18;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    if (best) {
      return { x: best.x, y: best.y };
    }

    const fallback = this.worldState.findRandomWalkableTile();
    return fallback ? { x: fallback.x, y: fallback.y } : { x: monsterGrid.x, y: monsterGrid.y };
  }

  pickRingTargetAroundPlayer(playerGrid, monsterGrid, minD, maxD) {
    let best = null;

    for (let r = minD; r <= maxD; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < minD || dist > maxD) continue;

          const x = playerGrid.x + dx;
          const y = playerGrid.y + dy;

          if (!this.isWalkableTile(x, y)) continue;

          const dFromMonster = this.manhattan(monsterGrid, { x, y });
          const score = -dFromMonster;
          if (!best || score > best.score) {
            best = { x, y, score };
          }
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  pickFollowTarget(monsterGrid, playerGrid) {
    const lastKnown = this.lastKnownPlayerGrid;
    const anchor = playerGrid || lastKnown;
    if (!anchor) return null;

    const distToPlayer = this.manhattan(monsterGrid, anchor);
    const desired = this.followDistance;
    const tol = this.distanceTolerance;

    if (distToPlayer < desired - tol) {
      return this.pickRingTargetAroundPlayer(
        anchor,
        monsterGrid,
        desired + tol,
        desired + tol + 2
      ) || anchor;
    }

    if (distToPlayer > desired + tol) {
      return this.pickRingTargetAroundPlayer(
        anchor,
        monsterGrid,
        Math.max(1, desired - tol),
        desired + tol
      ) || anchor;
    }

    return null;
  }

  pickTarget(monsterGrid) {
    if (this.desiredTarget !== null) {
      return this.desiredTarget;
    }

    if (this.mode === 'follow') {
      return this.lastKnownPlayerGrid;
    }

    if (this.mode === 'search') {
      const now = this.now();
      if (now > (this.searchUntil || 0)) {
        this.mode = 'wander';
        this.searchModule?.reset?.();
        return this.pickWanderTarget(monsterGrid);
      }
      const t = this.tickSearch(monsterGrid, now);
      if (t) return t;
    }

    return this.pickWanderTarget(monsterGrid);
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.mode !== 'follow') return false;
    return distToPlayer > this.followDistance + this.distanceTolerance + 3;
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);

    const playerGrid = this.getPlayerGridPosition();
    this.updateDetection(monsterGrid, playerGrid);

    if (this.mode === 'search') {
      this.desiredTarget = this.pickTarget(monsterGrid);
      this.plan(monsterGrid);
      this.desiredTarget = null;
      const { move, targetGrid } = this.stepAlongPath(monsterGrid);
      const now = this.now();
      const lookJitter = Math.sin((now || 0) * 2.2) * 0.04;
      const lookYaw = this.computeLookYawToGrid(targetGrid) + lookJitter;
      return { move, lookYaw, sprint: false };
    }

    const followTarget = this.mode === 'follow'
      ? this.pickFollowTarget(monsterGrid, playerGrid)
      : null;

    if (this.mode === 'follow' && !followTarget) {
      this.currentPath = [];
      this.currentTarget = null;
      const lookYaw = playerGrid ? this.computeLookYawToPlayer() : 0;
      return { move: { x: 0, y: 0 }, lookYaw, sprint: false };
    }

    this.desiredTarget = followTarget || this.pickWanderTarget(monsterGrid);
    this.plan(monsterGrid);
    this.desiredTarget = null;

    const { move, targetGrid } = this.stepAlongPath(monsterGrid);
    const lookYaw = (this.mode === 'follow' && playerGrid)
      ? this.computeLookYawToPlayer()
      : this.computeLookYawToGrid(targetGrid);

    const distToTarget = this.currentTarget
      ? this.manhattan(monsterGrid, this.currentTarget)
      : Infinity;
    const distToPlayer = playerGrid
      ? this.manhattan(monsterGrid, playerGrid)
      : Infinity;

    const sprint = this.computeSprint(distToTarget, distToPlayer);

    return { move, lookYaw, sprint };
  }
}
