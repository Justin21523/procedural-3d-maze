import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';

/**
 * WanderCritterBrain
 * - Neutral, harmless critter that explores the whole map.
 * - Uses exploration memory to avoid looping.
 * - Softly avoids getting too close to player.
 * - If killed (monster.isDead), it respawns after respawnDelay at a tile far from the player.
 */
export class WanderCritterBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.minExploreDistance =
      config.minExploreDistance ??
      CONFIG.AUTOPILOT_MIN_EXPLORE_DIST ??
      18;

    this.explorationSamples =
      config.explorationSamples ??
      CONFIG.AUTOPILOT_EXPLORE_SAMPLES ??
      80;

    this.avoidPlayerDistance =
      config.avoidPlayerDistance ??
      4;

    this.respawnDelay =
      config.respawnDelay ??
      8.0;

    this.minRespawnDistance =
      config.minRespawnDistance ??
      12;

    this.dead = false;
    this.deathTime = 0;
  }

  /**
   * Optional API for external hit logic
   */
  onHit() {
    if (this.monster) {
      this.monster.isDead = true;
    }
  }

  respawnIfNeeded() {
    const now = this.now();

    // Detect death edge
    if (!this.dead && this.monster && this.monster.isDead) {
      this.dead = true;
      this.deathTime = now;
      this.currentPath = [];
      this.currentTarget = null;
    }

    if (!this.dead) return;

    if (now - this.deathTime < this.respawnDelay) {
      return;
    }

    // Time to respawn
    this.performRespawn();
  }

  performRespawn() {
    const playerGrid = this.getPlayerGridPosition();
    let spawnTile = null;

    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      for (let i = 0; i < 80; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        if (playerGrid) {
          const dist = this.manhattan(playerGrid, tile);
          if (dist < this.minRespawnDistance) {
            continue;
          }
        }

        spawnTile = { x: tile.x, y: tile.y };
        break;
      }
    }

    if (!spawnTile) {
      // Fallback: opposite side of player or current position
      const current = this.getMonsterGridPosition();
      spawnTile = playerGrid
        ? { x: current.x, y: current.y }
        : current;
    }

    this.setMonsterGridPosition(spawnTile);
    this.visitedTiles.clear();
    this.currentPath = [];
    this.currentTarget = null;

    this.dead = false;
    if (this.monster) {
      this.monster.isDead = false;
    }
  }

  /**
   * Exploration strategy inspired by AutoPilot.pickExplorationTarget
   * but with a bias away from the player.
   */
  pickExplorationTarget(monsterGrid, playerGrid) {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return null;
    }

    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const distSelf = this.manhattan(monsterGrid, tile);
      if (distSelf < this.minExploreDistance) continue;

      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);

      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      let score = distSelf * 1.0 + novelty * 20;

      if (playerGrid) {
        const distPlayer = this.manhattan(playerGrid, tile);
        // Prefer tiles further away from player
        score += distPlayer * 0.5;
      }

      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    // Relax distance if nothing found
    if (!best) {
      for (let i = 0; i < this.explorationSamples; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        const key = this.posKey(tile);
        const lastVisit = this.visitedTiles.get(key);

        let novelty = 2.0;
        if (lastVisit) {
          const age = now - lastVisit;
          novelty = Math.max(0, Math.min(1, age / this.visitTTL));
        }

        let score = novelty * 15;
        if (playerGrid) {
          const distPlayer = this.manhattan(playerGrid, tile);
          score += distPlayer * 0.4;
        }

        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * When player too close, pick a target that increases distance.
   */
  pickFleeTarget(monsterGrid, playerGrid) {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return null;
    }

    const currentDist = this.manhattan(monsterGrid, playerGrid);
    let best = null;

    for (let i = 0; i < 40; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const distPlayer = this.manhattan(playerGrid, tile);
      if (distPlayer <= currentDist) continue;

      const distSelf = this.manhattan(monsterGrid, tile);
      const score = distPlayer * 1.0 - distSelf * 0.3;

      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();

    if (playerGrid) {
      const distToPlayer = this.manhattan(monsterGrid, playerGrid);
      if (distToPlayer < this.avoidPlayerDistance) {
        const fleeTarget = this.pickFleeTarget(monsterGrid, playerGrid);
        if (fleeTarget) {
          return fleeTarget;
        }
      }
    }

    const explore = this.pickExplorationTarget(monsterGrid, playerGrid);
    if (explore) return explore;

    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      return this.worldState.findRandomWalkableTile();
    }
    return monsterGrid;
  }

  computeSprint() {
    return false;
  }

  tick(deltaTime) {
    this.respawnIfNeeded();
    if (this.dead || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }
    return super.tick(deltaTime);
  }
}

