import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer as canSeePlayerGrid, wrapAngle } from '../components/perception/vision.js';

function toRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

function isFiniteNumber(v) {
  return Number.isFinite(Number(v));
}

/**
 * WeepingAngelBrain ("木頭人")
 * - If the player can see the monster (player camera FOV + LOS), it freezes completely.
 * - When not observed, it hunts the player using its own vision cone and recent noises.
 */
export class WeepingAngelBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.visionRange =
      config.visionRange ??
      monster?.visionRange ??
      12;

    this.memorySeconds =
      config.memorySeconds ??
      10.0;

    this.noiseMemorySeconds =
      config.noiseMemorySeconds ??
      (CONFIG.AI_NOISE_MEMORY ?? 2.0);

    this.scentMemorySeconds =
      config.scentMemorySeconds ??
      (CONFIG.AI_SCENT_MEMORY ?? 8.0);

    this.freezeRequiresLineOfSight =
      config.freezeRequiresLineOfSight ??
      true;

    this.freezeFovMarginRad =
      toRad(config.freezeFovMarginDeg ?? 6);

    this.freezeMaxDistance =
      isFiniteNumber(config.freezeMaxDistance)
        ? Math.max(0, Number(config.freezeMaxDistance))
        : Infinity;

    this.unseenSpeedMultiplier =
      config.unseenSpeedMultiplier ??
      2.0;

    this.wanderSpeedMultiplier =
      config.wanderSpeedMultiplier ??
      1.0;

    this.explorationSamples =
      config.explorationSamples ??
      30;

    this.minExploreDistance =
      config.minExploreDistance ??
      8;

    this.mode = 'wander'; // 'wander' | 'hunt'
    this.lastDetectedTime = 0;
    this.lastKnownPlayerGrid = null;
  }

  getMonsterYaw() {
    const fromGetter = this.monster?.getYaw?.();
    if (Number.isFinite(fromGetter)) return fromGetter;
    const fromField = this.monster?.yaw;
    return Number.isFinite(fromField) ? fromField : null;
  }

  getMonsterVisionFov() {
    const fromMonster = this.monster?.visionFOV;
    if (Number.isFinite(fromMonster)) return fromMonster;
    const fromType = this.monster?.typeConfig?.stats?.visionFOV;
    return Number.isFinite(fromType) ? fromType : null;
  }

  getPlayerTrueGridPosition() {
    if (!this.playerRef) return null;
    if (typeof this.playerRef.getGridPosition === 'function') {
      return this.playerRef.getGridPosition();
    }
    const pos = this.playerRef.position;
    if (!pos) return null;
    const tileSize = CONFIG.TILE_SIZE || 1;
    return { x: Math.floor(pos.x / tileSize), y: Math.floor(pos.z / tileSize) };
  }

  getPlayerViewYaw() {
    if (!this.playerRef) return null;
    const yaw = this.playerRef.getViewYaw?.() ?? null;
    if (Number.isFinite(yaw)) return yaw;
    return null;
  }

  getPlayerViewFovRad() {
    const fovDeg = this.playerRef?.getViewFovDeg?.() ?? (CONFIG.FOV ?? 75);
    const fov = toRad(fovDeg);
    return Number.isFinite(fov) ? fov : toRad(75);
  }

  playerCanSeeMonster(playerGrid, monsterGrid) {
    if (!playerGrid || !monsterGrid) return false;

    const dist = this.manhattan(playerGrid, monsterGrid);
    if (Number.isFinite(this.freezeMaxDistance) && dist > this.freezeMaxDistance) return false;

    if (this.freezeRequiresLineOfSight && this.worldState?.hasLineOfSight) {
      if (!this.worldState.hasLineOfSight(playerGrid, monsterGrid)) return false;
    }

    const playerYaw = this.getPlayerViewYaw();
    if (!Number.isFinite(playerYaw)) return false;

    const dx = monsterGrid.x - playerGrid.x;
    const dz = monsterGrid.y - playerGrid.y;
    if (dx === 0 && dz === 0) return true;

    const angleToMonster = Math.atan2(dx, dz);
    const delta = wrapAngle(angleToMonster - playerYaw);

    const halfFov = this.getPlayerViewFovRad() * 0.5;
    return Math.abs(delta) <= (halfFov + this.freezeFovMarginRad);
  }

  monsterCanSeePlayer(monsterGrid, playerGrid) {
    const yaw = this.getMonsterYaw();
    const visionFOV = this.getMonsterVisionFov();
    return canSeePlayerGrid(this.worldState, monsterGrid, playerGrid, this.visionRange, {
      monster: this.monster,
      monsterYaw: yaw,
      visionFOV,
      requireLineOfSight: true
    });
  }

  hasRecentNoise(now) {
    const noise = this.lastHeardNoise;
    if (!noise?.grid) return false;
    return now - (noise.heardAt || 0) <= this.noiseMemorySeconds;
  }

  hasRecentScent(now) {
    const scent = this.lastSmelledScent;
    if (!scent?.grid) return false;
    if (now - (scent.smelledAt || 0) > this.scentMemorySeconds) return false;
    const intensity = Number.isFinite(scent.intensity) ? scent.intensity : (Number.isFinite(scent.strength) ? scent.strength : 0);
    return intensity > 0.05;
  }

  updateTracking(monsterGrid) {
    const now = this.now();
    const playerGrid = this.getPlayerGridPosition(); // respects hiding

    const saw = playerGrid ? this.monsterCanSeePlayer(monsterGrid, playerGrid) : false;
    const heard = this.hasRecentNoise(now);
    const smelled = this.hasRecentScent(now);

    if (saw && playerGrid) {
      if (this.mode !== 'hunt') {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      this.mode = 'hunt';
      this.lastDetectedTime = now;
      this.lastKnownPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      return;
    }

    if (heard && this.lastHeardNoise?.grid) {
      if (this.mode !== 'hunt') {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      this.mode = 'hunt';
      this.lastDetectedTime = now;
      this.lastKnownPlayerGrid = { x: this.lastHeardNoise.grid.x, y: this.lastHeardNoise.grid.y };
      return;
    }

    if (smelled && this.lastSmelledScent?.grid) {
      if (this.mode !== 'hunt') {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      this.mode = 'hunt';
      this.lastDetectedTime = now;
      this.lastKnownPlayerGrid = { x: this.lastSmelledScent.grid.x, y: this.lastSmelledScent.grid.y };
      return;
    }

    if (this.mode === 'hunt' && now - this.lastDetectedTime > this.memorySeconds) {
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

      const score = dist * 0.9 + novelty * 16;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    if (best) return { x: best.x, y: best.y };
    const fallback = this.worldState.findRandomWalkableTile();
    return fallback ? { x: fallback.x, y: fallback.y } : { x: monsterGrid.x, y: monsterGrid.y };
  }

  pickTarget(monsterGrid) {
    if (this.mode === 'hunt' && this.lastKnownPlayerGrid) {
      return this.lastKnownPlayerGrid;
    }
    return this.pickWanderTarget(monsterGrid);
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.mode !== 'hunt') return false;
    return distToPlayer > 3;
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);

    // Freeze if the player can see us.
    const playerGridTrue = this.getPlayerTrueGridPosition();
    if (playerGridTrue && this.playerCanSeeMonster(playerGridTrue, monsterGrid)) {
      if (this.monster) {
        this.monster.speedMultiplier = 1.0;
      }
      // Do not rotate either; completely frozen.
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false, specialAction: 'frozen' };
    }

    this.updateTracking(monsterGrid);

    if (this.monster) {
      this.monster.speedMultiplier = this.mode === 'hunt'
        ? this.unseenSpeedMultiplier
        : this.wanderSpeedMultiplier;
    }

    this.plan(monsterGrid);

    const { move, targetGrid } = this.stepAlongPath(monsterGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    const distToTarget = this.currentTarget
      ? this.manhattan(monsterGrid, this.currentTarget)
      : Infinity;
    const playerGrid = this.getPlayerGridPosition();
    const distToPlayer = playerGrid
      ? this.manhattan(monsterGrid, playerGrid)
      : Infinity;

    const sprint = this.computeSprint(distToTarget, distToPlayer);
    return { move, lookYaw, sprint };
  }
}
