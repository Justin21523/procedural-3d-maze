import { CONFIG } from '../config.js';

const STORAGE_KEYS = {
  V1: 'maze:settings:v1',
  V2: 'maze:settings:v2'
};

function safeStorageGet(key) {
  try {
    return window.localStorage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage?.setItem?.(key, String(value));
  } catch {
    // ignore
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage?.removeItem?.(key);
  } catch {
    // ignore
  }
}

function readJsonStorage(key) {
  const raw = safeStorageGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function clampNum(value, { min = -Infinity, max = Infinity, fallback = null } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeMazeSize(value) {
  const mazeSize = clampNum(value, { min: 21, max: 61, fallback: null });
  if (mazeSize === null) return null;
  const rounded = Math.round(mazeSize);
  return rounded % 2 === 0 ? (rounded + 1) : rounded;
}

export function getDefaultSettings() {
  return {
    version: 2,
    playerSpeed: null,
    mouseSensitivity: null,
    fov: null,
    fogDensity: null,
    mazeSize: null,
    roomDensity: null,
    missionCount: null,
    lowPerf: null,
    weaponView: null,
    crosshair: null,
    recoil: null,
    poolFx: null,
    hdri: null,
    safeMode: null,
    monsterModels: null,
    mazeSeed: null,
    monsterModelPath: null,
    weaponModelPath: null,

    // Debug-only / dev helpers (still persisted, but UI should gate them)
    minimapShowObstacles: null,
    worldShowObstacleOverlay: null,
    propObstacleChance: null,
    propObstacleMargin: null,
    autopilotEnabled: null,
    autopilotDelay: null,
    autopilotCombatEnabled: null,
    autopilotFireRange: null,
    autopilotFireFov: null,
    autopilotTurnSpeed: null,
    autopilotToolAiEnabled: null,
    autopilotReplanInterval: null,
    autopilotCombatMaxRange: null,
    autopilotCombatRequireLos: null,
    autopilotCombatDamageMult: null,
    aiDifficulty: null,
    monsterRanged: null,
    monsterCountMult: null,
    squadMaxShooters: null,
    squadFireGrant: null,
    squadFlankHold: null,
    squadMemory: null,
    squadNoiseShare: null,
    squadCoverRadius: null
  };
}

function migrateV1ToV2(v1) {
  const base = getDefaultSettings();
  const s = v1 && typeof v1 === 'object' ? v1 : {};
  return {
    ...base,
    playerSpeed: s.playerSpeed ?? base.playerSpeed,
    mouseSensitivity: s.mouseSensitivity ?? base.mouseSensitivity,
    fov: s.fov ?? base.fov,
    fogDensity: s.fogDensity ?? base.fogDensity,
    mazeSize: s.mazeSize ?? base.mazeSize,
    roomDensity: s.roomDensity ?? base.roomDensity,
    missionCount: s.missionCount ?? base.missionCount,
    lowPerf: s.lowPerf ?? base.lowPerf,
    weaponView: s.weaponView ?? base.weaponView,
    crosshair: s.crosshair ?? base.crosshair,
    recoil: s.recoil ?? base.recoil,
    poolFx: s.poolFx ?? base.poolFx,
    hdri: s.hdri ?? base.hdri,
    safeMode: s.safeMode ?? base.safeMode,
    monsterModels: s.monsterModels ?? base.monsterModels,
    mazeSeed: s.mazeSeed ?? base.mazeSeed,
    monsterModelPath: s.monsterModelPath ?? base.monsterModelPath,
    weaponModelPath: s.weaponModelPath ?? base.weaponModelPath,
    minimapShowObstacles: s.minimapShowObstacles ?? base.minimapShowObstacles,
    worldShowObstacleOverlay: s.worldShowObstacleOverlay ?? base.worldShowObstacleOverlay,
    propObstacleChance: s.propObstacleChance ?? base.propObstacleChance,
    propObstacleMargin: s.propObstacleMargin ?? base.propObstacleMargin,
    autopilotEnabled: s.autopilotEnabled ?? base.autopilotEnabled,
    autopilotDelay: s.autopilotDelay ?? base.autopilotDelay,
    autopilotCombatEnabled: s.autopilotCombatEnabled ?? base.autopilotCombatEnabled,
    autopilotFireRange: s.autopilotFireRange ?? base.autopilotFireRange,
    autopilotFireFov: s.autopilotFireFov ?? base.autopilotFireFov,
    autopilotTurnSpeed: s.autopilotTurnSpeed ?? base.autopilotTurnSpeed,
    autopilotToolAiEnabled: s.autopilotToolAiEnabled ?? base.autopilotToolAiEnabled,
    autopilotReplanInterval: s.autopilotReplanInterval ?? base.autopilotReplanInterval,
    autopilotCombatMaxRange: s.autopilotCombatMaxRange ?? base.autopilotCombatMaxRange,
    autopilotCombatRequireLos: s.autopilotCombatRequireLos ?? base.autopilotCombatRequireLos,
    autopilotCombatDamageMult: s.autopilotCombatDamageMult ?? base.autopilotCombatDamageMult,
    aiDifficulty: s.aiDifficulty ?? base.aiDifficulty,
    monsterRanged: s.monsterRanged ?? base.monsterRanged,
    monsterCountMult: s.monsterCountMult ?? base.monsterCountMult,
    squadMaxShooters: s.squadMaxShooters ?? base.squadMaxShooters,
    squadFireGrant: s.squadFireGrant ?? base.squadFireGrant,
    squadFlankHold: s.squadFlankHold ?? base.squadFlankHold,
    squadMemory: s.squadMemory ?? base.squadMemory,
    squadNoiseShare: s.squadNoiseShare ?? base.squadNoiseShare,
    squadCoverRadius: s.squadCoverRadius ?? base.squadCoverRadius
  };
}

function sanitizeV2(raw) {
  const base = getDefaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  return { ...base, ...s, version: 2 };
}

export function loadSettings() {
  const v2 = readJsonStorage(STORAGE_KEYS.V2);
  if (v2) return sanitizeV2(v2);

  const v1 = readJsonStorage(STORAGE_KEYS.V1);
  if (!v1) return getDefaultSettings();

  const migrated = migrateV1ToV2(v1);
  safeStorageSet(STORAGE_KEYS.V2, JSON.stringify(migrated));
  return migrated;
}

export function saveSettings(partial) {
  const current = loadSettings();
  const patch = partial && typeof partial === 'object' ? partial : {};
  const next = sanitizeV2({ ...current, ...patch, version: 2 });
  safeStorageSet(STORAGE_KEYS.V2, JSON.stringify(next));
  return next;
}

export function resetSettings() {
  safeStorageRemove(STORAGE_KEYS.V2);
  // Clear legacy key too so resets actually take effect.
  safeStorageRemove(STORAGE_KEYS.V1);
}

export function applySettingsToConfig(settings, config = CONFIG) {
  const s = settings && typeof settings === 'object' ? settings : getDefaultSettings();
  const cfg = config || CONFIG;

  const mazeSize = normalizeMazeSize(s.mazeSize);
  if (mazeSize !== null) {
    cfg.MAZE_WIDTH = mazeSize;
    cfg.MAZE_HEIGHT = mazeSize;
  }

  const roomDensity = clampNum(s.roomDensity, { min: 0.5, max: 4.0, fallback: null });
  if (roomDensity !== null) cfg.ROOM_DENSITY = roomDensity;

  const missionCount = clampNum(s.missionCount, { min: 1, max: 10, fallback: null });
  if (missionCount !== null) cfg.MISSION_POINT_COUNT = Math.round(missionCount);

  const speed = clampNum(s.playerSpeed, { min: 1, max: 10, fallback: null });
  if (speed !== null) cfg.PLAYER_SPEED = speed;

  const sens = clampNum(s.mouseSensitivity, { min: 0.0005, max: 0.005, fallback: null });
  if (sens !== null) cfg.MOUSE_SENSITIVITY = sens;

  const fov = clampNum(s.fov, { min: 60, max: 90, fallback: null });
  if (fov !== null) cfg.FOV = Math.round(fov / 5) * 5;

  const fog = clampNum(s.fogDensity, { min: 0, max: 0.15, fallback: null });
  if (fog !== null) cfg.FOG_DENSITY = fog;

  if (typeof s.lowPerf === 'boolean') cfg.LOW_PERF_MODE = s.lowPerf;
  if (typeof s.weaponView === 'boolean') cfg.PLAYER_WEAPON_VIEW_ENABLED = s.weaponView;
  if (typeof s.crosshair === 'boolean') cfg.PLAYER_CROSSHAIR_ENABLED = s.crosshair;

  const recoil = clampNum(s.recoil, { min: 0, max: 2, fallback: null });
  if (recoil !== null) cfg.PLAYER_WEAPON_RECOIL = recoil;

  if (typeof s.poolFx === 'boolean') cfg.POOL_FX_ENABLED = s.poolFx;
  if (typeof s.hdri === 'boolean') cfg.ENVIRONMENT_HDR_ENABLED = s.hdri;
  if (typeof s.safeMode === 'boolean') cfg.SAFE_MODE_ENABLED = s.safeMode;

  if (typeof s.monsterModels === 'boolean') cfg.MONSTER_USE_ASSET_MODELS = s.monsterModels;

  if (s.monsterModelPath !== undefined) {
    const raw = s.monsterModelPath;
    const trimmed = (typeof raw === 'string') ? raw.trim() : raw;
    if (typeof trimmed === 'string' && trimmed !== '') cfg.MONSTER_MODEL = trimmed;
  }

  if (s.weaponModelPath !== undefined) {
    const raw = s.weaponModelPath;
    const trimmed = (typeof raw === 'string') ? raw.trim() : raw;
    if (typeof trimmed === 'string' && trimmed !== '') cfg.PLAYER_WEAPON_MODEL_PATH = trimmed;
  }

  if (s.mazeSeed !== undefined) {
    const raw = s.mazeSeed;
    const trimmed = (typeof raw === 'string') ? raw.trim() : raw;
    cfg.MAZE_SEED = (trimmed === '' || trimmed === null) ? null : trimmed;
  }

  // Debug-only settings (do not enforce debug gating here; callers decide)
  if (typeof s.minimapShowObstacles === 'boolean') cfg.MINIMAP_SHOW_OBSTACLES = s.minimapShowObstacles;
  if (typeof s.worldShowObstacleOverlay === 'boolean') cfg.WORLD_SHOW_OBSTACLE_OVERLAY = s.worldShowObstacleOverlay;

  const propChance = clampNum(s.propObstacleChance, { min: 0, max: 0.35, fallback: null });
  if (propChance !== null) cfg.PROP_OBSTACLE_ROOM_CHANCE = propChance;

  const propMargin = clampNum(s.propObstacleMargin, { min: 0, max: 2, fallback: null });
  if (propMargin !== null) cfg.PROP_OBSTACLE_MARGIN = Math.round(propMargin);

  if (typeof s.autopilotEnabled === 'boolean') cfg.AUTOPILOT_ENABLED = s.autopilotEnabled;
  const autopilotDelay = clampNum(s.autopilotDelay, { min: 0, max: 5, fallback: null });
  if (autopilotDelay !== null) cfg.AUTOPILOT_DELAY = autopilotDelay;

  if (typeof s.autopilotCombatEnabled === 'boolean') cfg.AUTOPILOT_COMBAT_ENABLED = s.autopilotCombatEnabled;
  const fireRange = clampNum(s.autopilotFireRange, { min: 4, max: 20, fallback: null });
  if (fireRange !== null) cfg.AUTOPILOT_COMBAT_FIRE_RANGE_TILES = Math.round(fireRange);

  const fireFov = clampNum(s.autopilotFireFov, { min: 30, max: 180, fallback: null });
  if (fireFov !== null) cfg.AUTOPILOT_COMBAT_FOV_DEG = Math.round(fireFov / 10) * 10;

  const turnSpeed = clampNum(s.autopilotTurnSpeed, { min: 1, max: 8, fallback: null });
  if (turnSpeed !== null) cfg.AUTOPILOT_TURN_SPEED = turnSpeed;

  if (typeof s.autopilotToolAiEnabled === 'boolean') cfg.AUTOPILOT_TOOL_AI_ENABLED = s.autopilotToolAiEnabled;

  const replan = clampNum(s.autopilotReplanInterval, { min: 0.1, max: 1.5, fallback: null });
  if (replan !== null) cfg.AUTOPILOT_REPLAN_INTERVAL = replan;

  const combatMaxRange = clampNum(s.autopilotCombatMaxRange, { min: 6, max: 30, fallback: null });
  if (combatMaxRange !== null) cfg.AUTOPILOT_COMBAT_MAX_RANGE_TILES = Math.round(combatMaxRange);

  if (typeof s.autopilotCombatRequireLos === 'boolean') cfg.AUTOPILOT_COMBAT_REQUIRE_LOS = s.autopilotCombatRequireLos;

  const damageMult = clampNum(s.autopilotCombatDamageMult, { min: 0.5, max: 3.5, fallback: null });
  if (damageMult !== null) cfg.AUTOPILOT_COMBAT_DAMAGE_MULT = damageMult;

  const aiDifficulty = clampNum(s.aiDifficulty, { min: 0.5, max: 2.0, fallback: null });
  if (aiDifficulty !== null) cfg.AI_DIFFICULTY = aiDifficulty;

  if (typeof s.monsterRanged === 'boolean') cfg.AI_RANGED_GLOBAL_ENABLED = s.monsterRanged;

  const countMult = clampNum(s.monsterCountMult, { min: 0, max: 2.0, fallback: null });
  if (countMult !== null) cfg.MONSTER_COUNT_MULTIPLIER = countMult;

  const squadMaxShooters = clampNum(s.squadMaxShooters, { min: 1, max: 4, fallback: null });
  if (squadMaxShooters !== null) cfg.AI_SQUAD_MAX_RANGED_SHOOTERS = Math.round(squadMaxShooters);

  const squadFireGrant = clampNum(s.squadFireGrant, { min: 0.2, max: 2.0, fallback: null });
  if (squadFireGrant !== null) cfg.AI_SQUAD_FIRE_GRANT_SECONDS = squadFireGrant;

  const flankHold = clampNum(s.squadFlankHold, { min: 2, max: 14, fallback: null });
  if (flankHold !== null) cfg.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS = Math.round(flankHold);

  const squadMemory = clampNum(s.squadMemory, { min: 2, max: 15, fallback: null });
  if (squadMemory !== null) cfg.AI_SQUAD_MEMORY_SECONDS = squadMemory;

  const noiseShare = clampNum(s.squadNoiseShare, { min: 0, max: 5, fallback: null });
  if (noiseShare !== null) cfg.AI_SQUAD_NOISE_SHARE_SECONDS = noiseShare;

  const coverRadius = clampNum(s.squadCoverRadius, { min: 5, max: 14, fallback: null });
  if (coverRadius !== null) cfg.AI_SQUAD_COVER_RADIUS = Math.round(coverRadius);
}
