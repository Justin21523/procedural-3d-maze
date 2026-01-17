import { CONFIG } from './config.js';
import { ROOM_TYPES } from '../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811C9DC5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function ensureOdd(n) {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded + 1 : rounded;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v, fallback = null) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStringArray(list) {
  if (!Array.isArray(list)) return [];
  return list.map((s) => String(s || '').trim()).filter(Boolean);
}

function normalizeRoomType(value) {
  if (Number.isFinite(Number(value))) {
    const n = Math.round(Number(value));
    const ok = Object.values(ROOM_TYPES).includes(n);
    return ok ? n : null;
  }

  const key = String(value || '').trim().toUpperCase();
  if (!key) return null;
  const id = ROOM_TYPES[key];
  return Number.isFinite(id) ? id : null;
}

function normalizeRoomTypes(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const v of list) {
    const id = normalizeRoomType(v);
    if (Number.isFinite(id)) out.push(id);
  }
  return out.length > 0 ? out : null;
}

function normalizeRoomTypeWeights(rawWeights) {
  if (!isPlainObject(rawWeights)) return null;

  const out = {};
  for (const [k, v] of Object.entries(rawWeights)) {
    const id = normalizeRoomType(k);
    if (!Number.isFinite(id)) continue;
    const w = toNumber(v, null);
    if (!Number.isFinite(w)) continue;
    const weight = Math.max(0, w);
    if (weight <= 0) continue;
    out[id] = weight;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function normalizeMissionEntry(raw, index = 0) {
  const entry = isPlainObject(raw) ? raw : {};
  const id = String(entry.id || entry.missionId || `m${index + 1}`).trim();
  const template = String(entry.template || entry.type || '').trim();
  const required = entry.required !== false;

  const params = isPlainObject(entry.params) ? deepClone(entry.params) : {};
  const normalizeRoomTypeArrayParam = (key) => {
    if (!Array.isArray(params[key])) return;
    const roomTypes = normalizeRoomTypes(params[key]);
    if (roomTypes) params[key] = roomTypes;
    else delete params[key];
  };

  // Common mission params that specify room type allowlists.
  for (const key of [
    'roomTypes',
    'roomTypesFuses',
    'roomTypesPanel',
    'panelRoomTypes',
    'roomTypesEvidence',
    'roomTypesTerminal',
    'terminalRoomTypes',
    'roomTypesClues',
    'roomTypesKeypad',
    'clueRoomTypes',
    'keypadRoomTypes',
    // New templates may use these:
    'roomTypesKey',
    'roomTypesDoor',
    'roomTypesItems',
    'roomTypesAltars',
    'roomTypesTargets',
    'roomTypesShrines',
    'sequence'
  ]) {
    normalizeRoomTypeArrayParam(key);
  }

  return id && template ? { id, template, required, params } : null;
}

function normalizeMissionsConfig(rawMissions) {
  const missions = isPlainObject(rawMissions) ? rawMissions : {};

  const timeLimitSec = clamp(toInt(missions.timeLimitSec, 0) || 0, 0, 24 * 60 * 60);
  const listRaw = Array.isArray(missions.list) ? missions.list : [];
  const list = listRaw.map((m, idx) => normalizeMissionEntry(m, idx)).filter(Boolean);

  const requires = Array.isArray(missions?.exit?.requires)
    ? normalizeStringArray(missions.exit.requires)
    : list.filter((m) => m.required).map((m) => m.id);

  return {
    timeLimitSec,
    list,
    exit: { requires }
  };
}

function normalizeLevelConfig(raw, index = 0) {
  const src = isPlainObject(raw) ? deepClone(raw) : {};

  const id = clamp(toInt(src.id, index + 1) || (index + 1), 1, 9999);
  const name = String(src.name || `L${id}`).trim();

  const maze = isPlainObject(src.maze) ? src.maze : {};
  const width = ensureOdd(clamp(toInt(maze.width, CONFIG.MAZE_WIDTH || 31), 11, 201));
  const height = ensureOdd(clamp(toInt(maze.height, CONFIG.MAZE_HEIGHT || 31), 11, 201));
  const roomDensity = clamp(toNumber(maze.roomDensity, 2.8) ?? 2.8, 0.5, 20);
  const extraConnectionChance = clamp(toNumber(maze.extraConnectionChance, 0.1) ?? 0.1, 0, 0.8);

  const rooms = isPlainObject(src.rooms) ? src.rooms : {};
  const roomTypeWeights = normalizeRoomTypeWeights(rooms.typeWeights) || null;

  const monsters = isPlainObject(src.monsters) ? src.monsters : {};
  const monstersOut = {
    ...monsters,
    count: clamp(toInt(monsters.count, CONFIG.MONSTER_COUNT || 8) || (CONFIG.MONSTER_COUNT || 8), 0, 120),
    maxCount: clamp(toInt(monsters.maxCount, 0) || 0, 0, 240),
    speedMultiplier: clamp(toNumber(monsters.speedMultiplier, 1.0) ?? 1.0, 0.2, 5),
    visionMultiplier: clamp(toNumber(monsters.visionMultiplier, 1.0) ?? 1.0, 0.1, 5),
    memoryMultiplier: clamp(toNumber(monsters.memoryMultiplier, 1.0) ?? 1.0, 0.1, 5),
    typeWeights: isPlainObject(monsters.typeWeights) ? monsters.typeWeights : null,
    allowSprintTypes: normalizeStringArray(monsters.allowSprintTypes)
  };

  const player = isPlainObject(src.player) ? src.player : {};
  const playerOut = {
    ...player,
    maxHealthMultiplier: clamp(toNumber(player.maxHealthMultiplier, 1.0) ?? 1.0, 0.1, 5),
    upgradeChoices: normalizeStringArray(player.upgradeChoices),
    upgradesPerLevel: clamp(toInt(player.upgradesPerLevel, 0) || 0, 0, 10)
  };

  const autopilot = isPlainObject(src.autopilot) ? src.autopilot : {};
  const autopilotOut = {
    ...autopilot,
    avoidRadius: clamp(toNumber(autopilot.avoidRadius, CONFIG.AUTOPILOT_AVOID_RADIUS ?? 5) ?? 5, 0, 40),
    replanInterval: clamp(toNumber(autopilot.replanInterval, CONFIG.AUTOPILOT_REPLAN_INTERVAL ?? 0.6) ?? 0.6, 0.1, 5),
    stuckSeconds: clamp(toNumber(autopilot.stuckSeconds, 1.2) ?? 1.2, 0.1, 10),
    noProgressSeconds: clamp(toNumber(autopilot.noProgressSeconds, 0.8) ?? 0.8, 0.1, 10)
  };

  const missionsSrc = isPlainObject(src.missions) ? src.missions : {};
  const missionsOut = Array.isArray(missionsSrc.list)
    ? (() => {
      const normalized = normalizeMissionsConfig(missionsSrc);
      return {
        ...missionsSrc,
        ...normalized,
        exit: { ...(missionsSrc.exit || {}), ...(normalized.exit || {}) }
      };
    })()
    : missionsSrc;

  return {
    ...src,
    id,
    name,
    maze: {
      ...maze,
      width,
      height,
      roomDensity,
      extraConnectionChance
    },
    rooms: {
      ...rooms,
      typeWeights: roomTypeWeights
    },
    monsters: monstersOut,
    missions: missionsOut,
    player: playerOut,
    autopilot: autopilotOut
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function loadPublicLevels(manifestUrl = '/levels/manifest.json') {
  const manifest = await fetchJson(manifestUrl);
  const files = Array.isArray(manifest?.levels) ? manifest.levels : null;
  if (!files || files.length === 0) return [];

  const basePath = manifestUrl.split('/').slice(0, -1).join('/') || '/levels';
  const levels = [];

  for (const f of files) {
    const file = String(f || '').trim();
    if (!file) continue;
    const url = `${basePath}/${file}`;
    try {
      const raw = await fetchJson(url);
      if (raw && typeof raw === 'object') {
        raw.__source = url;
      }
      levels.push(raw);
    } catch (err) {
      console.warn(`⚠️ Failed to load level JSON: ${url}`, err?.message || err);
    }
  }

  return levels;
}

async function loadPublicLevelRecipes(manifestUrl = '/level-recipes/manifest.json') {
  const manifest = await fetchJson(manifestUrl);
  const files = Array.isArray(manifest?.recipes) ? manifest.recipes : null;
  if (!files || files.length === 0) return [];

  const basePath = manifestUrl.split('/').slice(0, -1).join('/') || '/level-recipes';
  const recipes = [];

  for (const f of files) {
    const file = String(f || '').trim();
    if (!file) continue;
    const url = `${basePath}/${file}`;
    try {
      const raw = await fetchJson(url);
      if (raw && typeof raw === 'object') {
        raw.__source = url;
      }
      recipes.push(raw);
    } catch (err) {
      console.warn(`⚠️ Failed to load recipe JSON: ${url}`, err?.message || err);
    }
  }

  return recipes;
}

function normalizeOptionalCount(raw) {
  if (Number.isFinite(Number(raw))) {
    const n = clamp(toInt(raw, 0) || 0, 0, 50);
    return { min: n, max: n };
  }
  const obj = isPlainObject(raw) ? raw : {};
  const min = clamp(toInt(obj.min, 0) || 0, 0, 50);
  const max = clamp(toInt(obj.max, min) || min, min, 50);
  return { min, max };
}

function normalizeLevelRecipe(raw, index = 0) {
  const src = isPlainObject(raw) ? deepClone(raw) : {};
  const id = String(src.id || src.recipeId || `recipe_${index + 1}`).trim();
  const name = String(src.name || id || `Recipe ${index + 1}`).trim() || `Recipe ${index + 1}`;
  const weight = clamp(toNumber(src.weight, 1) ?? 1, 0, 1000);

  const difficulty = isPlainObject(src.difficulty) ? src.difficulty : {};
  const minDifficulty = clamp(toNumber(difficulty.min, 0) ?? 0, 0, 999);
  const maxDifficulty = clamp(toNumber(difficulty.max, 999) ?? 999, minDifficulty, 999);

  const level = isPlainObject(src.level) ? deepClone(src.level) : {};
  const missions = isPlainObject(src.missions) ? deepClone(src.missions) : {};

  const required = Array.isArray(missions.required) ? missions.required : [];
  const optionalPool = Array.isArray(missions.optionalPool) ? missions.optionalPool : [];
  const optionalCount = normalizeOptionalCount(missions.optionalCount);
  const includeUnlockExit = missions.includeUnlockExit !== false;
  const timeLimitSec = clamp(toInt(missions.timeLimitSec, 0) || 0, 0, 24 * 60 * 60);

  const source = String(src.__source || '').trim();

  if (!id) return null;
  if (weight <= 0) return null;

  return {
    id,
    name,
    weight,
    minDifficulty,
    maxDifficulty,
    level,
    missions: {
      timeLimitSec,
      required,
      optionalPool,
      optionalCount,
      includeUnlockExit,
      exitRequires: Array.isArray(missions.exitRequires) ? normalizeStringArray(missions.exitRequires) : null
    },
    source
  };
}

function normalizeRecipeMissionEntry(raw, index = 0) {
  const entry = isPlainObject(raw) ? raw : {};
  const template = String(entry.template || entry.type || '').trim();
  const id = String(entry.id || entry.missionId || '').trim();
  const required = entry.required;
  const weight = clamp(toNumber(entry.weight, 1) ?? 1, 0, 1000);
  const params = isPlainObject(entry.params) ? deepClone(entry.params) : {};
  return template ? { id, template, required, weight, params } : null;
}

function pickWeightedEntry(entries, rand) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + (Number(e?.weight) || 0), 0);
  if (!(total > 0)) return null;
  let target = rand() * total;
  for (const entry of entries) {
    const w = Number(entry?.weight) || 0;
    if (!(w > 0)) continue;
    target -= w;
    if (target <= 0) return entry;
  }
  return entries[entries.length - 1] || null;
}

function uniqueMissionId(baseId, used) {
  const start = String(baseId || '').trim() || 'm';
  if (!used.has(start)) {
    used.add(start);
    return start;
  }
  for (let i = 2; i < 999; i++) {
    const next = `${start}${i}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const fallback = `${start}${Math.floor(Math.random() * 9999)}`;
  used.add(fallback);
  return fallback;
}

function defaultUnlockExitMission() {
  return {
    id: 'unlockExit',
    template: 'unlockExit',
    required: true,
    params: {
      hints: [
        'Go to the exit and press E to unlock it.',
        'After unlocking, press E again to finish the level.',
        'If it stays locked, you missed a required objective.'
      ]
    }
  };
}

/**
 * LevelDirector
 * - Generates endless, room-first levels with rising difficulty.
 * - Adapts next difficulty based on player performance (speed, health, mission completion).
 */
export class LevelDirector {
  constructor(baseLevels = [], recipes = []) {
    this.baseLevels = Array.isArray(baseLevels) ? baseLevels.map((l, idx) => normalizeLevelConfig(l, idx)) : [];
    this.recipes = Array.isArray(recipes)
      ? recipes.map((r, idx) => normalizeLevelRecipe(r, idx)).filter(Boolean)
      : [];
    this.generated = new Map(); // levelIndex -> config (avoid huge sparse arrays for endless mode)
    this.lastDifficulty = 1;
  }

  getLevelCount() {
    return Array.isArray(this.baseLevels) ? this.baseLevels.length : 0;
  }

  static async createFromPublic({
    manifestUrl = '/levels/manifest.json',
    fallbackLevels = [],
    recipeManifestUrl = '/level-recipes/manifest.json',
    fallbackRecipes = []
  } = {}) {
    let loaded = [];
    try {
      loaded = await loadPublicLevels(manifestUrl);
    } catch (err) {
      console.warn('⚠️ Failed to load public level manifest:', err?.message || err);
    }

    let loadedRecipes = [];
    try {
      loadedRecipes = await loadPublicLevelRecipes(recipeManifestUrl);
    } catch (err) {
      console.warn('⚠️ Failed to load public recipe manifest:', err?.message || err);
    }

    const baseLevels = loaded.length > 0
      ? loaded
      : (Array.isArray(fallbackLevels) ? fallbackLevels : []);

    const recipes = loadedRecipes.length > 0
      ? loadedRecipes
      : (Array.isArray(fallbackRecipes) ? fallbackRecipes : []);

    return new LevelDirector(baseLevels, recipes);
  }

  /**
   * Compute a 0-1 performance score.
   */
  scorePerformance(stats = null, outcome = null) {
    if (!stats) return 0.5;

    const healthScore = clamp((stats.healthPercentage ?? 50) / 100, 0, 1);
    const missionScore = stats.missions?.total
      ? clamp((stats.missions.collected || 0) / stats.missions.total, 0, 1)
      : 1;

    const time = stats.time || 0;
    // Faster clear = higher score; 0.75 within 5 min, lower after.
    const timeScore = clamp(1 - (time / 300), 0.2, 1);

    let score = (healthScore * 0.4) + (missionScore * 0.35) + (timeScore * 0.25);
    if (outcome === 'lose') score *= 0.65;
    if (outcome === 'win') score *= 1.05;
    return clamp(score, 0.2, 1.1);
  }

  /**
   * Compute difficulty scalar for the given level index.
   */
  difficultyForLevel(index, stats, outcome) {
    const base = Math.max(this.lastDifficulty + 0.05, 1 + index * 0.15); // monotonic climb
    const perf = this.scorePerformance(stats, outcome);
    const adjustment = (perf - 0.55) * 0.9;
    const diff = Math.max(0.8, base + adjustment);
    this.lastDifficulty = Math.max(this.lastDifficulty, diff);
    return diff;
  }

  /**
   * Public API: fetch config for a level index (0-based).
   */
  getLevelConfig(index, stats = null, outcome = null) {
    if (index < this.baseLevels.length) {
      const tuned = this.tuneForRooms(this.baseLevels[index], index);
      this.lastDifficulty = Math.max(this.lastDifficulty, 1 + index * 0.2);
      return tuned;
    }

    const cached = this.generated.get(index);
    if (cached) return cached;

    const difficulty = this.difficultyForLevel(index, stats, outcome);
    const config = this.recipes.length > 0
      ? this.buildRecipeConfig(index, difficulty)
      : this.buildDynamicConfig(index, difficulty);
    this.generated.set(index, config);
    return config;
  }

  pickRecipe(index, difficulty) {
    const candidates = this.recipes.filter((r) => {
      if (!r || !(r.weight > 0)) return false;
      if (!(difficulty >= (r.minDifficulty ?? 0))) return false;
      if (!(difficulty <= (r.maxDifficulty ?? 999))) return false;
      return true;
    });

    const pool = candidates.length > 0 ? candidates : this.recipes.filter((r) => r && r.weight > 0);
    if (pool.length === 0) return null;

    const rand = mulberry32(hashStringSeed(`recipe:${index}`));
    return pickWeightedEntry(pool, rand) || pool[0];
  }

  buildRecipeConfig(index, difficulty) {
    const recipe = this.pickRecipe(index, difficulty);
    if (!recipe) return this.buildDynamicConfig(index, difficulty);

    const rand = mulberry32(hashStringSeed(`${recipe.id}:${index}`));
    const base = isPlainObject(recipe.level) ? deepClone(recipe.level) : {};

    const level = {
      ...base,
      id: index + 1,
      name: base.name || `L${index + 1} - ${recipe.name}`,
      __source: recipe.source ? `${recipe.source}#${recipe.id}` : `recipe:${recipe.id}`
    };

    // Gentle scaling inside a recipe (keeps content stable but still progresses a bit).
    const sizeBoost = clamp(Math.floor(difficulty * 1.25), 0, 18);
    const maze = isPlainObject(level.maze) ? level.maze : {};
    level.maze = {
      ...maze,
      width: ensureOdd((toInt(maze.width, CONFIG.MAZE_WIDTH || 31) || (CONFIG.MAZE_WIDTH || 31)) + sizeBoost),
      height: ensureOdd((toInt(maze.height, CONFIG.MAZE_HEIGHT || 31) || (CONFIG.MAZE_HEIGHT || 31)) + Math.floor(sizeBoost * 0.8)),
      roomDensity: toNumber(maze.roomDensity, 2.9) ?? 2.9,
      extraConnectionChance: toNumber(maze.extraConnectionChance, 0.12) ?? 0.12,
    };

    const monsters = isPlainObject(level.monsters) ? level.monsters : {};
    const baseCount = clamp(toInt(monsters.count, CONFIG.MONSTER_COUNT || 6) || (CONFIG.MONSTER_COUNT || 6), 0, 120);
    const maxCount = clamp(toInt(monsters.maxCount, 0) || 0, 0, 240);
    const scaledCount = clamp(Math.round(baseCount * (1 + clamp(difficulty * 0.06, 0, 0.6))), 0, maxCount > 0 ? maxCount : 120);
    level.monsters = {
      ...monsters,
      count: scaledCount,
      maxCount
    };

    const usedIds = new Set();
    const missionList = [];

    const requiredRaw = Array.isArray(recipe.missions?.required) ? recipe.missions.required : [];
    for (const entry of requiredRaw) {
      const m = normalizeRecipeMissionEntry(entry, missionList.length);
      if (!m) continue;
      const id = uniqueMissionId(m.id || m.template, usedIds);
      missionList.push({
        id,
        template: m.template,
        required: m.required !== false,
        params: m.params || {}
      });
    }

    const poolRaw = Array.isArray(recipe.missions?.optionalPool) ? recipe.missions.optionalPool : [];
    const pool = poolRaw.map((e, idx) => normalizeRecipeMissionEntry(e, idx)).filter(Boolean);

    const optCountCfg = recipe.missions?.optionalCount || { min: 0, max: 0 };
    const optMin = clamp(toInt(optCountCfg.min, 0) || 0, 0, 50);
    const optMax = clamp(toInt(optCountCfg.max, optMin) || optMin, optMin, 50);
    const wantOptional = pool.length > 0 ? clamp(Math.floor(rand() * (optMax - optMin + 1)) + optMin, 0, pool.length) : 0;

    for (let i = 0; i < wantOptional; i++) {
      if (pool.length === 0) break;
      const picked = pickWeightedEntry(pool, rand);
      if (!picked) break;
      const idx = pool.indexOf(picked);
      if (idx >= 0) pool.splice(idx, 1);

      const id = uniqueMissionId(picked.id || picked.template, usedIds);
      missionList.push({
        id,
        template: picked.template,
        required: picked.required === true ? true : false,
        params: picked.params || {}
      });
    }

    const wantsUnlockExit = recipe.missions?.includeUnlockExit !== false;
    if (wantsUnlockExit && !missionList.some((m) => m?.template === 'unlockExit')) {
      const unlock = defaultUnlockExitMission();
      unlock.id = uniqueMissionId(unlock.id, usedIds);
      missionList.push(unlock);
    }

    const exitRequires =
      Array.isArray(recipe.missions?.exitRequires) && recipe.missions.exitRequires.length > 0
        ? normalizeStringArray(recipe.missions.exitRequires)
        : missionList.filter((m) => m?.required !== false).map((m) => m.id);

    level.missions = {
      timeLimitSec: recipe.missions?.timeLimitSec || 0,
      list: missionList,
      exit: { requires: exitRequires }
    };

    if (!isPlainObject(level.pickups)) level.pickups = {};
    if (!isPlainObject(level.pickups.tools)) {
      const weights = { lure: 0.35, trap: 0.25, jammer: 0.15, decoy: 0.1, smoke: 0.08, flash: 0.06, sensor: 0.06, mine: 0.05 };
      const chance = clamp(0.06 + difficulty * 0.002, 0.04, 0.12);
      level.pickups.tools = {
        maxDevices: 6,
        start: { lure: 1, trap: 1, jammer: 1, decoy: 1, smoke: 1, flash: 1, sensor: 1, mine: 1 },
        drop: { enabled: true, chance, ttl: 45, weights }
      };
    }

    return normalizeLevelConfig(level, index);
  }

  tuneForRooms(config, index = 0) {
    const tuned = deepClone(config);
    tuned.id = tuned.id ?? index + 1;
    tuned.name = tuned.name || `AI-L${index + 1}`;
    tuned.maze = tuned.maze || {};
    tuned.maze.roomDensity = Math.max(tuned.maze.roomDensity || 1.5, 2.8);
    tuned.maze.extraConnectionChance = Math.max(tuned.maze.extraConnectionChance || 0.1, 0.2);
    tuned.maze.noDeadEnds = true;
    tuned.maze.minRoomDoors = 2;
    tuned.maze.minRoomSize = Math.max(tuned.maze.minRoomSize || 5, 5);
    tuned.maze.maxRoomSize = Math.max(tuned.maze.maxRoomSize || 8, 8);
    tuned.maze.deadEndPasses = tuned.maze.deadEndPasses ?? 3;
    return tuned;
  }

  buildDynamicConfig(index, difficulty) {
    const baseWidth = CONFIG.MAZE_WIDTH || 31;
    const baseHeight = CONFIG.MAZE_HEIGHT || 31;
    const jitter = () => (Math.random() * 3 - 1.5);

    const width = clamp(ensureOdd(baseWidth + difficulty * 3 + jitter()), 11, 201);
    const height = clamp(ensureOdd(baseHeight + difficulty * 2.5 + jitter()), 11, 201);

    const roomDensity = clamp(3.5 + difficulty * 0.45, 3, 12);
    const extraConnectionChance = clamp(0.18 + difficulty * 0.02, 0.18, 0.48);
    const minRoomSize = clamp(5 + Math.floor(difficulty * 0.3), 5, 11);
    const maxRoomSize = clamp(minRoomSize + 3 + Math.floor(difficulty * 0.15), minRoomSize + 2, 14);

    const monsterBase = CONFIG.MONSTER_COUNT || 12;
    const monsterCount = clamp(Math.round(monsterBase * (1 + difficulty * 0.14)), 6, 60);
    const speedMultiplier = clamp(1 + difficulty * 0.05, 1, 1.8);
    const visionMultiplier = clamp(1 + difficulty * 0.04, 1, 2);

    const missions = clamp(3 + Math.floor(difficulty * 0.4), 3, 12);
    const required = clamp(missions - 1, 2, missions);

    const typeWeights = {
      [ROOM_TYPES.CLASSROOM]: 3.0,
      [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.4,
      [ROOM_TYPES.OFFICE]: 1.25,
      [ROOM_TYPES.LAB]: 0.95,
      [ROOM_TYPES.CAFETERIA]: 0.85,
      [ROOM_TYPES.BATHROOM]: 0.75,
      [ROOM_TYPES.STORAGE]: 0.9,
      [ROOM_TYPES.LIBRARY]: 0.55,
      [ROOM_TYPES.POOL]: 0.22,
      [ROOM_TYPES.GYM]: 0.35,
      [ROOM_TYPES.BEDROOM]: 0.45,
    };

    // Data-driven mission templates (MissionDirector consumes this directly).
    const missionList = [
      {
        id: 'evidence',
        template: 'collectEvidence',
        required: true,
        params: {
          count: missions,
          required,
          roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK]
        }
      }
    ];
    const exitRequires = ['evidence'];

    if (difficulty >= 2.6 && Math.random() < 0.55) {
      missionList.push({
        id: 'keycard',
        template: 'findKeycard',
        required: true,
        params: { roomTypes: [ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOM, ROOM_TYPES.CLASSROOMS_BLOCK] }
      });
      exitRequires.push('keycard');
    }

    if (difficulty >= 4.2 && Math.random() < 0.6) {
      missionList.push({
        id: 'power',
        template: 'restorePower',
        required: true,
        params: { switches: 3, roomTypes: [ROOM_TYPES.LAB, ROOM_TYPES.STORAGE] }
      });
      exitRequires.push('power');
    }

    if (difficulty >= 5.0 && Math.random() < 0.45) {
      missionList.push({
        id: 'sync',
        template: 'syncActivate',
        required: true,
        params: { switches: 3, windowSec: clamp(Math.round(18 - difficulty), 10, 18), roomTypes: [ROOM_TYPES.LAB, ROOM_TYPES.STORAGE] }
      });
      exitRequires.push('sync');
    }

    if (difficulty >= 5.8 && Math.random() < 0.4) {
      missionList.push({
        id: 'zone',
        template: 'surviveInZone',
        required: true,
        params: { seconds: clamp(Math.round(18 + difficulty * 2.2), 18, 70), radius: 2, exitGraceSec: 2, roomTypes: [ROOM_TYPES.CAFETERIA, ROOM_TYPES.GYM, ROOM_TYPES.STORAGE] }
      });
      exitRequires.push('zone');
    }

    if (difficulty >= 6.5 && Math.random() < 0.35) {
      missionList.push({
        id: 'survive',
        template: 'surviveTimer',
        required: true,
        params: { seconds: 120 }
      });
      exitRequires.push('survive');
    }

    if (difficulty >= 2.8 && Math.random() < 0.55) {
      const candidates = [ROOM_TYPES.LAB, ROOM_TYPES.CAFETERIA, ROOM_TYPES.CLASSROOMS_BLOCK];
      const roomType = candidates[Math.floor(Math.random() * candidates.length)];
      missionList.push({
        id: 'enter',
        template: 'enterRoomType',
        required: true,
        params: { count: 1, roomTypes: [roomType] }
      });
      exitRequires.push('enter');
    }

    if (difficulty >= 4.8 && Math.random() < 0.55) {
      const count = clamp(Math.round(2 + difficulty * 0.55), 3, 30);
      missionList.push({
        id: 'hunt',
        template: 'killCount',
        required: true,
        params: { count }
      });
      exitRequires.push('hunt');
    }

    if (difficulty >= 6.0 && Math.random() < 0.35) {
      const seconds = clamp(Math.round(12 + difficulty * 2), 12, 60);
      missionList.push({
        id: 'stealth',
        template: 'stealthNoise',
        required: true,
        params: { seconds, resetOnGunshot: true }
      });
      exitRequires.push('stealth');
    }

    const hasKeycard = missionList.some((m) => m?.template === 'findKeycard');
    if (hasKeycard) {
      if (!missionList.some((m) => m?.template === 'unlockExit')) {
        missionList.push({
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {}
        });
      }
      if (!exitRequires.includes('unlockExit')) {
        exitRequires.push('unlockExit');
      }
    }

    const timeLimitSec = difficulty >= 6 ? clamp(480 - difficulty * 12, 240, 520) : 0;

    const pickupMaxActive = clamp(Math.round(18 + difficulty * 0.6), 18, 30);
    const toolDropChance = clamp(0.06 + difficulty * 0.002, 0.04, 0.12);
    const toolWeights = { lure: 0.35, trap: 0.25, jammer: 0.15, decoy: 0.1, smoke: 0.08, flash: 0.06, sensor: 0.06, mine: 0.05 };

    return {
      id: index + 1,
      name: `Endless-${index + 1}`,
      __source: 'generated',
      maze: {
        width,
        height,
        roomDensity,
        extraConnectionChance,
        noDeadEnds: true,
        minRoomSize,
        maxRoomSize,
        minRoomDoors: 2,
        deadEndPasses: 3
      },
      rooms: { typeWeights },
      pickups: {
        maxActive: pickupMaxActive,
        tools: {
          maxDevices: 6,
          start: { lure: 1, trap: 1, jammer: 1, decoy: 1, smoke: 1, flash: 1, sensor: 1, mine: 1 },
          drop: { enabled: true, chance: toolDropChance, ttl: 45, weights: toolWeights }
        }
      },
      monsters: {
        count: monsterCount,
        speedMultiplier,
        visionMultiplier,
        memoryMultiplier: 1 + difficulty * 0.04,
        allowSprintTypes: []
      },
      missions: {
        timeLimitSec,
        list: missionList,
        exit: { requires: exitRequires }
      },
      player: {
        maxHealthMultiplier: clamp(1.0 - difficulty * 0.015, 0.65, 1),
        upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
        upgradesPerLevel: 1
      },
      autopilot: {
        avoidRadius: clamp(4 + difficulty * 0.1, 4, 10),
        replanInterval: clamp(0.5 - difficulty * 0.02, 0.25, 0.6),
        stuckSeconds: 1.0,
        noProgressSeconds: 0.6
      }
    };
  }

  /**
   * For UI: how many levels can we jump to (soft cap).
   */
  getMaxJump() {
    const n = this.getLevelCount();
    return n > 0 ? n : null;
  }
}
