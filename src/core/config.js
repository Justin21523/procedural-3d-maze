/**
 * Global game configuration
 * All game parameters are centralized here for easy tuning
 */

export const CONFIG = {
  // Maze settings (adjustable via settings panel)
  MAZE_WIDTH: 31,        // 迷宮大小（建議用奇數）
  MAZE_HEIGHT: 31,       // 迷宮大小（建議用奇數）
  ROOM_DENSITY: 3.0,     // 預設更高密度，房間更多（可在 UI 微調）
  TILE_SIZE: 2.0,          // 一格地板寬度 / 長度 ≈ 2m
  WALL_HEIGHT: 3.0,        // 層高 ≈ 3m

  // Player settings
  PLAYER_SPEED: 4,       // Movement speed (units per second)
  PLAYER_HEIGHT: 1.7,    // Camera height (eye level)
  PLAYER_RADIUS: 0.35,   // Collision radius (slightly reduced to avoid sticking on corners)
  PLAYER_FIRE_INTERVAL: 0.08, // Seconds between shots (automatic)
  PLAYER_BULLET_SPEED: 42,
  PLAYER_BULLET_DAMAGE: 1,
  PLAYER_BULLET_LIFETIME: 2.2,
  PLAYER_PROJECTILE_HIT_RADIUS: 0.42,
  MOUSE_SENSITIVITY: 0.002,

  // Player defense (block / guard)
  PLAYER_BLOCK_ENABLED: true,
  PLAYER_BLOCK_DAMAGE_MULT: 0.35,     // 0.35 => blocks 65% damage
  PLAYER_BLOCK_MOVE_MULT: 0.85,       // movement speed multiplier while blocking
  PLAYER_BLOCK_KNOCKBACK_MULT: 0.5,   // reduce melee knockback while blocking
  PLAYER_BLOCK_STAMINA_MAX: 100,
  PLAYER_BLOCK_STAMINA_DRAIN: 34,     // stamina per second while holding block
  PLAYER_BLOCK_STAMINA_REGEN: 22,     // stamina per second while not blocking
  PLAYER_BLOCK_COOLDOWN: 1.2,         // seconds of forced vulnerability when stamina hits 0
  PLAYER_BLOCK_MIN_STAMINA_START: 10, // prevent flicker when almost empty

  // Player weapon view (first-person)
  PLAYER_WEAPON_VIEW_ENABLED: true,
  PLAYER_WEAPON_MODEL_PATH: '/models/assault_rifle_pbr.glb',
  PLAYER_WEAPON_SCALE: 1.0,
  PLAYER_WEAPON_OFFSET: { x: 0.35, y: -0.35, z: -0.72 },
  PLAYER_WEAPON_ROTATION: { x: -0.12, y: Math.PI + 0.12, z: 0.06 },
  PLAYER_WEAPON_SWAY: 0.9,
  PLAYER_WEAPON_BOB: 0.55,
  PLAYER_WEAPON_RECOIL: 1.0,
  PLAYER_CROSSHAIR_ENABLED: true,

  // Monster settings
  MONSTER_BASE_HEIGHT: 1.6,// 怪物「基準身高」（未加 type scale）
  MONSTER_SCALE_MULTIPLIER: 1.5, // 回到較大可視尺寸
  MONSTER_BASE_HEALTH: 10,        // 怪物基礎血量（可由 typeConfig.stats.health 覆寫）
  MONSTER_HIT_STUN_SECONDS: 0.22, // 受擊硬直（秒）
  MONSTER_DEATH_EXPLOSION_RADIUS: 2.6,
  MONSTER_DEATH_EXPLOSION_DAMAGE: 6,
  MONSTER_COUNT: 4,               // 預設怪物數量（可被關卡覆寫）
  MONSTER_COUNT_MULTIPLIER: 1.0,  // 以關卡/預設 count 為基礎再放大（建議維持 1.0，避免倍增爆量）
  MONSTER_MAX_COUNT: 6,           // 怪物上限（避免模型太多爆量 / FPS 崩）
  MONSTER_BASE_SPEED_FACTOR: 0.8, // 怪物基準速度 = 玩家速度 * 此係數
  MONSTER_SPRINT_MULTIPLIER: 1.6, // 怪物短衝刺倍率
  MONSTER_LEVEL_SPEED_MULT: 1.0,  // 依關卡縮放的倍率預設值
  MONSTER_SPEED: 9,              // 舊參數（保留向後相容）
  MONSTER_VISION_RANGE: 15,      // Base vision range (varies by type)
  MONSTER_FOV: Math.PI * 2 / 3,  // Base field of view (120 degrees)
  MONSTER_HIT_RADIUS: 1.1,       // Bullet collision radius around monsters
  MONSTER_DEATH_DELAY: 0.35,     // Seconds from hit -> explode -> remove
  MONSTER_PROJECTILE_SPEED: 22,
  MONSTER_PROJECTILE_DAMAGE: 8,
  MONSTER_PROJECTILE_LIFETIME: 3.0,
  MONSTER_RESPAWN_DELAY: 0.6,    // Seconds before a replacement monster spawns
  MONSTER_MODEL: '/models/VascodaGama.dae', // Default monster model (can be changed in UI)
  MONSTER_USE_ASSET_MODELS: true, // true=use public/models manifest; false=spawn simple placeholder cubes

  // Monster ranged combat rhythm (performance + "no shooting air")
  MONSTER_RANGED_FIRE_ALIGN_DEG: 16,        // required yaw alignment before firing
  MONSTER_RANGED_TURN_SPEED: 6.5,           // rad/s
  MONSTER_RANGED_BURST_MIN: 1,              // shots per burst (min)
  MONSTER_RANGED_BURST_MAX: 2,              // shots per burst (max)
  MONSTER_RANGED_BURST_REST_SECONDS: 0.7,   // rest between bursts
  MONSTER_RANGED_MAG_SIZE: 6,               // shots per magazine (infinite reserve)
  MONSTER_RANGED_RELOAD_SECONDS: 1.65,      // seconds to reload
  MONSTER_RANGED_MIN_SHOT_INTERVAL: 0.18,   // clamp lower bound to prevent runaway fire

  // AI advanced perception / difficulty
  AI_DIFFICULTY: 1.0,              // 0.5 (easy) ~ 2.0 (hard)
  AI_NOISE_ENABLED: true,
  AI_BASE_HEARING: 10,             // hearingRange=10 => baseline
  AI_NOISE_MAX_EVENTS: 32,
  AI_NOISE_GUNSHOT_RADIUS: 18,     // grid tiles
  AI_NOISE_FOOTSTEP_WALK_RADIUS: 5,
  AI_NOISE_FOOTSTEP_SPRINT_RADIUS: 9,
  AI_NOISE_TTL_GUNSHOT: 1.2,
  AI_NOISE_TTL_FOOTSTEP: 0.55,
  AI_NOISE_MEMORY: 2.0,           // seconds a heard noise stays actionable
  AI_ALERT_BROADCAST_RADIUS: 14,
  AI_ALERT_TTL: 1.0,
  AI_ALERT_COOLDOWN: 0.9,
  AI_INVESTIGATE_TIME: 6.0,
  AI_SEARCH_RADIUS: 4,
  AI_RANGED_GLOBAL_ENABLED: true,
  AI_TACTICS_ENABLED: true,
  AI_TACTICS_FLANK_SLOTS: 6,
  AI_TACTICS_FLANK_MIN_DIST: 1,
  AI_TACTICS_FLANK_MAX_DIST: 3,
  AI_TACTICS_COVER_ENABLED: true,
  AI_TACTICS_COVER_RADIUS: 6,
  AI_TACTICS_COVER_HEALTH_THRESHOLD: 0.35,
  AI_TACTICS_COVER_RECENT_HIT_SECONDS: 1.2,
  AI_SQUAD_MEMORY_SECONDS: 6.5,
  AI_SQUAD_NOISE_SHARE_SECONDS: 2.0,
  AI_SQUAD_STALE_SECONDS: 30,
  AI_SQUAD_COVER_RADIUS: 9,
  AI_SQUAD_FLANK_SLOT_KEEP_SECONDS: 8.0,

  // Spawn Director (waves / squads / drops)
  SPAWN_DIRECTOR_ENABLED: true,
  SPAWN_DIRECTOR_INITIAL_RATIO: 0.5,   // initial alive = count * ratio
  SPAWN_DIRECTOR_WAVE_INTERVAL: 4.0,   // seconds between spawn waves
  SPAWN_DIRECTOR_BUDGET_RATE: 2.0,     // budget points per second
  SPAWN_DIRECTOR_MAX_PICKUPS: 18,

  // Rendering settings
  FOV: 75,               // Field of view in degrees
  NEAR_PLANE: 0.1,
  FAR_PLANE: 1000,
  TARGET_FPS: 60,        // Target frames per second

  // Debug settings
  DEBUG_MODE: false,     // Enable debug visualizations
  SHOW_FPS: true,

  // Testing helpers
  AUTO_REVIVE: false,    // Auto-revive on 0 HP (debug/testing)

  // Mission settings
  MISSION_POINT_COUNT: 5, // 每局任務點數量

  // Performance
  LOW_PERF_MODE: false,  // 勾選後關閉大部分裝飾/降低像素比提升 FPS
  MINIMAP_SHOW_OBSTACLES: false,         // debug overlay: show obstacleMap tiles on the minimap
  WORLD_SHOW_OBSTACLE_OVERLAY: false,    // debug overlay: show obstacleMap tiles in 3D
  PROP_OBSTACLES_ENABLED: true,            // planned room props become collision obstacles
  PROP_OBSTACLE_ROOM_CHANCE: 0.12,        // per-floor-tile chance inside rooms
  PROP_OBSTACLE_MARGIN: 1,                // keep 1-tile margin around obstacles
  MONSTER_AI_FAR_DISTANCE_TILES: 12,      // Beyond this distance, throttle monster AI (tiles)
  MONSTER_AI_FAR_TICK_SECONDS: 0.35,      // AI tick interval for far monsters (seconds)
  MAX_ACTIVE_PROJECTILES: 160,            // Hard cap to avoid runaway projectiles
  MAX_ACTIVE_PLAYER_PROJECTILES: 80,
  MAX_ACTIVE_MONSTER_PROJECTILES: 80,
  MAX_ACTIVE_IMPACTS: 80,
  MAX_ACTIVE_EXPLOSIONS: 40,
  MAX_ACTIVE_MUZZLE_FLASHES: 24,

  // Shadow settings
  SHADOW_ENABLED: true,           // Enable real-time shadows
  SHADOW_QUALITY: 'medium',       // 'low' | 'medium' | 'high'

  // Camera effects
  HEAD_BOB_ENABLED: true,         // Enable head bobbing while walking
  HEAD_BOB_INTENSITY: 1.0,        // Head bob intensity (0.0 - 2.0)
  DYNAMIC_FOV_ENABLED: true,      // Enable FOV change when sprinting

  // PBR texture settings
  USE_EXTERNAL_TEXTURES: true,    // Load external 4K PBR textures from Poly Haven
  TEXTURES_BASE_PATH: '/textures', // Base path for PBR texture files

  // Environment models
  POOL_MODEL_ENABLED: true,
  POOL_MODEL_PATH: '/models/pool_5.glb',
  ENVIRONMENT_HDR_ENABLED: true,
  ENVIRONMENT_HDR_PATH: '/pool_1k.hdr',
  POOL_FX_ENABLED: true,

  // Post-processing settings
  POST_PROCESSING_ENABLED: true,  // Enable post-processing pipeline

  // Bloom settings
  BLOOM_ENABLED: true,
  BLOOM_STRENGTH: 0.3,            // Bloom intensity (0.0 - 1.0)
  BLOOM_RADIUS: 0.4,              // Bloom spread radius
  BLOOM_THRESHOLD: 0.85,          // Brightness threshold for bloom

  // Color Grading settings (horror atmosphere)
  COLOR_GRADING_ENABLED: true,
  CG_BRIGHTNESS: 0.02,            // Slightly brighter to compensate for PBR
  CG_CONTRAST: 1.05,              // Slightly more contrast
  CG_SATURATION: 0.9,             // Slightly desaturated
  CG_TINT_COLOR: 0xffffcc,        // Warm yellow tint (fluorescent light feel)
  CG_TINT_STRENGTH: 0.08,         // Tint intensity

  // Fog settings
  FOG_DENSITY: 0.05,              // FogExp2 density (lower = see farther)

  // Tone mapping
  TONE_MAPPING_EXPOSURE: 1.2,     // Exposure compensation

  // Autopilot
  AUTOPILOT_ENABLED: true,  // 預設啟用
  AUTOPILOT_DELAY: 0,       // 不等待，除非玩家有輸入才暫停
  AUTOPILOT_REPLAN_INTERVAL: 0.5,
  AUTOPILOT_AVOID_RADIUS: 0,
  AUTOPILOT_TURN_SPEED: 3.0, // 每秒最大轉向（rad），避免抖頭
  AUTOPILOT_COMBAT_ENABLED: true,
  AUTOPILOT_COMBAT_MAX_RANGE_TILES: 16,   // 目標搜尋最大距離（格）
  AUTOPILOT_COMBAT_FIRE_RANGE_TILES: 12,  // 射擊距離（格）
  AUTOPILOT_COMBAT_FOV_DEG: 110,          // 可開火的視角（度）
  AUTOPILOT_COMBAT_FIRE_ALIGN_DEG: 8,     // 開火時需要對準的角度（度），避免對空氣亂射
  AUTOPILOT_COMBAT_FIRE_ALIGN_PITCH_DEG: 10, // 開火時需要對準的俯仰角（度）
  AUTOPILOT_COMBAT_REQUIRE_LOS: true,     // 必須有直線視野才射擊
  AUTOPILOT_COMBAT_RETARGET_SECONDS: 0.35,// 重新選目標的最小間隔
  AUTOPILOT_COMBAT_BURST_ENABLED: true,
  AUTOPILOT_COMBAT_BURST_MIN_SHOTS: 2,
  AUTOPILOT_COMBAT_BURST_MAX_SHOTS: 4,
  AUTOPILOT_COMBAT_BURST_REST_MIN_SECONDS: 0.45,
  AUTOPILOT_COMBAT_BURST_REST_MAX_SECONDS: 0.95,

  // Player collision radius (in tiles)
  PLAYER_COLLISION_RADIUS: 0.35,
};

export function resolveMonsterCount(levelConfig = null) {
  const base = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
  const mult = levelConfig?.monsters?.countMultiplier ?? CONFIG.MONSTER_COUNT_MULTIPLIER ?? 1.0;
  const bonus = levelConfig?.monsters?.countBonus ?? 0;
  const max = levelConfig?.monsters?.maxCount ?? CONFIG.MONSTER_MAX_COUNT ?? 9999;

  const computed = Math.round(base * mult + bonus);
  return Math.max(0, Math.min(max, computed));
}
