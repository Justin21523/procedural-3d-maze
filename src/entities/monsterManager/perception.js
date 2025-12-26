import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';

export class MonsterPerception {
  constructor() {
    this.noiseEvents = [];
    this.alertCooldowns = new Map(); // Monster -> seconds
    this.lastPlayerNoisePos = null;
    this.playerNoiseAccumulator = 0;
  }

  clear() {
    this.noiseEvents = [];
    this.alertCooldowns.clear();
    this.lastPlayerNoisePos = null;
    this.playerNoiseAccumulator = 0;
  }

  registerNoise(position, options = {}) {
    if (!CONFIG.AI_NOISE_ENABLED) return;
    if (!position) return;
    const tileSize = CONFIG.TILE_SIZE || 1;

    const x = Number.isFinite(position.x) ? position.x : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;
    const grid = { x: Math.floor(x / tileSize), y: Math.floor(z / tileSize) };

    const kind = options.kind || 'noise';
    const radius = Number.isFinite(options.radius) ? options.radius : 8;
    const ttl = Number.isFinite(options.ttl) ? options.ttl : 0.8;

    const entry = {
      kind,
      radius,
      life: ttl,
      maxLife: ttl,
      grid,
      world: new THREE.Vector3(x, Number.isFinite(position.y) ? position.y : 0, z),
      strength: Number.isFinite(options.strength) ? options.strength : 1.0,
      source: options.source || null
    };

    this.noiseEvents.push(entry);
    const maxEvents = CONFIG.AI_NOISE_MAX_EVENTS ?? 32;
    if (this.noiseEvents.length > maxEvents) {
      this.noiseEvents.splice(0, this.noiseEvents.length - maxEvents);
    }
    return entry;
  }

  updateNoise(dt) {
    for (let i = this.noiseEvents.length - 1; i >= 0; i--) {
      const n = this.noiseEvents[i];
      n.life -= dt;
      if (n.life <= 0) {
        this.noiseEvents.splice(i, 1);
      }
    }
  }

  getNoisePriority(kind) {
    const k = String(kind || '').toLowerCase();
    if (k.includes('gun')) return 4;
    if (k.includes('alert')) return 3;
    if (k.includes('sprint')) return 2;
    if (k.includes('foot')) return 1;
    return 0;
  }

  getMonsterHearingRange(monster, brain) {
    const brainHearing = brain?.config?.hearingRange;
    if (Number.isFinite(brainHearing)) return brainHearing;
    const statsHearing = monster?.typeConfig?.stats?.hearingRange;
    if (Number.isFinite(statsHearing)) return statsHearing;
    return 0;
  }

  pickAudibleNoise(monster, brain) {
    if (!monster || !brain) return null;
    if (!this.noiseEvents || this.noiseEvents.length === 0) return null;

    const hearingRange = this.getMonsterHearingRange(monster, brain);
    if (!Number.isFinite(hearingRange) || hearingRange <= 0) return null;

    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return null;

    const baseHearing = CONFIG.AI_BASE_HEARING ?? 10;
    const difficulty = CONFIG.AI_DIFFICULTY ?? 1.0;
    const hearingScale = Math.max(0.15, hearingRange / Math.max(1, baseHearing)) * Math.max(0.5, difficulty);

    let best = null;
    for (const noise of this.noiseEvents) {
      if (!noise?.grid) continue;
      const dx = monsterGrid.x - noise.grid.x;
      const dy = monsterGrid.y - noise.grid.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      const audible = (noise.radius || 0) * hearingScale;
      if (dist > audible) continue;

      const priority = this.getNoisePriority(noise.kind);
      const score = priority * 1000 + (audible - dist) * 10 + (noise.life / (noise.maxLife || 1));
      if (!best || score > best.score) {
        best = {
          score,
          kind: noise.kind,
          grid: noise.grid,
          world: noise.world,
          priority,
          strength: noise.strength ?? 1.0
        };
      }
    }

    return best;
  }

  updatePlayerNoise(dt, playerPos, options = {}) {
    if (!CONFIG.AI_NOISE_ENABLED) return;
    if (!playerPos) return;

    const pos = playerPos.clone();
    pos.y = 0;

    if (!this.lastPlayerNoisePos) {
      this.lastPlayerNoisePos = pos.clone();
      this.playerNoiseAccumulator = 0;
      return;
    }

    const delta = pos.clone().sub(this.lastPlayerNoisePos);
    const moved = Math.hypot(delta.x, delta.z);
    if (Number.isFinite(moved) && moved > 0) {
      this.playerNoiseAccumulator += Math.min(moved, 6);
      this.lastPlayerNoisePos.copy(pos);
    }

    const stepWorld = (CONFIG.TILE_SIZE || 2) * 0.85;
    if (this.playerNoiseAccumulator < stepWorld) return;

    this.playerNoiseAccumulator = 0;

    const sprinting = !!options.sprinting;
    const kind = sprinting ? 'footstep_sprint' : 'footstep';
    const radius = sprinting ? (CONFIG.AI_NOISE_FOOTSTEP_SPRINT_RADIUS ?? 9) : (CONFIG.AI_NOISE_FOOTSTEP_WALK_RADIUS ?? 5);
    const ttl = CONFIG.AI_NOISE_TTL_FOOTSTEP ?? 0.55;
    const strength = sprinting ? 1.0 : 0.65;

    return this.registerNoise(playerPos, { kind, radius, ttl, strength, source: 'player' });
  }

  canMonsterSeePlayer(monster, playerGrid, worldState) {
    if (!monster || !playerGrid) return false;
    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return false;
    const vision = monster.visionRange ?? monster.typeConfig?.stats?.visionRange ?? CONFIG.MONSTER_VISION_RANGE ?? 12;
    const dist = Math.abs(monsterGrid.x - playerGrid.x) + Math.abs(monsterGrid.y - playerGrid.y);
    if (dist > vision) return false;
    if (worldState?.hasLineOfSight) {
      return worldState.hasLineOfSight(monsterGrid, playerGrid);
    }
    return true;
  }

  maybeBroadcastAlert(monster, playerPos, playerGrid, dt, worldState) {
    const cd = Math.max(0, (this.alertCooldowns.get(monster) || 0) - dt);
    this.alertCooldowns.set(monster, cd);
    if (cd > 0) return;
    if (!playerPos || !playerGrid) return;
    if (!this.canMonsterSeePlayer(monster, playerGrid, worldState)) return;

    const ttl = CONFIG.AI_ALERT_TTL ?? 1.0;
    const radius = CONFIG.AI_ALERT_BROADCAST_RADIUS ?? 14;
    this.registerNoise(playerPos, {
      kind: 'alert',
      radius,
      ttl,
      strength: 1.0,
      source: monster
    });

    this.alertCooldowns.set(monster, CONFIG.AI_ALERT_COOLDOWN ?? 0.9);
  }
}
