import { CONFIG } from '../../../core/config.js';

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function wrapAngle(delta) {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

export function canSeePlayer(worldState, monsterGrid, playerGrid, visionRange = null) {
  if (!monsterGrid || !playerGrid) return false;
  const vr = Number.isFinite(visionRange)
    ? visionRange
    : (CONFIG.MONSTER_VISION_RANGE ?? 12);

  const dist = manhattan(monsterGrid, playerGrid);
  if (dist > vr) return false;

  if (worldState && typeof worldState.hasLineOfSight === 'function') {
    return worldState.hasLineOfSight(monsterGrid, playerGrid);
  }
  return true;
}

