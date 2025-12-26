import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';

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
    this.lastKnownPlayerGrid = null;
    this.desiredTarget = null;
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
    const dist = this.manhattan(monsterGrid, playerGrid);
    if (dist > this.visionRange) return false;

    if (this.followWhenHasLineOfSight && this.worldState?.hasLineOfSight) {
      return this.worldState.hasLineOfSight(monsterGrid, playerGrid);
    }

    return true;
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

  canHearPlayerDistance(monsterGrid, playerGrid) {
    if (!this.followWhenPlayerSprints) return false;
    if (!this.playerIsSprinting()) return false;
    const dist = this.manhattan(monsterGrid, playerGrid);
    return dist <= this.hearingRange;
  }

  updateDetection(monsterGrid, playerGrid) {
    const now = this.now();

    if (!playerGrid) {
      if (this.mode !== 'wander' && now - this.lastDetectedTime > this.memoryDuration) {
        this.mode = 'wander';
        this.lastKnownPlayerGrid = null;
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      return;
    }

    const saw = this.canSeePlayer(monsterGrid, playerGrid);
    const heardNoise = this.hasRecentUsefulNoise(now);
    const heardSprint = this.canHearPlayerDistance(monsterGrid, playerGrid);

    if (saw || heardNoise || heardSprint) {
      this.lastDetectedTime = now;

      if (saw) {
        this.lastKnownPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      } else if (heardNoise && this.lastHeardNoise?.grid) {
        this.lastKnownPlayerGrid = { x: this.lastHeardNoise.grid.x, y: this.lastHeardNoise.grid.y };
      } else {
        this.lastKnownPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      }

      if (this.mode !== 'follow') {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }

      this.mode = 'follow';
      return;
    }

    if (this.mode === 'follow' && now - this.lastDetectedTime > this.memoryDuration) {
      this.mode = 'wander';
      this.lastKnownPlayerGrid = null;
      this.currentPath = [];
      this.currentTarget = null;
      this.lastPlanTime = 0;
    }
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

