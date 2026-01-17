import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';

export class MonsterPerception {
  constructor(options = {}) {
    this.worldState = options.worldState || null;
    this.noiseEvents = [];
    this.scentEvents = [];
    this.alertCooldowns = new Map(); // Monster -> seconds
    this.lastPlayerNoisePos = null;
    this.playerNoiseAccumulator = 0;
    this.lastPlayerScentPos = null;
    this.playerScentAccumulator = 0;
  }

  setWorldState(worldState) {
    this.worldState = worldState || null;
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

  isInDarkZoneWorld(x, z) {
    const ws = this.worldState;
    const zones = typeof ws?.getDarkZones === 'function'
      ? ws.getDarkZones()
      : (Array.isArray(ws?.darkZones) ? ws.darkZones : []);
    if (!Array.isArray(zones) || zones.length === 0) return false;

    const px = Number(x) || 0;
    const pz = Number(z) || 0;
    for (const zone of zones) {
      if (!zone) continue;
      const r = Number(zone.radius) || 0;
      if (!(r > 0)) continue;
      const cx = Number.isFinite(zone.x) ? zone.x : (Number.isFinite(zone.position?.x) ? zone.position.x : 0);
      const cz = Number.isFinite(zone.z) ? zone.z : (Number.isFinite(zone.position?.z) ? zone.position.z : 0);
      const dx = px - cx;
      const dz = pz - cz;
      if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
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

    const globalMult = Number(CONFIG.AI_HEARING_GLOBAL_MULT);
    if (Number.isFinite(globalMult)) range *= Math.max(0.1, Math.min(3.0, globalMult));

    const jammed = Number(monster?.perceptionJammedTimer) || 0;
    if (jammed > 0) {
      const multRaw = Number(CONFIG.AI_JAMMED_HEARING_MULT);
      const mult = Number.isFinite(multRaw) ? Math.max(0, Math.min(1, multRaw)) : 0.2;
      range *= mult;
    }

    const mg = monster?.getGridPosition?.() || null;
    if (mg && Number.isFinite(mg.x) && Number.isFinite(mg.y)) {
      const tileSize = CONFIG.TILE_SIZE || 1;
      const mx = (mg.x + 0.5) * tileSize;
      const mz = (mg.y + 0.5) * tileSize;
      if (this.isInDarkZoneWorld(mx, mz)) {
        const multRaw = Number(CONFIG.AI_DARK_HEARING_MULT);
        const mult = Number.isFinite(multRaw) ? Math.max(0.5, Math.min(3.0, multRaw)) : 1.35;
        range *= mult;
      }
    }

    return range;
  }

  getMonsterSmellRange(monster, brain) {
    const brainSmell = brain?.config?.smellRange;
    let range = Number.isFinite(brainSmell) ? brainSmell : null;
    const statsSmell = monster?.typeConfig?.stats?.smellRange;
    if (range === null && Number.isFinite(statsSmell)) range = statsSmell;
    if (range === null) range = 0;

    const globalMult = Number(CONFIG.AI_SMELL_GLOBAL_MULT);
    if (Number.isFinite(globalMult)) range *= Math.max(0.1, Math.min(3.0, globalMult));

    const jammed = Number(monster?.perceptionJammedTimer) || 0;
    if (jammed > 0) {
      const multRaw = Number(CONFIG.AI_JAMMED_SMELL_MULT);
      const mult = Number.isFinite(multRaw) ? Math.max(0, Math.min(1, multRaw)) : 0.15;
      range *= mult;
    }

    const mg = monster?.getGridPosition?.() || null;
    if (mg && Number.isFinite(mg.x) && Number.isFinite(mg.y)) {
      const tileSize = CONFIG.TILE_SIZE || 1;
      const mx = (mg.x + 0.5) * tileSize;
      const mz = (mg.y + 0.5) * tileSize;
      if (this.isInDarkZoneWorld(mx, mz)) {
        const multRaw = Number(CONFIG.AI_DARK_SMELL_MULT);
        const mult = Number.isFinite(multRaw) ? Math.max(0.5, Math.min(3.0, multRaw)) : 1.25;
        range *= mult;
      }
    }

    return range;
  }

  pickAudibleNoise(monster, brain, pathfinder = null) {
    if (!monster || !brain) return null;
    if (!this.noiseEvents || this.noiseEvents.length === 0) return null;

    const hearingRange = this.getMonsterHearingRange(monster, brain);
    if (!Number.isFinite(hearingRange) || hearingRange <= 0) return null;

    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return null;

    const baseHearing = CONFIG.AI_BASE_HEARING ?? 10;
    const difficulty = CONFIG.AI_DIFFICULTY ?? 1.0;
    const hearingScale = Math.max(0.15, hearingRange / Math.max(1, baseHearing)) * Math.max(0.5, difficulty);

    const candidates = [];
    for (const noise of this.noiseEvents) {
      if (!noise?.grid) continue;
      const dx = monsterGrid.x - noise.grid.x;
      const dy = monsterGrid.y - noise.grid.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      const audible = (noise.radius || 0) * hearingScale;
      if (dist > audible) continue;

      const priority = this.getNoisePriority(noise.kind);
      const score = priority * 1000 + (audible - dist) * 10 + (noise.life / (noise.maxLife || 1));
      candidates.push({
        score,
        kind: noise.kind,
        grid: noise.grid,
        world: noise.world,
        priority,
        strength: noise.strength ?? 1.0,
        audible
      });
    }

    if (candidates.length === 0) return null;

    // Wall attenuation: optionally re-score the best few candidates using shortest-path distance.
    const usePathDist = CONFIG.AI_HEARING_USE_PATH_DISTANCE !== false;
    const maxPathChecks = Math.max(0, Math.round(Number(CONFIG.AI_HEARING_PATH_DISTANCE_CANDIDATES) || 4));
    if (usePathDist && maxPathChecks > 0 && pathfinder?.findPath && this.worldState?.isWalkable) {
      candidates.sort((a, b) => b.score - a.score);
      const slice = candidates.slice(0, Math.min(maxPathChecks, candidates.length));

      let best = null;
      for (const c of slice) {
        const path = pathfinder.findPath(monsterGrid, c.grid, true, null) || [];
        const hasPath = Array.isArray(path) && path.length > 0;

        const corridorMult = Number(CONFIG.AI_HEARING_CORRIDOR_COST_MULT);
        const roomMult = Number(CONFIG.AI_HEARING_ROOM_COST_MULT);
        const doorMult = Number(CONFIG.AI_HEARING_DOOR_COST_MULT);

        const tileCost = (x, y) => {
          const ws = this.worldState;
          const rt = ws?.getRoomType ? ws.getRoomType(x, y) : 0;
          const tile = ws?.getTile ? ws.getTile(x, y) : null;

          let mult = 1.0;
          const isCorridor = rt === 0; // ROOM_TYPES.CORRIDOR == 0
          if (isCorridor && Number.isFinite(corridorMult)) mult *= Math.max(0.2, corridorMult);
          if (!isCorridor && Number.isFinite(roomMult)) mult *= Math.max(0.2, roomMult);

          if (tile === 2 && Number.isFinite(doorMult)) mult *= Math.max(0.2, doorMult); // TILE_TYPES.DOOR == 2
          return mult;
        };

        let effectiveDist = Infinity;
        if (hasPath) {
          let cost = 0;
          for (let i = 1; i < path.length; i++) {
            const t = path[i];
            cost += tileCost(t.x, t.y);
          }
          effectiveDist = cost;
        } else if (CONFIG.AI_HEARING_THROUGH_WALL_ENABLED !== false && this.worldState?.getSoundOcclusionStats) {
          const stats = this.worldState.getSoundOcclusionStats(monsterGrid, c.grid);
          const maxWalls = Math.max(0, Math.round(Number(CONFIG.AI_HEARING_MAX_WALL_TILES) || 0));
          if (stats && (stats.blocked || 0) > 0 && (stats.blocked || 0) <= maxWalls) {
            const wallPenalty = Math.max(0, Number(CONFIG.AI_HEARING_WALL_PENALTY) || 6);
            const doorPenalty = Math.max(0, Number(CONFIG.AI_HEARING_BLOCKED_DOOR_PENALTY) || 3);
            const dist = Math.abs(monsterGrid.x - c.grid.x) + Math.abs(monsterGrid.y - c.grid.y);
            effectiveDist = dist + (stats.blocked * wallPenalty) + ((stats.blockedDoors || 0) * doorPenalty);
          }
        }

        if (!Number.isFinite(effectiveDist) || effectiveDist > c.audible) continue;

        const score = c.priority * 1000 + (c.audible - effectiveDist) * 10 + Math.random() * 0.5;
        if (!best || score > best.score) {
          best = { ...c, score };
        }
      }
      if (best) {
        const { audible, ...out } = best;
        return out;
      }
    }

    // Fallback: simple Manhattan scoring.
    let best = null;
    for (const c of candidates) {
      if (!best || c.score > best.score) best = c;
    }
    if (!best) return null;
    const { audible, ...out } = best;
    return out;
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

    const radiusMult = Number.isFinite(options.radiusMult) ? options.radiusMult : 1.0;
    const strengthMult = Number.isFinite(options.strengthMult) ? options.strengthMult : 1.0;

    return this.registerNoise(playerPos, {
      kind,
      radius: radius * radiusMult,
      ttl,
      strength: strength * strengthMult,
      source: 'player'
    });
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

    const radiusMult = Number.isFinite(options.radiusMult) ? options.radiusMult : 1.0;
    const strengthMult = Number.isFinite(options.strengthMult) ? options.strengthMult : 1.0;

    return this.registerScent(playerPos, {
      kind,
      radius: radius * radiusMult,
      ttl,
      strength: strength * strengthMult,
      source: 'player'
    });
  }

  canMonsterSeePlayer(monster, playerGrid, worldState) {
    if (!monster || !playerGrid) return false;
    if ((monster.perceptionBlindedTimer || 0) > 0) return false;
    const monsterGrid = monster.getGridPosition?.();
    if (!monsterGrid) return false;
    let vision = monster.visionRange ?? monster.typeConfig?.stats?.visionRange ?? CONFIG.MONSTER_VISION_RANGE ?? 12;

    // Jammed: shorter effective vision.
    if ((monster.perceptionJammedTimer || 0) > 0) {
      const m = Number(CONFIG.AI_JAMMED_VISION_MULT);
      const mult = Number.isFinite(m) ? Math.max(0.15, Math.min(1.0, m)) : 0.65;
      vision *= mult;
    }

    // Darkness reduces effective vision range (e.g. destroyed light fixtures).
    const darkZones = typeof worldState?.getDarkZones === 'function'
      ? worldState.getDarkZones()
      : (Array.isArray(worldState?.darkZones) ? worldState.darkZones : []);
    if (Array.isArray(darkZones) && darkZones.length > 0) {
      const tileSize = CONFIG.TILE_SIZE || 1;
      const mx = (monsterGrid.x + 0.5) * tileSize;
      const mz = (monsterGrid.y + 0.5) * tileSize;
      const px = (playerGrid.x + 0.5) * tileSize;
      const pz = (playerGrid.y + 0.5) * tileSize;

      let inDark = false;
      for (const z of darkZones) {
        if (!z) continue;
        const r = Number(z.radius) || 0;
        if (!(r > 0)) continue;
        const cx = Number.isFinite(z.x) ? z.x : (Number.isFinite(z.position?.x) ? z.position.x : 0);
        const cz = Number.isFinite(z.z) ? z.z : (Number.isFinite(z.position?.z) ? z.position.z : 0);
        const dxm = mx - cx;
        const dzm = mz - cz;
        const dxp = px - cx;
        const dzp = pz - cz;
        if (dxm * dxm + dzm * dzm <= r * r || dxp * dxp + dzp * dzp <= r * r) {
          inDark = true;
          break;
        }
      }
      if (inDark) {
        const m = Number(CONFIG.AI_DARK_VISION_MULT);
        const mult = Number.isFinite(m) ? Math.max(0.15, Math.min(1.0, m)) : 0.55;
        vision *= mult;
      }
    }
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
