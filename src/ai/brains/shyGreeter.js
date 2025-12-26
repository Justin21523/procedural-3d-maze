import { BaseMonsterBrain } from './baseBrain.js';

/**
 * ShyGreeterBrain
 * - Wanders in a small radius when alone.
 * - When the player is within vision range, it tries to keep a comfortable
 *   distance (idealDistance) and faces the player.
 * - If the player gets too close, it retreats to re-establish personal space.
 */
export class ShyGreeterBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    const startGrid = this.getMonsterGridPosition();

    this.visionRange =
      config.visionRange ??
      monster.visionRange ??
      8;

    this.greetDistance =
      config.greetDistance ??
      6;

    this.idealDistance =
      config.idealDistance ??
      4;

    this.tooCloseDistance =
      config.tooCloseDistance ??
      2;

    this.roamRadius =
      config.roamRadius ??
      4;

    this.roamCenter =
      config.roamCenter ||
      monster.roamCenter ||
      { x: startGrid.x, y: startGrid.y };

    this.explorationSamples =
      config.explorationSamples ??
      40;

    this.mode = 'wander'; // 'wander' | 'greet' | 'flee'
  }

  canSeePlayer(monsterGrid, playerGrid) {
    const dist = this.manhattan(monsterGrid, playerGrid);
    if (dist > this.visionRange) return false;

    if (this.worldState && typeof this.worldState.hasLineOfSight === 'function') {
      return this.worldState.hasLineOfSight(monsterGrid, playerGrid);
    }
    return true;
  }

  pickRandomRoamTile() {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return { x: this.roamCenter.x, y: this.roamCenter.y };
    }

    for (let i = 0; i < 40; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const dist = this.manhattan(tile, this.roamCenter);
      if (dist <= this.roamRadius) {
        return { x: tile.x, y: tile.y };
      }
    }

    return { x: this.roamCenter.x, y: this.roamCenter.y };
  }

  pickRoamTarget(monsterGrid) {
    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = this.pickRandomRoamTile();
      if (!tile) continue;

      const dist = this.manhattan(monsterGrid, tile);
      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);

      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      const score = dist * 0.6 + novelty * 15;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    if (!best) {
      return this.pickRandomRoamTile();
    }
    return { x: best.x, y: best.y };
  }

  pickFleeTarget(monsterGrid, playerGrid) {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return this.pickRoamTarget(monsterGrid);
    }

    const currentDist = this.manhattan(monsterGrid, playerGrid);
    let best = null;

    for (let i = 0; i < 40; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const distPlayer = this.manhattan(playerGrid, tile);
      if (distPlayer <= currentDist) continue;

      const distCenter = this.manhattan(tile, this.roamCenter);
      if (distCenter > this.roamRadius * 2) continue;

      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);
      let novelty = 2.0;
      if (lastVisit) {
        const age = Date.now() - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      const score = distPlayer * 1.0 + novelty * 10;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : this.pickRoamTarget(monsterGrid);
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();

    if (playerGrid) {
      const canSee = this.canSeePlayer(monsterGrid, playerGrid);
      const dist = this.manhattan(monsterGrid, playerGrid);

      if (canSee && dist <= this.visionRange) {
        if (dist <= this.tooCloseDistance) {
          this.mode = 'flee';
          return this.pickFleeTarget(monsterGrid, playerGrid);
        }
        if (dist <= this.greetDistance) {
          this.mode = 'greet';
          return null;
        }
      }
    }

    this.mode = 'wander';
    return this.pickRoamTarget(monsterGrid);
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);
    this.plan(monsterGrid);

    let move = { x: 0, y: 0 };
    let lookYaw = 0;

    if (this.mode === 'greet') {
      move = { x: 0, y: 0 };
      lookYaw = this.computeLookYawToPlayer();
    } else {
      const { move: pathMove, targetGrid } = this.stepAlongPath(monsterGrid);
      move = pathMove;

      if (this.mode === 'flee') {
        lookYaw = this.computeLookYawToPlayer();
      } else {
        lookYaw = this.computeLookYawToGrid(targetGrid);
      }
    }

    return { move, lookYaw, sprint: false };
  }
}

