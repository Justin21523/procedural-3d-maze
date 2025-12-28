import { Pathfinding } from '../pathfinding.js';
import { CONFIG } from '../../core/config.js';
import { RangedCombatModule } from '../components/combat/rangedCombat.js';

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
    this.allowSprint = config.allowSprint ?? true;

    // Perception (noise)
    this.lastHeardNoise = null; // { kind, grid, world, priority, strength, heardAt }

    // Combat module (optional; checks typeConfig.combat.ranged at runtime)
    this.combat = new RangedCombatModule(worldState, monster, playerRef, config.combat || {});
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
    if (this.combat) {
      this.combat.playerRef = playerRef;
    }
  }

  /**
   * Receive a perceived noise event from MonsterManager.
   * @param {Object} noise
   */
  hearNoise(noise) {
    if (!noise || !noise.grid) return;
    const now = this.now();
    const next = {
      kind: noise.kind || 'noise',
      grid: noise.grid,
      world: noise.world || null,
      priority: Number.isFinite(noise.priority) ? noise.priority : 0,
      strength: Number.isFinite(noise.strength) ? noise.strength : 1.0,
      heardAt: now
    };

    const cur = this.lastHeardNoise;
    if (!cur) {
      this.lastHeardNoise = next;
      return;
    }

    // Prefer higher priority; otherwise prefer more recent.
    if (next.priority > (cur.priority || 0)) {
      this.lastHeardNoise = next;
      return;
    }
    if (next.priority === (cur.priority || 0) && next.heardAt > (cur.heardAt || 0)) {
      this.lastHeardNoise = next;
    }
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

  roomCenter(room) {
    if (!room) return { x: 0, y: 0 };
    const cx = Math.floor(room.x + room.width / 2);
    const cy = Math.floor(room.y + room.height / 2);
    return { x: cx, y: cy };
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
    if (typeof this.playerRef.getAIPerceivedGridPosition === 'function') {
      return this.playerRef.getAIPerceivedGridPosition();
    }
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
    if (typeof this.playerRef.getAIPerceivedWorldPosition === 'function') {
      return this.playerRef.getAIPerceivedWorldPosition();
    }
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
      path = this.tryFindPathWithFallbacks(monsterGrid, this.currentTarget, avoidMask);

      if ((!path || path.length === 0) && avoidMask) {
        path = this.tryFindPathWithFallbacks(monsterGrid, this.currentTarget, null);
      }

      if (path && path.length > 0 && typeof this.pathfinder.smoothPath === 'function') {
        path = this.pathfinder.smoothPath(path);
      }
    }

    this.currentPath = path && path.length > 0 ? path : [];
  }

  tryFindPathWithFallbacks(monsterGrid, target, avoidMask) {
    let path = this.pathfinder.findPath(monsterGrid, target, true, avoidMask);
    if (path && path.length > 0) return path;

    // Try alternate room centers if available
    if (this.worldState?.rooms && this.worldState.rooms.length > 0) {
      const candidates = [];
      for (let i = 0; i < 3; i++) {
        const room = this.worldState.rooms[Math.floor(Math.random() * this.worldState.rooms.length)];
        const center = this.roomCenter(room);
        candidates.push(center);
      }
      for (const c of candidates) {
        path = this.pathfinder.findPath(monsterGrid, c, true, avoidMask);
        if (path && path.length > 0) return path;
      }
    }
    return path;
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
    if (!this.allowSprint) return false;
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

  /**
   * Post-processing hook consumed by MonsterManager.
   * Adds ranged attack commands if enabled in typeConfig.combat.ranged.
   */
  decorateCommand(command, deltaTime) {
    if (!this.enabled || this.monster?.isDead) {
      return command || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }
    if (!this.combat?.decorateCommand) return command;
    return this.combat.decorateCommand(command, deltaTime);
  }
}
