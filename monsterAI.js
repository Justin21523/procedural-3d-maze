// src/ai/monsterAI.js
import { Pathfinding } from './pathfinding.js';
import { CONFIG } from '../core/config.js';

/**
 * BaseMonsterBrain
 * Shared navigation logic for all monster brains.
 * - Grid-based movement
 * - Pathfinding with planInterval cooldown
 * - Visited tiles memory to avoid tight loops
 * - Simple move + lookYaw command generation
 */
export class BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    this.worldState = worldState;
    this.pathfinder = pathfinder || new Pathfinding(worldState);
    this.monster = monster;
    this.playerRef = playerRef;
    this.config = config || {};

    this.currentPath = [];
    this.currentTarget = null;

    this.lastPlanTime = 0;
    this.planInterval =
      this.config.planInterval ??
      CONFIG.MONSTER_REPLAN_INTERVAL ??
      0.7;

    this.visitedTiles = new Map();
    this.visitTTL =
      this.config.visitTTL ??
      CONFIG.MONSTER_VISIT_TTL ??
      45_000;

    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Seconds since start (same idea as AutoPilot)
   */
  now() {
    return performance.now() / 1000;
  }

  /**
   * Grid key helper
   */
  posKey(pos) {
    return `${pos.x},${pos.y}`;
  }

  /**
   * Record a visit for exploration memory and clean up old entries
   */
  recordVisit(gridPos) {
    const now = Date.now();
    const key = this.posKey(gridPos);
    this.visitedTiles.set(key, now);

    const expireBefore = now - this.visitTTL;
    for (const [k, ts] of this.visitedTiles.entries()) {
      if (ts < expireBefore) {
        this.visitedTiles.delete(k);
      }
    }
  }

  /**
   * Manhattan distance helper
   */
  manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Get monster grid position
   */
  getMonsterGridPosition() {
    if (this.monster && typeof this.monster.getGridPosition === 'function') {
      return this.monster.getGridPosition();
    }
    if (this.monster && this.monster.gridPos) {
      return { x: this.monster.gridPos.x, y: this.monster.gridPos.y };
    }
    // Fallback: derive from world position
    const tileSize = CONFIG.TILE_SIZE || 1;
    if (this.monster && this.monster.position) {
      const x = Math.floor(this.monster.position.x / tileSize);
      const y = Math.floor(this.monster.position.z / tileSize);
      return { x, y };
    }
    return { x: 0, y: 0 };
  }

  /**
   * Set monster grid position and sync world position if possible
   */
  setMonsterGridPosition(gridPos) {
    if (!gridPos || !this.monster) return;

    if (typeof this.monster.setGridPosition === 'function') {
      this.monster.setGridPosition(gridPos);
    } else {
      this.monster.gridPos = { x: gridPos.x, y: gridPos.y };
    }

    const tileSize = CONFIG.TILE_SIZE || 1;
    if (this.monster.position) {
      this.monster.position.x = gridPos.x * tileSize + tileSize / 2;
      this.monster.position.z = gridPos.y * tileSize + tileSize / 2;
    }
  }

  /**
   * Get player grid position
   */
  getPlayerGridPosition() {
    if (!this.playerRef) return null;
    if (typeof this.playerRef.getGridPosition === 'function') {
      return this.playerRef.getGridPosition();
    }
    if (this.playerRef.gridPos) {
      return { x: this.playerRef.gridPos.x, y: this.playerRef.gridPos.y };
    }
    const tileSize = CONFIG.TILE_SIZE || 1;
    if (this.playerRef.position) {
      const x = Math.floor(this.playerRef.position.x / tileSize);
      const y = Math.floor(this.playerRef.position.z / tileSize);
      return { x, y };
    }
    return null;
  }

  /**
   * Get monster world X/Z
   */
  getMonsterWorldPosition() {
    if (this.monster && this.monster.position) {
      return {
        x: this.monster.position.x,
        z: this.monster.position.z
      };
    }
    const gridPos = this.getMonsterGridPosition();
    const tileSize = CONFIG.TILE_SIZE || 1;
    return {
      x: gridPos.x * tileSize + tileSize / 2,
      z: gridPos.y * tileSize + tileSize / 2
    };
  }

  /**
   * Get player world X/Z
   */
  getPlayerWorldPosition() {
    if (!this.playerRef) return null;
    if (this.playerRef.position) {
      return {
        x: this.playerRef.position.x,
        z: this.playerRef.position.z
      };
    }
    const gridPos = this.getPlayerGridPosition();
    if (!gridPos) return null;
    const tileSize = CONFIG.TILE_SIZE || 1;
    return {
      x: gridPos.x * tileSize + tileSize / 2,
      z: gridPos.y * tileSize + tileSize / 2
    };
  }

  /**
   * Basic walkability test for grid tiles.
   * You may adapt this to your worldState API.
   */
  isWalkableTile(x, y) {
    if (!this.worldState) return true;

    if (typeof this.worldState.isWalkable === 'function') {
      return this.worldState.isWalkable(x, y);
    }
    if (typeof this.worldState.isWalkableTile === 'function') {
      return this.worldState.isWalkableTile({ x, y });
    }
    if (typeof this.worldState.getTile === 'function') {
      const tile = this.worldState.getTile(x, y);
      if (tile && typeof tile.walkable === 'boolean') {
        return tile.walkable;
      }
    }
    // Fallback: assume valid
    return true;
  }

  /**
   * Default pickTarget: just wander randomly
   * Subclasses usually override this.
   */
  pickTarget(monsterGrid) {
    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      return this.worldState.findRandomWalkableTile();
    }
    return { x: monsterGrid.x, y: monsterGrid.y };
  }

  /**
   * Avoidance mask hook (similar to AutoPilot.buildAvoidanceMask)
   * Default: no avoidance.
   */
  buildAvoidanceMask() {
    return null;
  }

  /**
   * Plan a path (if needed) to current target.
   * Uses planInterval + currentPath to avoid jitter.
   */
  plan(monsterGrid) {
    const now = this.now();

    // If we almost reached the target, drop path and force re-pick
    if (this.currentTarget) {
      const distToTarget = this.manhattan(monsterGrid, this.currentTarget);
      if (distToTarget <= 1) {
        this.currentTarget = null;
        this.currentPath = [];
      }
    }

    // Keep current path if still valid and inside cooldown window
    if (
      this.currentPath &&
      this.currentPath.length > 1 &&
      this.currentTarget &&
      now - this.lastPlanTime < this.planInterval
    ) {
      return;
    }

    this.lastPlanTime = now;
    const target = this.pickTarget(monsterGrid);
    if (!target) {
      this.currentTarget = null;
      this.currentPath = [];
      return;
    }

    this.currentTarget = { x: target.x, y: target.y };

    let path = null;
    if (this.pathfinder && typeof this.pathfinder.findPath === 'function') {
      const avoidMask = this.buildAvoidanceMask();
      path = this.pathfinder.findPath(monsterGrid, this.currentTarget, true, avoidMask);

      if ((!path || path.length === 0) && avoidMask) {
        // Fallback: ignore avoidance if it completely blocks path
        path = this.pathfinder.findPath(monsterGrid, this.currentTarget, true, null);
      }
    }

    this.currentPath = path && path.length > 0 ? path : [];
  }

  /**
   * Consume currentPath to produce a normalized move direction + the next tile
   */
  stepAlongPath(monsterGrid) {
    if (!this.currentPath || this.currentPath.length === 0) {
      return { move: { x: 0, y: 0 }, targetGrid: monsterGrid };
    }

    let next = this.currentPath[0];

    if (next.x === monsterGrid.x && next.y === monsterGrid.y && this.currentPath.length > 1) {
      this.currentPath.shift();
      next = this.currentPath[0];
    }

    const target = next || monsterGrid;
    const dirX = target.x - monsterGrid.x;
    const dirY = target.y - monsterGrid.y;
    const len = Math.hypot(dirX, dirY) || 1;
    const move = { x: dirX / len, y: dirY / len };

    return { move, targetGrid: target };
  }

  /**
   * Compute yaw delta from monster towards a world X/Z position
   */
  computeYawTowardsWorld(targetWorldX, targetWorldZ) {
    const monsterPos = this.getMonsterWorldPosition();
    const yaw = Math.atan2(
      targetWorldX - monsterPos.x,
      targetWorldZ - monsterPos.z
    );

    let currentYaw = 0;
    if (this.monster) {
      if (typeof this.monster.getYaw === 'function') {
        currentYaw = this.monster.getYaw();
      } else if (typeof this.monster.yaw === 'number') {
        currentYaw = this.monster.yaw;
      }
    }
    return yaw - currentYaw;
  }

  /**
   * Look towards a grid tile center
   */
  computeLookYawToGrid(targetGrid) {
    if (!targetGrid) return 0;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const worldX = targetGrid.x * tileSize + tileSize / 2;
    const worldZ = targetGrid.y * tileSize + tileSize / 2;
    return this.computeYawTowardsWorld(worldX, worldZ);
  }

  /**
   * Look towards the player
   */
  computeLookYawToPlayer() {
    const playerWorld = this.getPlayerWorldPosition();
    if (!playerWorld) return 0;
    return this.computeYawTowardsWorld(playerWorld.x, playerWorld.z);
  }

  /**
   * Sprint hint for MonsterManager.
   * Default: never sprint.
   */
  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    void distToPlayer;
    return false;
  }

  /**
   * Default tick: follow path (if any) and look along it.
   */
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
  }

  canSeePlayer(monsterGrid, playerGrid) {
    const dist = this.manhattan(monsterGrid, playerGrid);
    if (dist > this.visionRange) return false;

    if (this.worldState && typeof this.worldState.hasLineOfSight === 'function') {
      return this.worldState.hasLineOfSight(monsterGrid, playerGrid);
    }

    // Fallback: distance-based vision only
    return true;
  }

  pickRandomHomeTile() {
    // Prefer explicit tiles if provided
    const tiles =
      this.config.homeTiles ||
      this.monster.homeTiles;

    if (Array.isArray(tiles) && tiles.length > 0) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      return { x: t.x, y: t.y };
    }

    // Fallback: pick a random walkable tile near homeCenter
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
  }

  /**
   * Patrol target: exploration-style picking but restricted to home region
   */
  pickPatrolTarget(monsterGrid) {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return this.pickRandomHomeTile();
    }

    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = this.pickRandomHomeTile();
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
      return this.pickRandomHomeTile();
    }
    return { x: best.x, y: best.y };
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();
    const now = this.now();
    const canSee = playerGrid
      ? this.canSeePlayer(monsterGrid, playerGrid)
      : false;

    if (canSee && playerGrid) {
      this.lastSeenPlayerTime = now;
      this.state = 'chase';
    } else if (this.state === 'chase') {
      if (now - this.lastSeenPlayerTime > this.chaseTimeout) {
        this.state = 'returning';
      }
    }

    if (this.state === 'returning') {
      const distHome = this.manhattan(monsterGrid, this.homeCenter);
      if (distHome <= 1) {
        this.state = 'patrol';
      }
    }

    let target = null;

    if (this.state === 'chase' && playerGrid) {
      this.targetType = 'chase';
      target = playerGrid;
    } else if (this.state === 'returning') {
      this.targetType = 'returning';
      target = this.homeCenter;
    } else {
      this.state = 'patrol';
      this.targetType = 'patrol';
      target = this.pickPatrolTarget(monsterGrid);
    }

    return target;
  }

  computeSprint(distToTarget, distToPlayer) {
    // Chase harder when far from the player
    if (this.targetType === 'chase') {
      return distToPlayer > 3;
    }
    return false;
  }
}

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
    // Critter never sprints
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

