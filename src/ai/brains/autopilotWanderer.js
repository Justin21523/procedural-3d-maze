import { CONFIG } from '../../core/config.js';
import { ROOM_TYPES } from '../../world/tileTypes.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer } from '../components/perception/vision.js';

/**
 * AutopilotWandererBrain
 * - Reuses the player's autopilot-style exploration to roam the maze.
 * - Only chases the player if they are within 2 tiles, and even then for max 5s.
 * - Otherwise keeps wandering far/unvisited areas with the same path smoothing.
 */
export class AutopilotWandererBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.planInterval =
      config.planInterval ??
      CONFIG.AUTOPILOT_REPLAN_INTERVAL ??
      this.planInterval;

    this.visitTTL =
      config.visitTTL ??
      CONFIG.AUTOPILOT_VISIT_TTL ??
      60_000;

    this.minExploreDistance =
      config.minExploreDistance ??
      CONFIG.AUTOPILOT_MIN_EXPLORE_DIST ??
      18;

    this.explorationSamples =
      config.explorationSamples ??
      CONFIG.AUTOPILOT_EXPLORE_SAMPLES ??
      80;

    this.visionRange =
      config.visionRange ??
      monster?.visionRange ??
      monster?.typeConfig?.stats?.visionRange ??
      10;

    this.noiseMemorySeconds =
      config.noiseMemorySeconds ??
      (CONFIG.AI_NOISE_MEMORY ?? 2.0);

    this.scentMemorySeconds =
      config.scentMemorySeconds ??
      (CONFIG.AI_SCENT_MEMORY ?? 8.0);

    this.chaseRange = config.chaseRange ?? 2;
    this.maxChaseDuration = config.maxChaseDuration ?? 5.0;

    this.state = 'wander'; // 'wander' | 'chase'
    this.chaseStartTime = null;
    this.lastSeenPlayerGrid = null;
    this.chaseLockout = false;
    this.visitedRooms = new Map();

    // Keep monsters mellow by default
    this.allowSprint = config.allowSprint ?? false;

    // Stuck handling (similar to AutoPilot)
    this.lastGrid = null;
    this.stuckTimer = 0;
    this.stuckThreshold = config.stuckSeconds ?? (CONFIG.AUTOPILOT_STUCK_SECONDS ?? 1.0);
    this.stagnateTimer = 0;
    this.stagnateThreshold = config.stagnateSeconds ?? 2.5;
    this.lastTargetKey = null;
    this.recentTiles = [];
    this.nudgeTimer = 0;
    this.nudgeDir = null;
    this.nudgeDuration = 0.4;
    this.lastWorldPos = null;
    this.noProgressTimer = 0;
    this.noProgressThreshold = config.noProgressSeconds ?? 0.9;
    this.avoidTiles = new Map(); // key -> expire timestamp
    this.stallNudgeMultiplier = 2.0;
  }

  monsterCanSeePlayer(monsterGrid, playerGrid) {
    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    return canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange, {
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

  pickStimulusGrid(now, monsterGrid, playerGrid) {
    if (playerGrid && this.monsterCanSeePlayer(monsterGrid, playerGrid)) {
      return { x: playerGrid.x, y: playerGrid.y };
    }
    if (this.hasRecentNoise(now) && this.lastHeardNoise?.grid) {
      return { x: this.lastHeardNoise.grid.x, y: this.lastHeardNoise.grid.y };
    }
    if (this.hasRecentScent(now) && this.lastSmelledScent?.grid) {
      return { x: this.lastSmelledScent.grid.x, y: this.lastSmelledScent.grid.y };
    }
    return null;
  }

  roomCenter(room) {
    const cx = Math.floor(room.x + room.width / 2);
    const cy = Math.floor(room.y + room.height / 2);
    return { x: cx, y: cy };
  }

  roomKey(room) {
    return `${room.x},${room.y},${room.width},${room.height}`;
  }

  findRoomAtGrid(gridPos) {
    if (!this.worldState?.rooms) return null;
    return this.worldState.rooms.find(r =>
      gridPos.x >= r.x && gridPos.x < r.x + r.width &&
      gridPos.y >= r.y && gridPos.y < r.y + r.height
    ) || null;
  }

  recordRoomVisit(gridPos) {
    if (!this.worldState?.rooms) return;
    const room = this.findRoomAtGrid(gridPos);
    if (!room) return;
    const key = this.roomKey(room);
    this.visitedRooms.set(key, Date.now());
  }

  pickExplorationTarget(monsterGrid) {
    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return { x: monsterGrid.x, y: monsterGrid.y };
    }

    const now = Date.now();
    let best = null;

    const roomHop = this.pickRoomHopTarget(monsterGrid, now);
    if (roomHop) {
      return roomHop;
    }

    // First pass: prefer far, unvisited tiles (bias rooms over corridors)
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

      const roomBonus = this.roomBonus(tile);
      const score = dist * 1.0 + novelty * 20 + roomBonus;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    // Fallback: relax distance but still bias toward fresh tiles
    if (!best) {
      for (let i = 0; i < this.explorationSamples; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        const dist = this.manhattan(monsterGrid, tile);
        const key = this.posKey(tile);
        const lastVisit = this.visitedTiles.get(key);
        let novelty = 2.0;
        if (lastVisit) {
          const age = now - lastVisit;
          novelty = Math.max(0, Math.min(1, age / this.visitTTL));
        }

        const roomBonus = this.roomBonus(tile);
        const score = dist * 0.6 + novelty * 15 + roomBonus * 0.7;
        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }
    }

    return best ? { x: best.x, y: best.y } : { x: monsterGrid.x, y: monsterGrid.y };
  }

  pickRoomHopTarget(monsterGrid, nowTs) {
    if (!this.worldState?.rooms || this.worldState.rooms.length === 0) return null;

    const samples = Math.min(80, this.worldState.rooms.length);
    let best = null;
    for (let i = 0; i < samples; i++) {
      const room = this.worldState.rooms[Math.floor(Math.random() * this.worldState.rooms.length)];
      const center = this.roomCenter(room);
      const dist = this.manhattan(monsterGrid, center);
      if (dist < this.minExploreDistance * 0.7) continue;

      const key = this.roomKey(room);
      const last = this.visitedRooms.get(key);
      let novelty = 2.0;
      if (last) {
        const age = nowTs - last;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }
      const sizeScore = (room.width * room.height) * 0.1;
      const score = dist * 0.9 + novelty * 25 + sizeScore;
      if (!best || score > best.score) {
        best = { x: center.x, y: center.y, score };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  roomBonus(tile) {
    if (!this.worldState || !this.worldState.getRoomType) return 0;
    const roomType = this.worldState.getRoomType(tile.x, tile.y);
    return roomType !== ROOM_TYPES.CORRIDOR ? 15 : 0;
  }

  updateChaseState(monsterGrid, stimulusGrid) {
    const now = this.now();
    const wasChasing = this.state === 'chase';
    const rangeTarget = stimulusGrid || this.lastSeenPlayerGrid;
    const inRange = rangeTarget
      ? this.manhattan(monsterGrid, rangeTarget) <= this.chaseRange
      : false;

    if (this.chaseLockout && !inRange) {
      this.chaseLockout = false;
    }

    if (!this.chaseLockout && stimulusGrid && inRange) {
      if (!wasChasing) {
        this.chaseStartTime = now;
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
      this.state = 'chase';
      this.lastSeenPlayerGrid = { x: stimulusGrid.x, y: stimulusGrid.y };
    } else if (!stimulusGrid && wasChasing) {
      // Keep chasing last known tile until timeout; do not instantly snap to the real player position.
      this.state = 'chase';
    } else if (!stimulusGrid && !wasChasing) {
      this.state = 'wander';
      this.chaseStartTime = null;
    } else if (stimulusGrid && !inRange) {
      this.state = 'wander';
      this.chaseStartTime = null;
    }

    if (this.state === 'chase' && this.chaseStartTime !== null) {
      if (now - this.chaseStartTime > this.maxChaseDuration) {
        this.chaseLockout = true;
        this.state = 'wander';
        this.chaseStartTime = null;
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
      }
    }

    if (this.state !== 'chase' && wasChasing) {
      this.currentPath = [];
      this.currentTarget = null;
      this.lastPlanTime = 0;
    }
  }

  pickTarget(monsterGrid) {
    if (this.state === 'chase') {
      if (this.lastSeenPlayerGrid) {
        return this.lastSeenPlayerGrid;
      }
    }

    return this.pickExplorationTarget(monsterGrid);
  }

  computeSprint() {
    // Keep movement leisurely; no sprinting when chasing.
    return false;
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);
    this.recordRoomVisit(monsterGrid);
    this.recordRecentTile(monsterGrid);

    // Simple stuck detection: if grid hasn't changed for a while, force replanning
    if (!this.lastGrid || this.lastGrid.x !== monsterGrid.x || this.lastGrid.y !== monsterGrid.y) {
      this.lastGrid = { ...monsterGrid };
      this.stuckTimer = 0;
      this.stagnateTimer = 0;
      this.noProgressTimer = 0;
    } else {
      this.stuckTimer += deltaTime;
      this.stagnateTimer += deltaTime;
      this.updateNoProgress(monsterGrid, deltaTime);
      if (this.stuckTimer > this.stuckThreshold) {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
        this.stuckTimer = 0;
      }
    }

    // If we have been aiming at the same target too long without progress, force a new goal
    const targetKey = this.currentTarget ? this.posKey(this.currentTarget) : null;
    if (targetKey && targetKey === this.lastTargetKey) {
      if (this.stagnateTimer > this.stagnateThreshold) {
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
        this.stagnateTimer = 0;
      }
    } else {
      this.lastTargetKey = targetKey;
      this.stagnateTimer = 0;
    }

    if (this.shouldNudge()) {
      this.triggerNudge();
    }

    if (this.nudgeTimer > 0 && this.nudgeDir) {
      this.nudgeTimer -= deltaTime;
      const move = { x: this.nudgeDir.x, y: this.nudgeDir.y };
      const world = this.getMonsterWorldPosition();
      const lookYaw = this.computeYawTowardsWorld(
        world.x + this.nudgeDir.x,
        world.z + this.nudgeDir.y
      );
      return { move, lookYaw, sprint: false };
    }

    const playerGrid = this.getPlayerGridPosition();
    const now = this.now();
    const stimulusGrid = this.pickStimulusGrid(now, monsterGrid, playerGrid);
    this.updateChaseState(monsterGrid, stimulusGrid);

    // Plan after state updates so chase timers immediately change paths
    this.plan(monsterGrid);

    const { move, lookYaw } = this.followPathLikeAutopilot(monsterGrid);
    if (this.state === 'chase' && stimulusGrid && playerGrid && stimulusGrid.x === playerGrid.x && stimulusGrid.y === playerGrid.y) {
      return { move, lookYaw: this.computeLookYawToPlayer(), sprint: false };
    }
    return { move, lookYaw, sprint: false };
  }

  updateNoProgress(monsterGrid, deltaTime) {
    const world = this.getMonsterWorldPosition();
    if (!this.lastWorldPos) {
      this.lastWorldPos = { ...world };
      return;
    }
    const moved = Math.hypot(world.x - this.lastWorldPos.x, world.z - this.lastWorldPos.z);
    this.lastWorldPos = { ...world };

    const targetKey = this.currentTarget ? this.posKey(this.currentTarget) : null;
    const sameTarget = targetKey && targetKey === this.lastTargetKey;

    if (sameTarget && moved < 0.04) {
      this.noProgressTimer += deltaTime;
      if (this.noProgressTimer > this.noProgressThreshold) {
        this.recordAvoidTile(monsterGrid, 3.0);
        this.currentPath = [];
        this.currentTarget = null;
        this.lastPlanTime = 0;
        this.noProgressTimer = 0;
        this.nudgeDir = { x: Math.cos(Math.random() * Math.PI * 2), y: Math.sin(Math.random() * Math.PI * 2) };
        this.nudgeTimer = this.nudgeDuration * this.stallNudgeMultiplier;
      }
    } else {
      this.noProgressTimer = 0;
    }
  }

  followPathLikeAutopilot(monsterGrid) {
    if (!this.currentPath || this.currentPath.length === 0) {
      return { move: { x: 0, y: 0 }, lookYaw: 0 };
    }

    const tileSize = CONFIG.TILE_SIZE;
    // Drop waypoints that are too close
    while (this.currentPath.length > 1) {
      const wp = this.currentPath[0];
      const cx = wp.x * tileSize + tileSize / 2;
      const cz = wp.y * tileSize + tileSize / 2;
      const world = this.getMonsterWorldPosition();
      const dist = Math.hypot(cx - world.x, cz - world.z);
      if (dist < tileSize * 0.35 || (wp.x === monsterGrid.x && wp.y === monsterGrid.y)) {
        this.currentPath.shift();
      } else {
        break;
      }
    }

    const target = this.currentPath[0] || monsterGrid;
    const targetWorldX = target.x * tileSize + tileSize / 2;
    const targetWorldZ = target.y * tileSize + tileSize / 2;
    const world = this.getMonsterWorldPosition();
    const dx = targetWorldX - world.x;
    const dz = targetWorldZ - world.z;
    const len = Math.hypot(dx, dz) || 1;
    const move = { x: dx / len, y: dz / len };
    const lookYaw = this.computeYawTowardsWorld(targetWorldX, targetWorldZ);
    return { move, lookYaw };
  }

  recordRecentTile(gridPos) {
    const key = this.posKey(gridPos);
    this.recentTiles.push(key);
    if (this.recentTiles.length > 10) {
      this.recentTiles.shift();
    }
  }

  shouldNudge() {
    if (this.recentTiles.length < 6) return false;
    const last = this.recentTiles.slice(-4);
    const unique = Array.from(new Set(last));
    return unique.length === 2 && last[0] === last[2] && last[1] === last[3];
  }

  triggerNudge() {
    const angle = Math.random() * Math.PI * 2;
    this.nudgeDir = { x: Math.cos(angle), y: Math.sin(angle) };
    this.nudgeTimer = this.nudgeDuration * 1.5;
    this.currentPath = [];
    this.currentTarget = null;
    this.lastPlanTime = 0;
  }

  recordAvoidTile(gridPos, ttl = 3.0) {
    const key = this.posKey(gridPos);
    const expires = Date.now() + ttl * 1000;
    this.avoidTiles.set(key, expires);
    for (const [k, ts] of this.avoidTiles.entries()) {
      if (ts < Date.now()) this.avoidTiles.delete(k);
    }
  }

  buildAvoidanceMask() {
    const mask = new Set();
    for (const [key, ts] of this.avoidTiles.entries()) {
      if (ts < Date.now()) continue;
      mask.add(key);
    }
    return mask.size > 0 ? mask : null;
  }
}
