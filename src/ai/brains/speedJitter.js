import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer as canSeePlayerGrid } from '../components/perception/vision.js';

/**
 * SpeedJitterBrain
 * - Alternates between slow and sprint phases (e.g. 3s slow, 1s sprint).
 * - Optionally chases the player while in range.
 * - Uses BaseMonsterBrain's path logic to avoid jitter and wall-sticking.
 */
export class SpeedJitterBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.speedPhase = 'slow'; // 'slow' | 'sprint'
    this.slowDuration =
      config.slowDuration ??
      3.0;

    this.sprintDuration =
      config.sprintDuration ??
      1.0;

    this.sprintMultiplier =
      config.sprintMultiplier ??
      2.0;

    this.phaseTimer = this.slowDuration;

    this.visionRange =
      config.visionRange ??
      monster.visionRange ??
      12;

    this.followPlayer =
      config.followPlayer ??
      true;

    this.mode = 'wander';
  }

  updatePhase(deltaTime) {
    this.phaseTimer -= deltaTime;
    if (this.phaseTimer <= 0) {
      if (this.speedPhase === 'slow') {
        this.speedPhase = 'sprint';
        this.phaseTimer = this.sprintDuration;
      } else {
        this.speedPhase = 'slow';
        this.phaseTimer = this.slowDuration;
      }
    }
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();

    if (this.followPlayer && playerGrid) {
      const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
      const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
      const canSee = canSeePlayerGrid(this.worldState, monsterGrid, playerGrid, this.visionRange, {
        monster: this.monster,
        monsterYaw: yaw,
        visionFOV,
        requireLineOfSight: true
      });
      if (canSee) {
        this.mode = 'chase';
        return playerGrid;
      }
    }

    this.mode = 'wander';

    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      return this.worldState.findRandomWalkableTile();
    }
    return monsterGrid;
  }

  tick(deltaTime) {
    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    this.updatePhase(deltaTime ?? 0);

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);
    this.plan(monsterGrid);

    const { move, targetGrid } = this.stepAlongPath(monsterGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    const isFast = this.speedPhase === 'sprint';
    if (this.monster) {
      this.monster.speedMultiplier = isFast ? this.sprintMultiplier : 1.0;
    }

    return { move, lookYaw, sprint: false };
  }
}