/**
 * TeleportStalkerBrain
 * - Slowly wanders / chases the player.
 * - If player is very far and cooldown is ready, it teleports to a ring around the player.
 * - Teleport never puts it inside walls (walkability check).
 */
export class TeleportStalkerBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.teleportCooldown =
      config.teleportCooldown ??
      12.0;

    this.lastTeleportTime = this.now();

    this.minTeleportDist =
      config.minTeleportDist ??
      3;

    this.maxTeleportDist =
      config.maxTeleportDist ??
      8;

    this.teleportTriggerDistance =
      config.teleportTriggerDistance ??
      18;

    this.chaseRange =
      config.chaseRange ??
      12;

    this.mode = 'wander'; // 'wander' | 'chase'
  }

  pickTeleportTargetAroundPlayer(playerGrid, monsterGrid) {
    const minD = this.minTeleportDist;
    const maxD = this.maxTeleportDist;
    const candidates = [];

    for (let r = minD; r <= maxD; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < minD || dist > maxD) continue;

          const x = playerGrid.x + dx;
          const y = playerGrid.y + dy;

          if (!this.isWalkableTile(x, y)) continue;

          const dFromMonster = this.manhattan(monsterGrid, { x, y });
          if (dFromMonster < 2) continue; // avoid "fake" teleports

          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();
    if (!playerGrid) {
      // No player reference, just wander
      if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
        return this.worldState.findRandomWalkableTile();
      }
      return monsterGrid;
    }

    const distToPlayer = this.manhattan(monsterGrid, playerGrid);
    if (distToPlayer <= this.chaseRange) {
      this.mode = 'chase';
      return playerGrid;
    }

    this.mode = 'wander';

    // Simple wandering: lightly biased towards the player's general area
    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      let best = null;
      for (let i = 0; i < 40; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        const distToPlayerCandidate = this.manhattan(playerGrid, tile);
        const score = -distToPlayerCandidate; // prefer closer to player (but not too close due to teleport logic)

        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }

    return playerGrid;
  }

  computeSprint(distToTarget, distToPlayer) {
    if (this.mode === 'chase') {
      return distToPlayer > 4;
    }
    return false;
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);

    const playerGrid = this.getPlayerGridPosition();
    let specialAction = null;
    const now = this.now();

    if (playerGrid) {
      const distToPlayer = this.manhattan(monsterGrid, playerGrid);

      if (
        distToPlayer > this.teleportTriggerDistance &&
        now - this.lastTeleportTime >= this.teleportCooldown
      ) {
        const teleportTarget = this.pickTeleportTargetAroundPlayer(playerGrid, monsterGrid);
        if (teleportTarget) {
          this.setMonsterGridPosition(teleportTarget);
          this.currentPath = [];
          this.currentTarget = null;
          this.lastTeleportTime = now;

          // MonsterManager can listen for this and maybe spawn VFX or sound
          specialAction = 'teleport';
        }
      }
    }

    const newGrid = this.getMonsterGridPosition();
    this.plan(newGrid);

    const { move, targetGrid } = this.stepAlongPath(newGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    const distToTarget = this.currentTarget
      ? this.manhattan(newGrid, this.currentTarget)
      : Infinity;

    const distToPlayer = playerGrid
      ? this.manhattan(newGrid, playerGrid)
      : Infinity;

    const sprint = this.computeSprint(distToTarget, distToPlayer);

    return { move, lookYaw, sprint, specialAction };
  }
}

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
      const dist = this.manhattan(monsterGrid, playerGrid);
      if (dist <= this.visionRange) {
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

    this.updatePhase(deltaTime);

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);
    this.plan(monsterGrid);

    const { move, targetGrid } = this.stepAlongPath(monsterGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    const sprint = this.speedPhase === 'sprint';

    // Optional: expose speed multiplier via monster for your movement system
    if (this.monster) {
      this.monster.speedMultiplier = sprint ? this.sprintMultiplier : 1.0;
    }

    return { move, lookYaw, sprint };
  }
}

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
        this.state = 'chase';
        targetIndex = playerIndex;
      } else if (this.state === 'chase') {
        // Player left corridor, go back to patrol
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
          // No movement target; will just face the player
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
      // Stay (almost) still and look at the player
      move = { x: 0, y: 0 };
      lookYaw = this.computeLookYawToPlayer();
    } else {
      const { move: pathMove, targetGrid } = this.stepAlongPath(monsterGrid);
      move = pathMove;

      if (this.mode === 'flee') {
        // Backing away but still look at the player
        lookYaw = this.computeLookYawToPlayer();
      } else {
        // Wander: look along movement direction
        lookYaw = this.computeLookYawToGrid(targetGrid);
      }
    }

    return { move, lookYaw, sprint: false };
  }
}

