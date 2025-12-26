import { CONFIG, resolveMonsterCount } from './config.js';
import { MonsterTypes } from '../ai/monsterTypes.js';
import { EVENTS } from './events.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const TYPE_COST = {
  HUNTER: 3,
  SENTINEL: 2,
  STALKER: 2,
  RUSHER: 2,
  WANDERER: 1,
  GREETER: 1
};

function costForType(typeConfig) {
  const id = typeConfig?.id;
  if (typeof id === 'string' && TYPE_COST[id] !== undefined) return TYPE_COST[id];
  return 1;
}

function deepClone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

export class SpawnDirector {
  constructor(monsterManager, playerRef = null, pickupManager = null, eventBus = null) {
    this.monsterManager = monsterManager;
    this.playerRef = playerRef;
    this.pickupManager = pickupManager;
    this.eventBus = eventBus;
    this.gameState = null;
    this.gun = null;

    this.enabled = CONFIG.SPAWN_DIRECTOR_ENABLED ?? true;

    this.levelConfig = null;
    this.targetAlive = 0;

    this.waveIndex = 0;
    this.waveCooldown = 0;
    this.spawnBudget = 0;

    this.pendingWaves = [];
    this.spawnPromise = null;

    this.offMonsterKilled = this.eventBus?.on?.(EVENTS.MONSTER_KILLED, (info) => {
      if (info?.monsterManager && info.monsterManager !== this.monsterManager) return;
      this.onMonsterKilled(info);
    }) || null;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.pendingWaves = [];
      this.spawnPromise = null;
    }
  }

  setPickupManager(pickupManager) {
    this.pickupManager = pickupManager;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
    if (this.offMonsterKilled) {
      this.offMonsterKilled();
      this.offMonsterKilled = null;
    }
    this.offMonsterKilled = this.eventBus?.on?.(EVENTS.MONSTER_KILLED, (info) => {
      if (info?.monsterManager && info.monsterManager !== this.monsterManager) return;
      this.onMonsterKilled(info);
    }) || null;
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
    this.pickupManager?.setPlayerRef?.(playerRef);
  }

  setGameState(gameState) {
    this.gameState = gameState;
    this.pickupManager?.setGameState?.(gameState);
  }

  setGun(gun) {
    this.gun = gun;
    this.pickupManager?.setGun?.(gun);
  }

  async startLevel(levelConfig) {
    this.levelConfig = levelConfig;
    this.targetAlive = resolveMonsterCount(levelConfig);
    this.waveIndex = 0;
    this.waveCooldown = 0;
    this.spawnBudget = 0;
    this.pendingWaves = [];
    this.spawnPromise = null;

    this.pickupManager?.clear?.();

    if (this.monsterManager) {
      this.monsterManager.levelConfig = levelConfig;
      this.monsterManager.setAutoRespawnEnabled?.(false);
    }

    const initialRatio = CONFIG.SPAWN_DIRECTOR_INITIAL_RATIO ?? 0.6;
    const initial = clamp(Math.round(this.targetAlive * initialRatio), 0, this.targetAlive);
    await this.spawnUntilAlive(initial);
  }

  async spawnUntilAlive(desiredAlive) {
    if (!this.monsterManager?.spawnAtGrid) return;
    const cap = Math.max(0, desiredAlive);

    while ((this.monsterManager.getMonsters?.().length || 0) < cap) {
      const gap = cap - (this.monsterManager.getMonsters?.().length || 0);
      const wave = this.planWave(gap, { forceBudget: 999 });
      if (!wave) break;
      await this.spawnWave(wave);
    }
  }

  onMonsterKilled(info) {
    this.maybeDrop(info);
    if (!this.enabled) return;

    // Allow faster replacement tempo after kills.
    this.spawnBudget += 0.8;
  }

  maybeDrop(info) {
    const cause = info?.cause;
    if (cause && cause !== 'player') return;

    const pos = info?.worldPosition || info?.hitPosition || null;
    if (!pos) return;

    const gs = this.gameState || this.playerRef?.gameState || null;
    const healthPct = gs?.getHealthPercentage ? gs.getHealthPercentage() : 100;

    const hud = this.gun?.getHudState ? this.gun.getHudState() : null;
    const ammoReserve = hud?.ammoReserve ?? 0;
    const ammoInMag = hud?.ammoInMag ?? 0;

    const wantsHealth = healthPct < 55;
    const wantsAmmo = ammoReserve < 35 || ammoInMag < 6;

    const baseRoll = Math.random();

    const healthChance = wantsHealth ? 0.35 : 0.12;
    const ammoChance = wantsAmmo ? 0.42 : 0.16;

    const ttl = CONFIG.PICKUP_DROP_TTL ?? 22;

    if (wantsHealth && baseRoll < healthChance) {
      const amount = wantsHealth ? 25 : 15;
      this.eventBus?.emit?.(EVENTS.PICKUP_SPAWN_REQUESTED, {
        kind: 'health',
        position: pos,
        amount,
        ttl
      });
      return;
    }

    if (wantsAmmo && baseRoll < ammoChance) {
      const amount = wantsAmmo ? 45 : 25;
      this.eventBus?.emit?.(EVENTS.PICKUP_SPAWN_REQUESTED, {
        kind: 'ammo',
        position: pos,
        amount,
        ttl
      });
      return;
    }

    // Small universal drop chance
    if (baseRoll < 0.07) {
      const kind = Math.random() < 0.5 ? 'ammo' : 'health';
      const amount = kind === 'ammo' ? 25 : 15;
      const smallTtl = 18;
      this.eventBus?.emit?.(EVENTS.PICKUP_SPAWN_REQUESTED, {
        kind,
        position: pos,
        amount,
        ttl: smallTtl
      });
    }
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    this.pickupManager?.update?.(dt);

    if (!this.enabled) return;
    if (!this.monsterManager) return;

    this.waveCooldown = Math.max(0, this.waveCooldown - dt);

    const alive = this.monsterManager.getMonsters?.().length || 0;
    if (alive >= this.targetAlive) return;

    const budgetRate = CONFIG.SPAWN_DIRECTOR_BUDGET_RATE ?? 2.4;
    this.spawnBudget += dt * budgetRate;

    if (this.waveCooldown > 0) return;

    const gap = this.targetAlive - alive;
    const wave = this.planWave(gap);
    if (!wave) return;

    if (this.spawnBudget < wave.cost) return;
    this.spawnBudget -= wave.cost;

    const waveIndex = this.waveIndex;
    const queuedWave = { ...wave, waveIndex };
    this.pendingWaves.push(queuedWave);
    this.eventBus?.emit?.(EVENTS.WAVE_PLANNED, {
      waveIndex,
      wave: queuedWave,
      alive,
      targetAlive: this.targetAlive
    });
    this.waveCooldown = CONFIG.SPAWN_DIRECTOR_WAVE_INTERVAL ?? 3.5;
    this.processSpawnQueue();
  }

  processSpawnQueue() {
    if (this.spawnPromise) return;
    const next = this.pendingWaves.shift();
    if (!next) return;

    this.spawnPromise = this.spawnWave(next)
      .catch((err) => {
        console.warn('⚠️ Spawn wave failed:', err?.message || err);
      })
      .finally(() => {
        this.spawnPromise = null;
        if (this.pendingWaves.length > 0) {
          this.processSpawnQueue();
        }
      });
  }

  planWave(gap, options = {}) {
    if (!this.monsterManager?.worldState?.findRandomWalkableTile) return null;
    if (gap <= 0) return null;

    // Keep per-wave spawns small to avoid sudden FPS drops from many model instantiations.
    const maxMembers = clamp(gap, 1, 3);
    const baseBudget = 7 + Math.floor(this.waveIndex * 0.6);
    const waveBudget = options.forceBudget ?? clamp(baseBudget, 4, 14);

    const members = this.buildSquadMembers(waveBudget, maxMembers);
    if (!members || members.length === 0) return null;

    const cost = members.reduce((acc, m) => acc + costForType(m?.type), 0);
    return { members, cost };
  }

  buildSquadMembers(budget, maxMembers) {
    const members = [];
    const b = Number.isFinite(budget) ? budget : 6;

    const wantRusher = this.waveIndex >= 5 && Math.random() < 0.35;
    const wantExtra = this.waveIndex >= 8 && Math.random() < 0.25;

    const tryAdd = (member) => {
      if (members.length >= maxMembers) return false;
      const t = member?.type;
      if (!t) return false;
      const nextCost = members.reduce((acc, cur) => acc + costForType(cur?.type), 0) + costForType(t);
      if (nextCost > b) return false;
      members.push(member);
      return true;
    };

    // Core roles: leader + flanker + cover
    tryAdd({ role: 'leader', type: MonsterTypes.HUNTER });
    tryAdd({ role: 'flanker', type: MonsterTypes.STALKER });
    tryAdd({ role: 'cover', type: MonsterTypes.SENTINEL });

    if (wantRusher) {
      tryAdd({ role: 'rusher', type: MonsterTypes.RUSHER });
    }
    if (wantExtra) {
      tryAdd({ role: 'support', type: Math.random() < 0.5 ? MonsterTypes.STALKER : MonsterTypes.WANDERER });
    }

    // If budget is low, ensure we still spawn something.
    if (members.length === 0) {
      members.push({ role: 'scout', type: MonsterTypes.WANDERER });
    }

    // Cap to maxMembers.
    return members.slice(0, maxMembers);
  }

  pickSquadSpawns(count) {
    const spawns = [];
    const existing = this.monsterManager.getMonsterPositions?.() || [];

    const leader = this.monsterManager.pickSpreadOutSpawn(existing);
    spawns.push(leader);

    for (let i = 1; i < count; i++) {
      const around = this.pickSpawnNear(leader, [...existing, ...spawns]);
      spawns.push(around || this.monsterManager.pickSpreadOutSpawn([...existing, ...spawns]));
    }

    return spawns;
  }

  pickSpawnNear(centerGrid, occupied) {
    const ws = this.monsterManager.worldState;
    if (!ws?.isWalkable) return null;
    const playerGrid = this.playerRef?.getGridPosition?.() || null;

    const minPlayerDist = Math.max(3, Math.floor(Math.max(ws.width || 0, ws.height || 0) * 0.22));
    const occupiedSet = new Set((occupied || []).map(p => `${p.x},${p.y}`));

    for (let i = 0; i < 60; i++) {
      const dist = 4 + Math.floor(Math.random() * 7); // 4..10 tiles
      const angle = Math.random() * Math.PI * 2;
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);
      const x = centerGrid.x + dx;
      const y = centerGrid.y + dy;
      if (occupiedSet.has(`${x},${y}`)) continue;
      if (!ws.isWalkable(x, y)) continue;
      if (playerGrid) {
        const d = Math.abs(x - playerGrid.x) + Math.abs(y - playerGrid.y);
        if (d < minPlayerDist) continue;
      }
      return { x, y };
    }

    return null;
  }

  async spawnWave(wave) {
    if (!wave?.members || wave.members.length === 0) return;
    if (!this.monsterManager?.spawnAtGrid) return;

    const waveIndex = Number.isFinite(wave.waveIndex) ? wave.waveIndex : this.waveIndex;
    const squadId = `${Date.now()}-${waveIndex}-${Math.floor(Math.random() * 1000)}`;
    const spawns = this.pickSquadSpawns(wave.members.length);
    this.eventBus?.emit?.(EVENTS.WAVE_SPAWNED, {
      waveIndex,
      wave: { ...wave },
      spawns: spawns.map(s => ({ x: s.x, y: s.y }))
    });

    for (let i = 0; i < wave.members.length; i++) {
      const member = wave.members[i];
      const baseType = member?.type || MonsterTypes.WANDERER;
      const typeConfig = deepClone(baseType) || baseType;
      typeConfig.squad = {
        squadId,
        waveIndex,
        role: member?.role || 'member'
      };
      await this.monsterManager.spawnAtGrid(spawns[i], typeConfig);
    }

    this.waveIndex = Math.max(this.waveIndex, waveIndex + 1);
  }
}
