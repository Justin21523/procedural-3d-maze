import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';

/**
 * CorridorGuardianBrain
 * - Only walks along a predefined corridor path.
 * - Patrols back and forth between corridor ends.
 * - If the player enters the same corridor, it chases along the corridor,
 *   but never leaves corridor tiles.
 */
export class CorridorGuardianBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.corridorPath =
      config.corridorPath ||
      monster.corridorPath ||
      [];

    this.state = 'patrol'; // 'patrol' | 'chase'
    this.patrolDirection = 1; // 1: towards end, -1: towards start

    this.planInterval =
      config.planInterval ??
      CONFIG.CORRIDOR_GUARDIAN_REPLAN_INTERVAL ??
      0.4;
  }

  indexOfCorridorTile(pos) {
    if (!this.corridorPath || this.corridorPath.length === 0) return -1;
    for (let i = 0; i < this.corridorPath.length; i++) {
      const t = this.corridorPath[i];
      if (t.x === pos.x && t.y === pos.y) return i;
    }
    return -1;
  }

  nearestCorridorIndex(pos) {
    if (!this.corridorPath || this.corridorPath.length === 0) return -1;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.corridorPath.length; i++) {
      const t = this.corridorPath[i];
      const dist = this.manhattan(pos, t);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  buildPathBetweenIndices(startIndex, endIndex) {
    const path = [];
    if (!this.corridorPath || this.corridorPath.length === 0) return path;

    if (startIndex === endIndex) return path;

    const dir = startIndex < endIndex ? 1 : -1;
    for (let i = startIndex + dir; dir > 0 ? i <= endIndex : i >= endIndex; i += dir) {
      const t = this.corridorPath[i];
      path.push({ x: t.x, y: t.y });
    }
    return path;
  }

  plan(monsterGrid) {
    const now = this.now();

    if (!this.corridorPath || this.corridorPath.length === 0) {
      this.currentPath = [];
      this.currentTarget = null;
      return;
    }

    if (this.currentTarget) {
      const distToTarget = this.manhattan(monsterGrid, this.currentTarget);
      if (distToTarget <= 0) {
        this.currentTarget = null;
        this.currentPath = [];
      }
    }

    if (
      this.currentPath &&
      this.currentPath.length > 0 &&
      this.currentTarget &&
      now - this.lastPlanTime < this.planInterval
    ) {
      return;
    }

    this.lastPlanTime = now;

    const playerGrid = this.getPlayerGridPosition();
    const monsterIndex = this.indexOfCorridorTile(monsterGrid);
    const currentIndex =
      monsterIndex >= 0 ? monsterIndex : this.nearestCorridorIndex(monsterGrid);

    let targetIndex = null;

    if (playerGrid) {
      const playerIndex = this.indexOfCorridorTile(playerGrid);
      if (playerIndex !== -1) {
        if (this.monster?.aiChaseSuppressed === true) {
          this.state = 'patrol';
        } else {
          this.state = 'chase';
          targetIndex = playerIndex;
        }
      } else if (this.state === 'chase') {
        this.state = 'patrol';
      }
    }

    if (this.state === 'patrol' || targetIndex === null) {
      this.state = 'patrol';

      const atStart = currentIndex === 0;
      const atEnd = currentIndex === this.corridorPath.length - 1;

      if ((atStart && this.patrolDirection < 0) || (atEnd && this.patrolDirection > 0)) {
        this.patrolDirection *= -1;
      }

      targetIndex = this.patrolDirection > 0
        ? this.corridorPath.length - 1
        : 0;
    }

    const targetTile = this.corridorPath[targetIndex];
    this.currentTarget = { x: targetTile.x, y: targetTile.y };
    this.currentPath = this.buildPathBetweenIndices(currentIndex, targetIndex);
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);
    this.plan(monsterGrid);

    const { move, targetGrid } = this.stepAlongPath(monsterGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    return { move, lookYaw, sprint: false };
  }
}