/**
 * Factory helper for MonsterManager
 *
 * Usage:
 *   import { createMonsterBrain } from './monsterAI.js';
 *
 *   const brain = createMonsterBrain({
 *     type: 'roomHunter', // or 'wanderCritter', 'teleportStalker', 'speedJitter', 'corridorGuardian', 'shyGreeter'
 *     worldState,
 *     pathfinder,
 *     monster,
 *     playerRef,
 *     config: { /* per-type overrides */ /* }
 *   });
 *
 *   const command = brain.tick(deltaTime);
 */
export function createMonsterBrain(options) {
  const {
    type,
    worldState,
    pathfinder,
    monster,
    playerRef,
    config
  } = options;

  switch (type) {
    case 'roomHunter':
    case 'hunter':
      return new RoomHunterBrain(worldState, pathfinder, monster, playerRef, config);

    case 'wanderCritter':
    case 'critter':
      return new WanderCritterBrain(worldState, pathfinder, monster, playerRef, config);

    case 'teleportStalker':
    case 'stalker':
      return new TeleportStalkerBrain(worldState, pathfinder, monster, playerRef, config);

    case 'speedJitter':
    case 'jitter':
      return new SpeedJitterBrain(worldState, pathfinder, monster, playerRef, config);

    case 'corridorGuardian':
    case 'guardian':
      return new CorridorGuardianBrain(worldState, pathfinder, monster, playerRef, config);

    case 'shyGreeter':
    case 'greeter':
      return new ShyGreeterBrain(worldState, pathfinder, monster, playerRef, config);

    default:
      // Safe default: neutral wanderer
      return new WanderCritterBrain(worldState, pathfinder, monster, playerRef, config);
  }
}
