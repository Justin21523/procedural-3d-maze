import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';

export class MonsterPerception {
  constructor() {
    this.noiseEvents = [];
    this.scentEvents = [];
    this.alertCooldowns = new Map(); // Monster -> seconds
    this.lastPlayerNoisePos = null;
    this.playerNoiseAccumulator = 0;
    this.lastPlayerScentPos = null;
    this.playerScentAccumulator = 0;
  }

  clear() {
    this.noiseEvents = [];
    this.scentEvents = [];
    this.alertCooldowns.clear();
    this.lastPlayerNoisePos = null;
    this.playerNoiseAccumulator = 0;
    this.lastPlayerScentPos = null;
    this.playerScentAccumulator = 0;
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

  registerScent(position, options = {}) {
    if (!CONFIG.AI_SCENT_ENABLED) return;
    if (!position) return;
    const tileSize = CONFIG.TILE_SIZE || 1;

    const x = Number.isFinite(position.x) ? position.x : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;
    const grid = { x: Math.floor(x / tileSize), y: Math.floor(z / tileSize) };

    const kind = options.kind || 'scent';
    const radius = Number.isFinite(options.radius) ? options.radius : (CONFIG.AI_SCENT_RADIUS ?? 10);
    const ttl = Number.isFinite(options.ttl) ? options.ttl : (CONFIG.AI_SCENT_TTL ?? 18.0);

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

    this.scentEvents.push(entry);
    const maxEvents = CONFIG.AI_SCENT_MAX_EVENTS ?? 64;
    if (this.scentEvents.length > maxEvents) {
      this.scentEvents.splice(0, this.scentEvents.length - maxEvents);
    }
    return entry;
  }

  updateScent(dt) {
    for (let i = this.scentEvents.length - 1; i >= 0; i--) {
      const s = this.scentEvents[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scentEvents.splice(i, 1);
      }
    }
  }

  getNoisePriority(kind) {
    const k = String(kind || '').toLowerCase();
    if (k.includes('gun')) return 4;
    if (k.includes('lure') || k.includes('decoy')) return 3;
    if (k.includes('alert')) return 3;
    if (k.includes('sprint')) return 2;
    if (k.includes('foot')) return 1;
    return 0;
  }

  getMonsterHearingRange(monster, brain) {
    const brainHearing = brain?.config?.hearingRange;
    let range = Number.isFinite(brainHearing) ? brainHearing : null;
    const statsHearing = monster?.typeConfig?.stats?.hearingRange;
    if (range === null && Number.isFinite(statsHearing)) range = statsHearing;
    if (range === null) range = 0;

    const jammed = Number(monster?.perceptionJammedTimer) || 0;
    if (jammed > 0) {
      const multRaw = Number(CONFIG.AI_JAMMED_HEARING_MULT);
      const mult = Number.isFinite(multRaw) ? Math.max(0, Math.min(1, multRaw)) : 0.2;
      range *= mult;
    }

    return range;
  }

  getMonsterSmellRange(monster, brain) {
    const brainSmell = brain?.config?.smellRange;
    let range = Number.isFinite(brainSmell) ? brainSmell : null;
    const statsSmell = monster?.typeConfig?.stats?.smellRange;
    if (range === null && Number.isFinite(statsSmell)) range = statsSmell;
    if (range === null) range = 0;

    const jammed = Number(monster?.perceptionJammedTimer) || 0;
    if (jammed > 0) {
      const multRaw = Number(CONFIG.AI_JAMMED_SMELL_MULT);
      const mult = Number.isFinite(multRaw) ? Math.max(0, Math.min(1, multRaw)) : 0.15;
      range *= mult;
    }

    return range;
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

  pickSmelledScent(monster, brain) {
    if (!monster || !brain) return null;
    if (!this.scentEvents || this.scentEvents.length === 0) return null;

    const smellRange = this.getMonsterSmellRange(monster, brain);
    if (!Number.isFinite(smellRange) || smellRange <= 0) return null;

    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return null;

    const baseSmell = CONFIG.AI_BASE_SMELL ?? 10;
    const difficulty = CONFIG.AI_DIFFICULTY ?? 1.0;
    const smellScale = Math.max(0.15, smellRange / Math.max(1, baseSmell)) * Math.max(0.5, difficulty);

    let best = null;
    for (const scent of this.scentEvents) {
      if (!scent?.grid) continue;
      const dx = monsterGrid.x - scent.grid.x;
      const dy = monsterGrid.y - scent.grid.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      const reach = (scent.radius || 0) * smellScale;
      if (dist > reach) continue;

      const lifeRatio = scent.maxLife > 0 ? (scent.life / scent.maxLife) : 0;
      const strength = scent.strength ?? 1.0;
      const intensity = Math.max(0, lifeRatio) * Math.max(0, strength);
      const score = intensity * 1000 + (reach - dist) * 10 + Math.random() * 0.5;

      if (!best || score > best.score) {
        best = {
          score,
          kind: scent.kind,
          grid: scent.grid,
          world: scent.world,
          strength,
          intensity
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

  updatePlayerScent(dt, playerPos, options = {}) {
    if (!CONFIG.AI_SCENT_ENABLED) return;
    if (!playerPos) return;

    const pos = playerPos.clone();
    pos.y = 0;

    if (!this.lastPlayerScentPos) {
      this.lastPlayerScentPos = pos.clone();
      this.playerScentAccumulator = 0;
      return;
    }

    const delta = pos.clone().sub(this.lastPlayerScentPos);
    const moved = Math.hypot(delta.x, delta.z);
    if (Number.isFinite(moved) && moved > 0) {
      this.playerScentAccumulator += Math.min(moved, 8);
      this.lastPlayerScentPos.copy(pos);
    }

    const dropDist = Number.isFinite(CONFIG.AI_SCENT_DROP_DISTANCE_WORLD)
      ? Math.max(0.2, CONFIG.AI_SCENT_DROP_DISTANCE_WORLD)
      : Math.max(0.2, (CONFIG.TILE_SIZE || 2) * 0.75);
    if (this.playerScentAccumulator < dropDist) return;

    this.playerScentAccumulator = 0;

    const sprinting = !!options.sprinting;
    const strength = sprinting
      ? (CONFIG.AI_SCENT_SPRINT_STRENGTH ?? 1.0)
      : (CONFIG.AI_SCENT_WALK_STRENGTH ?? 0.7);
    const ttl = CONFIG.AI_SCENT_TTL ?? 18.0;
    const radius = CONFIG.AI_SCENT_RADIUS ?? 10;
    const kind = sprinting ? 'scent_sprint' : 'scent';

    return this.registerScent(playerPos, { kind, radius, ttl, strength, source: 'player' });
  }

  canMonsterSeePlayer(monster, playerGrid, worldState) {
    if (!monster || !playerGrid) return false;
    if ((monster.perceptionBlindedTimer || 0) > 0) return false;
    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return false;
    const vision = monster.visionRange ?? monster.typeConfig?.stats?.visionRange ?? CONFIG.MONSTER_VISION_RANGE ?? 12;
    const dist = Math.abs(monsterGrid.x - playerGrid.x) + Math.abs(monsterGrid.y - playerGrid.y);
    if (dist > vision) return false;

    // FOV cone check (uses same yaw convention as BaseMonsterBrain: yaw = atan2(dx, dz)).
    const yaw = monster.getYaw?.() ?? monster.yaw;
    const rawFov =
      monster.visionFOV ??
      monster.typeConfig?.stats?.visionFOV ??
      CONFIG.MONSTER_FOV ??
      (Math.PI * 2 / 3);
    if (Number.isFinite(yaw) && Number.isFinite(rawFov)) {
      const fov = Math.max(0, Math.min(Math.PI * 2, rawFov));
      const eps = 1e-4;
      if (fov < Math.PI * 2 - eps && dist > 0) {
        const dx = playerGrid.x - monsterGrid.x;
        const dz = playerGrid.y - monsterGrid.y;
        if (dx !== 0 || dz !== 0) {
          const angleToPlayer = Math.atan2(dx, dz);
          const delta = Math.atan2(Math.sin(angleToPlayer - yaw), Math.cos(angleToPlayer - yaw));
          if (Math.abs(delta) > fov * 0.5) return false;
        }
      }
    }

    const segmentHitsSmoke = (ax, az, bx, bz, cx, cz, r) => {
      const rr = Number.isFinite(r) ? r : 0;
      if (!(rr > 0)) return false;
      const abx = bx - ax;
      const abz = bz - az;
      const abLenSq = abx * abx + abz * abz;
      if (abLenSq <= 1e-8) {
        const dx = ax - cx;
        const dz = az - cz;
        return dx * dx + dz * dz <= rr * rr;
      }
      let t = ((cx - ax) * abx + (cz - az) * abz) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      const px = ax + abx * t;
      const pz = az + abz * t;
      const dx = px - cx;
      const dz = pz - cz;
      return dx * dx + dz * dz <= rr * rr;
    };

    const clouds = typeof worldState?.getSmokeClouds === 'function'
      ? worldState.getSmokeClouds()
      : (Array.isArray(worldState?.smokeClouds) ? worldState.smokeClouds : []);

    if (Array.isArray(clouds) && clouds.length > 0) {
      const tileSize = CONFIG.TILE_SIZE || 1;
      const ax = (monsterGrid.x + 0.5) * tileSize;
      const az = (monsterGrid.y + 0.5) * tileSize;
      const bx = (playerGrid.x + 0.5) * tileSize;
      const bz = (playerGrid.y + 0.5) * tileSize;

      for (const cloud of clouds) {
        if (!cloud) continue;
        const life = Number(cloud.life);
        if (!(life > 0)) continue;
        const radius = Number(cloud.radius) || 0;
        if (!(radius > 0)) continue;
        const cx = Number.isFinite(cloud.x)
          ? cloud.x
          : (Number.isFinite(cloud.position?.x) ? cloud.position.x : (Number.isFinite(cloud.world?.x) ? cloud.world.x : 0));
        const cz = Number.isFinite(cloud.z)
          ? cloud.z
          : (Number.isFinite(cloud.position?.z) ? cloud.position.z : (Number.isFinite(cloud.world?.z) ? cloud.world.z : 0));
        if (segmentHitsSmoke(ax, az, bx, bz, cx, cz, radius)) return false;
      }
    }

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
