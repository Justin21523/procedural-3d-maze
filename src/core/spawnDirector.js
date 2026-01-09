import { CONFIG, resolveMonsterCount } from './config.js';
import { MonsterTypes } from '../ai/monsterTypes.js';
import { EVENTS } from './events.js';
import { gridToWorldCenter, pickDistinctTiles } from './missions/missionUtils.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toCount(value, fallback = 0) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, n);
}

function toPositiveNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, n);
}

function toChance(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return clamp(Number(fallback) || 0, 0, 1);
  return clamp(n, 0, 1);
}

const TYPE_COST = {
  HUNTER: 3,
  SENTINEL: 2,
  STALKER: 2,
  RUSHER: 2,
  WEEPING_ANGEL: 3,
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

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function normalizeWeight(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function pickWeighted(entries) {
  if (!entries || entries.length === 0) return null;
  const total = entries.reduce((acc, e) => acc + normalizeWeight(e?.weight, 0), 0);
  if (!(total > 0)) {
    return entries[Math.floor(Math.random() * entries.length)];
  }
  let r = Math.random() * total;
  for (const e of entries) {
    r -= normalizeWeight(e?.weight, 0);
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

function countByTypeId(monsters) {
  const map = new Map();
  for (const monster of monsters || []) {
    if (!monster || monster.isDead || monster.isDying) continue;
    const id = monster.typeConfig?.id;
    if (typeof id !== 'string' || !id) continue;
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

export class SpawnDirector {
  constructor(monsterManager, playerRef = null, pickupManager = null, eventBus = null) {
    this.monsterManager = monsterManager;
    this.playerRef = playerRef;
    this.pickupManager = pickupManager;
    this.eventBus = eventBus;
    this.gameState = null;
    this.gun = null;
    this.projectileManager = null;

    this.enabled = CONFIG.SPAWN_DIRECTOR_ENABLED ?? true;

    this.levelConfig = null;
    this.targetAlive = 0;

    this.waveIndex = 0;
    this.waveCooldown = 0;
    this.spawnBudget = 0;

    this.pendingWaves = [];
    this.spawnPromise = null;
    this.spawnedTypeCounts = new Map(); // typeId -> count (per level/run)

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

  setProjectileManager(projectileManager) {
    this.projectileManager = projectileManager;
  }

  getPerfPressure() {
    const pm = this.projectileManager;
    if (!pm) return 0;

    const ratio = (count, cap) => {
      const c = Math.max(0, Number(count) || 0);
      const k = Number(cap);
      if (!Number.isFinite(k) || k <= 0) return 0;
      return c / k;
    };

    const proj = pm?.projectiles?.length ?? 0;
    const impacts = pm?.impacts?.length ?? 0;
    const explosions = pm?.explosions?.length ?? 0;

    return Math.max(
      ratio(proj, CONFIG.MAX_ACTIVE_PROJECTILES),
      ratio(impacts, CONFIG.MAX_ACTIVE_IMPACTS),
      ratio(explosions, CONFIG.MAX_ACTIVE_EXPLOSIONS),
      0
    );
  }

  async startLevel(levelConfig) {
    this.levelConfig = levelConfig;
    this.targetAlive = resolveMonsterCount(levelConfig);
    this.waveIndex = 0;
    this.waveCooldown = 0;
    this.spawnBudget = 0;
    this.pendingWaves = [];
    this.spawnPromise = null;
    this.spawnedTypeCounts = new Map();

    this.pickupManager?.clear?.();
    this.applyLevelPickupLimits();
    this.spawnInitialToolPickups();

    if (this.monsterManager) {
      this.monsterManager.levelConfig = levelConfig;
      this.monsterManager.setAutoRespawnEnabled?.(false);
    }

    const initialRatio = CONFIG.SPAWN_DIRECTOR_INITIAL_RATIO ?? 0.6;
    const initial = clamp(Math.round(this.targetAlive * initialRatio), 0, this.targetAlive);
    await this.spawnUntilAlive(initial);
  }

  applyLevelPickupLimits() {
    const pm = this.pickupManager;
    if (!pm) return;
    const raw = this.levelConfig?.pickups?.maxActive;
    const fallback = CONFIG.SPAWN_DIRECTOR_MAX_PICKUPS ?? pm.maxPickups ?? 18;
    const maxPickups = Number.isFinite(Number(raw)) ? Math.max(0, Math.round(Number(raw))) : Math.max(0, Math.round(Number(fallback) || 0));
    if (typeof pm.setMaxPickups === 'function') {
      pm.setMaxPickups(maxPickups);
    } else {
      pm.maxPickups = maxPickups;
    }
  }

  getToolPickupSettings() {
    const tools = this.levelConfig?.pickups?.tools || null;
    const start = tools?.start || null;
    const drop = tools?.drop || null;

    const startLure = toCount(start?.lure, CONFIG.SPAWN_DIRECTOR_START_TOOL_LURE ?? 1);
    const startTrap = toCount(start?.trap, CONFIG.SPAWN_DIRECTOR_START_TOOL_TRAP ?? 1);
    const startJammer = toCount(start?.jammer, CONFIG.SPAWN_DIRECTOR_START_TOOL_JAMMER ?? 1);
    const startDecoy = toCount(start?.decoy, CONFIG.SPAWN_DIRECTOR_START_TOOL_DECOY ?? 0);
    const startSmoke = toCount(start?.smoke, CONFIG.SPAWN_DIRECTOR_START_TOOL_SMOKE ?? 0);
    const startFlash = toCount(start?.flash, CONFIG.SPAWN_DIRECTOR_START_TOOL_FLASH ?? 0);
    const startSensor = toCount(start?.sensor, CONFIG.SPAWN_DIRECTOR_START_TOOL_SENSOR ?? 0);
    const startMine = toCount(start?.mine, CONFIG.SPAWN_DIRECTOR_START_TOOL_MINE ?? 0);

    const enabled = drop?.enabled === false ? false : true;
    const chance = enabled
      ? toChance(drop?.chance, CONFIG.SPAWN_DIRECTOR_TOOL_DROP_CHANCE ?? 0.0)
      : 0;
    const ttl = toPositiveNumber(drop?.ttl ?? tools?.ttl, CONFIG.SPAWN_DIRECTOR_TOOL_PICKUP_TTL ?? 45);

    const weightsRaw = drop?.weights || tools?.weights || null;
    const strictWeights = (drop?.strictWeights === true) || (tools?.strictWeights === true);
    const wLure = normalizeWeight(weightsRaw?.lure, 0);
    const wTrap = normalizeWeight(weightsRaw?.trap, 0);
    const wJammer = normalizeWeight(weightsRaw?.jammer, 0);
    const wDecoy = normalizeWeight(weightsRaw?.decoy, 0);
    const wSmoke = normalizeWeight(weightsRaw?.smoke, 0);
    const wFlash = normalizeWeight(weightsRaw?.flash, 0);
    const wSensor = normalizeWeight(weightsRaw?.sensor, 0);
    const wMine = normalizeWeight(weightsRaw?.mine, 0);
    const wSum = wLure + wTrap + wJammer + wDecoy + wSmoke + wFlash + wSensor + wMine;
    const defaultWeights = { lure: 0.35, trap: 0.25, jammer: 0.15, decoy: 0.1, smoke: 0.08, flash: 0.06, sensor: 0.06, mine: 0.05 };
    const weights = wSum > 0
      ? { lure: wLure, trap: wTrap, jammer: wJammer, decoy: wDecoy, smoke: wSmoke, flash: wFlash, sensor: wSensor, mine: wMine }
      : defaultWeights;

    // Back-compat / human-error guard: if a level specifies tool weights but forgets the newer tools,
    // softly inject them so runs still see diverse tool drops. Set `strictWeights:true` to opt out.
    if (!strictWeights && wSum > 0 && weightsRaw && typeof weightsRaw === 'object') {
      const has = (k) => Object.prototype.hasOwnProperty.call(weightsRaw, k);
      const mentionsNewToolKey = has('decoy') || has('smoke') || has('flash') || has('sensor') || has('mine');
      if (!mentionsNewToolKey) {
        weights.decoy = Math.max(weights.decoy || 0, defaultWeights.decoy);
        weights.smoke = Math.max(weights.smoke || 0, defaultWeights.smoke);
        weights.flash = Math.max(weights.flash || 0, defaultWeights.flash);
        weights.sensor = Math.max(weights.sensor || 0, defaultWeights.sensor);
        weights.mine = Math.max(weights.mine || 0, defaultWeights.mine);
      }
    }

    return {
      start: {
        lure: startLure,
        trap: startTrap,
        jammer: startJammer,
        decoy: startDecoy,
        smoke: startSmoke,
        flash: startFlash,
        sensor: startSensor,
        mine: startMine
      },
      drop: { chance, ttl, weights }
    };
  }

  pickToolDropKind(weights) {
    const w = weights || {};
    const entries = [
      { kind: 'lure', weight: normalizeWeight(w.lure, 0) },
      { kind: 'trap', weight: normalizeWeight(w.trap, 0) },
      { kind: 'jammer', weight: normalizeWeight(w.jammer, 0) },
      { kind: 'decoy', weight: normalizeWeight(w.decoy, 0) },
      { kind: 'smoke', weight: normalizeWeight(w.smoke, 0) },
      { kind: 'flash', weight: normalizeWeight(w.flash, 0) },
      { kind: 'sensor', weight: normalizeWeight(w.sensor, 0) },
      { kind: 'mine', weight: normalizeWeight(w.mine, 0) },
    ].filter((e) => e.weight > 0);
    if (entries.length === 0) return 'lure';
    return (pickWeighted(entries) || entries[0]).kind || 'lure';
  }

  spawnInitialToolPickups() {
    const bus = this.eventBus;
    if (!bus?.emit) return;

    const ws = this.monsterManager?.worldState || null;
    if (!ws?.isWalkableWithMargin) return;

    const settings = this.getToolPickupSettings();
    const lureCount = toCount(settings?.start?.lure, 0);
    const trapCount = toCount(settings?.start?.trap, 0);
    const jammerCount = toCount(settings?.start?.jammer, 0);
    const decoyCount = toCount(settings?.start?.decoy, 0);
    const smokeCount = toCount(settings?.start?.smoke, 0);
    const flashCount = toCount(settings?.start?.flash, 0);
    const sensorCount = toCount(settings?.start?.sensor, 0);
    const mineCount = toCount(settings?.start?.mine, 0);

    const kinds = [];
    for (let i = 0; i < lureCount; i++) kinds.push('lure');
    for (let i = 0; i < trapCount; i++) kinds.push('trap');
    for (let i = 0; i < jammerCount; i++) kinds.push('jammer');
    for (let i = 0; i < decoyCount; i++) kinds.push('decoy');
    for (let i = 0; i < smokeCount; i++) kinds.push('smoke');
    for (let i = 0; i < flashCount; i++) kinds.push('flash');
    for (let i = 0; i < sensorCount; i++) kinds.push('sensor');
    for (let i = 0; i < mineCount; i++) kinds.push('mine');
    if (kinds.length === 0) return;
    shuffleInPlace(kinds);

    const spawnGrid = this.playerRef?.getGridPosition ? this.playerRef.getGridPosition() : null;
    const minDistFrom = spawnGrid ? [spawnGrid] : [];
    const tiles = pickDistinctTiles(ws, kinds.length, {
      minDistFrom,
      minDist: 6,
      margin: 1
    });
    if (!tiles || tiles.length === 0) return;

    const ttl = toPositiveNumber(settings?.drop?.ttl, CONFIG.SPAWN_DIRECTOR_TOOL_PICKUP_TTL ?? 45);
    for (let i = 0; i < tiles.length && i < kinds.length; i++) {
      const tile = tiles[i];
      const kind = kinds[i];
      if (!tile || !kind) continue;
      const world = gridToWorldCenter(tile);
      bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, {
        kind,
        position: { x: world.x, y: 0.1, z: world.z },
        amount: 1,
        ttl
      });
    }
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

    const toolSettings = this.getToolPickupSettings();
    const toolChance = toChance(toolSettings?.drop?.chance, 0);
    if (toolChance > 0 && baseRoll < toolChance) {
      const kind = this.pickToolDropKind(toolSettings?.drop?.weights);
      const toolTtl = toPositiveNumber(toolSettings?.drop?.ttl, CONFIG.SPAWN_DIRECTOR_TOOL_PICKUP_TTL ?? 45);
      this.eventBus?.emit?.(EVENTS.PICKUP_SPAWN_REQUESTED, {
        kind,
        position: pos,
        amount: 1,
        ttl: toolTtl
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
    const pressure = this.getPerfPressure();
    const start = Number.isFinite(CONFIG.SPAWN_DIRECTOR_PRESSURE_START) ? CONFIG.SPAWN_DIRECTOR_PRESSURE_START : 0.65;
    const stop = Number.isFinite(CONFIG.SPAWN_DIRECTOR_PRESSURE_STOP) ? CONFIG.SPAWN_DIRECTOR_PRESSURE_STOP : 0.85;

    if (pressure >= stop) {
      // Under heavy projectile/FX load, pause monster spawns to keep FPS stable.
      this.waveCooldown = Math.max(this.waveCooldown, 0.35);
      return;
    }

    let rateMult = 1;
    if (pressure > start && stop > start) {
      const t = clamp((pressure - start) / (stop - start), 0, 1);
      rateMult = clamp(1 - t * 0.85, 0.15, 1);
    }

    this.spawnBudget += dt * budgetRate * rateMult;

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

  getTypeCandidates() {
    const candidates = [];
    const raw = this.levelConfig?.monsters?.typeWeights || null;
    const hasWeights = raw && typeof raw === 'object';
    const poolRaw = this.levelConfig?.monsters?.typePool || null;
    const pool = Array.isArray(poolRaw)
      ? poolRaw.map((v) => String(v || '').trim()).filter(Boolean)
      : null;

    const add = (key, weight, explicit = false) => {
      const type = MonsterTypes[key];
      if (!type) return;
      const w = normalizeWeight(weight, 0);
      if (!(w > 0)) return;
      candidates.push({ key, id: type.id || key, type, weight: w, explicit });
    };

    if (hasWeights) {
      for (const [key, weight] of Object.entries(raw)) {
        add(key, weight, true);
      }
    }
    if (!hasWeights && pool && pool.length > 0) {
      for (const key of pool) {
        add(key, 1, true);
      }
    }

    // Default pool (keeps challenge; excludes GREETER unless explicitly weighted).
    if (candidates.length === 0) {
      add('HUNTER', 1.0);
      add('STALKER', 0.85);
      add('SENTINEL', 0.75);
      add('RUSHER', 0.55);
      add('WANDERER', 0.45);
      add('WEEPING_ANGEL', 0.3);
    }

    // Diversity fallback: if weights are too narrow, inject a few core types at low weight.
    const unique = new Set(candidates.map((c) => c.id));
    const ensure = (key, weight) => {
      const type = MonsterTypes[key];
      const id = type?.id || key;
      if (!type || unique.has(id)) return;
      candidates.push({ key, id, type, weight: normalizeWeight(weight, 0.05), explicit: false });
      unique.add(id);
    };

    if (unique.size < 2) {
      ensure('STALKER', 0.18);
      ensure('SENTINEL', 0.16);
      ensure('RUSHER', 0.12);
      ensure('WANDERER', 0.1);
      ensure('WEEPING_ANGEL', 0.08);
      ensure('HUNTER', 0.2);
    }

    return candidates;
  }

  pickDiverseType({ candidates, budgetRemaining, avoidIds, waveCounts, aliveCounts } = {}) {
    const list = Array.isArray(candidates) ? candidates : [];
    const budget = Number.isFinite(budgetRemaining) ? budgetRemaining : Infinity;
    const avoid = avoidIds instanceof Set ? avoidIds : new Set();
    const spawnedCounts = this.spawnedTypeCounts || new Map();
    const alive = aliveCounts instanceof Map ? aliveCounts : new Map();
    const wave = waveCounts instanceof Map ? waveCounts : new Map();

    const withinBudget = (entry) => {
      const type = entry?.type;
      if (!type) return false;
      return costForType(type) <= budget;
    };

    let filtered = list.filter((e) => withinBudget(e) && !avoid.has(e.id));
    if (filtered.length === 0) {
      filtered = list.filter((e) => withinBudget(e));
    }
    if (filtered.length === 0) return null;

    const scoreCount = (id) => {
      const spawned = spawnedCounts.get(id) || 0;
      const aliveNow = alive.get(id) || 0;
      const inWave = wave.get(id) || 0;
      return spawned + aliveNow * 0.35 + inWave * 2.0;
    };

    let min = Infinity;
    for (const entry of filtered) {
      min = Math.min(min, scoreCount(entry.id));
    }
    const leastUsed = filtered.filter((e) => scoreCount(e.id) === min);
    const picked = pickWeighted(leastUsed) || leastUsed[0];
    return picked?.type || null;
  }

  buildSquadMembers(budget, maxMembers) {
    const members = [];
    const b = Number.isFinite(budget) ? budget : 6;
    const desired = clamp(maxMembers, 1, 3);
    const roles = ['leader', 'flanker', 'cover'].slice(0, desired);

    const candidates = this.getTypeCandidates();
    const aliveCounts = countByTypeId(this.monsterManager?.getMonsters?.() || []);
    const waveCounts = new Map();
    const avoidIds = new Set();

    let spent = 0;
    for (let i = 0; i < roles.length; i++) {
      const budgetRemaining = b - spent;
      const type = this.pickDiverseType({
        candidates,
        budgetRemaining,
        avoidIds,
        waveCounts,
        aliveCounts
      });
      if (!type) break;

      const typeId = type.id || type.name || 'UNKNOWN';
      const c = costForType(type);
      if (spent + c > b) break;

      members.push({ role: roles[i], type });
      spent += c;
      avoidIds.add(typeId);
      waveCounts.set(typeId, (waveCounts.get(typeId) || 0) + 1);
    }

    if (members.length === 0) {
      const fallback = this.pickDiverseType({
        candidates,
        budgetRemaining: b,
        avoidIds: new Set(),
        waveCounts: new Map(),
        aliveCounts
      }) || MonsterTypes.WANDERER;
      members.push({ role: 'leader', type: fallback });
    }

    return members.slice(0, desired);
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
      const typeId = baseType?.id || baseType?.name || 'UNKNOWN';
      this.spawnedTypeCounts.set(typeId, (this.spawnedTypeCounts.get(typeId) || 0) + 1);
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
