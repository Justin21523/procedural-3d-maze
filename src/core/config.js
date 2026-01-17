/**
 * Global game configuration
 * All game parameters are centralized here for easy tuning
 */

export const CONFIG = {
  // Maze settings (adjustable via settings panel)
  MAZE_WIDTH: 31,        // Maze size (odd numbers recommended)
  MAZE_HEIGHT: 31,       // Maze size (odd numbers recommended)
  ROOM_DENSITY: 3.0,     // Higher density = more rooms (adjustable in UI)
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
  // Global difficulty scaler for damage taken (stacks with roguelite mutators).
  PLAYER_DAMAGE_TAKEN_MULT: 0.9,
  PLAYER_BLOCK_MOVE_MULT: 0.85,       // movement speed multiplier while blocking
  PLAYER_BLOCK_KNOCKBACK_MULT: 0.5,   // reduce melee knockback while blocking
  PLAYER_BLOCK_STAMINA_MAX: 100,
  PLAYER_BLOCK_STAMINA_DRAIN: 34,     // stamina per second while holding block
  PLAYER_BLOCK_STAMINA_REGEN: 22,     // stamina per second while not blocking
  PLAYER_BLOCK_COOLDOWN: 1.2,         // seconds of forced vulnerability when stamina hits 0
  PLAYER_BLOCK_MIN_STAMINA_START: 10, // prevent flicker when almost empty

  // Player weapon view (first-person)
  PLAYER_GUN_ENABLED: true,
  PLAYER_WEAPON_VIEW_ENABLED: true,
  PLAYER_WEAPON_MODEL_PATH: '/models/weapon/assault_rifle_pbr.glb',
  PLAYER_WEAPON_SCALE: 1.0,
  // Slightly closer to the camera to improve visibility (esp. small weapons like pistols).
  PLAYER_WEAPON_OFFSET: { x: 0.35, y: -0.35, z: -0.58 },
  PLAYER_WEAPON_ROTATION: { x: -0.12, y: Math.PI + 0.12, z: 0.06 },
  PLAYER_WEAPON_SWAY: 0.9,
  PLAYER_WEAPON_BOB: 0.55,
  PLAYER_WEAPON_RECOIL: 1.0,
  PLAYER_CROSSHAIR_ENABLED: true,

  // Rendering quality (performance)
  RENDER_MAX_PIXEL_RATIO: 1.25,    // cap internal resolution (balances quality/perf on HiDPI)
  RENDER_MIN_PIXEL_RATIO: 0.85,    // dynamic resolution lower bound (avoid excessive blur)
  RENDER_DYNAMIC_RESOLUTION: true, // adjust pixel ratio to maintain FPS
  RENDER_TARGET_FPS: 60,
  RENDER_ANTIALIAS: false,         // MSAA is expensive on some GPUs
  RENDER_USE_PHYSICAL_MATERIALS: false, // MeshPhysicalMaterial is heavy; use MeshStandardMaterial by default
  RENDER_NORMAL_MAPS: true,
  RENDER_ENV_MAPS: true,
  RENDER_ENV_MAPS_FLOOR_ONLY: true, // keep reflections mainly on floors (big perf win)
  RENDER_TEXTURE_ANISOTROPY: 4,    // clamp anisotropy (big perf win vs max=16 on many GPUs)
  RENDER_EXPOSURE: 1.12,           // toneMapping exposure (helps avoid dull/dark look)

  // Lighting / mission-driven world effects
  POWER_OFF_LIGHT_MULTIPLIER: 0.75, // used when levels start "power off"

  // Monster settings
  MONSTER_BASE_HEIGHT: 1.6,// 怪物「基準身高」（未加 type scale）
  MONSTER_SCALE_MULTIPLIER: 1.5, // 回到較大可視尺寸
  MONSTER_BASE_HEALTH: 10,        // 怪物基礎血量（可由 typeConfig.stats.health 覆寫）
  MONSTER_HIT_STUN_SECONDS: 0.22, // 受擊硬直（秒）
  MONSTER_DEATH_EXPLOSION_RADIUS: 2.6,
  MONSTER_DEATH_EXPLOSION_DAMAGE: 3,
  MONSTER_COUNT: 3,               // 預設怪物數量（可被關卡覆寫）
  MONSTER_COUNT_MULTIPLIER: 0.7, // global difficulty scaler
  MONSTER_MAX_COUNT: 5,           // 怪物上限（避免模型太多爆量 / FPS 崩）
  MONSTER_BASE_SPEED_FACTOR: 0.66, // monster base speed = player speed * factor
  MONSTER_SPRINT_MULTIPLIER: 1.6, // 怪物短衝刺倍率
  MONSTER_LEVEL_SPEED_MULT: 1.0,  // 依關卡縮放的倍率預設值
  MONSTER_SPEED: 9,              // 舊參數（保留向後相容）
  MONSTER_VISION_RANGE: 15,      // Base vision range (varies by type)
  MONSTER_FOV: Math.PI * 2 / 3,  // Base field of view (120 degrees)
  MONSTER_HIT_RADIUS: 1.1,       // Bullet collision radius around monsters
  MONSTER_DEATH_DELAY: 0.35,     // Seconds from hit -> explode -> remove
  MONSTER_PROJECTILE_SPEED: 22,
  MONSTER_PROJECTILE_DAMAGE: 4,
  MONSTER_PROJECTILE_LIFETIME: 3.0,
  MONSTER_RESPAWN_DELAY: 1.25,   // Seconds before a replacement monster spawns
  MONSTER_MODEL: '/models/enemy/CityLicker/CityLicker.dae', // Default monster model (can be changed in UI)
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
  AI_DIFFICULTY: 0.75,             // 0.5 (easy) ~ 2.0 (hard)
  AI_VISION_GLOBAL_MULT: 1.0,
  AI_HEARING_GLOBAL_MULT: 1.0,
  AI_SMELL_GLOBAL_MULT: 1.0,
  AI_NOISE_ENABLED: true,
  AI_BASE_HEARING: 10,             // hearingRange=10 => baseline
  // Hearing occlusion: use shortest-path distance (walls attenuate hearing more realistically).
  AI_HEARING_USE_PATH_DISTANCE: true,
  AI_HEARING_PATH_DISTANCE_CANDIDATES: 4,
  AI_HEARING_CORRIDOR_COST_MULT: 0.9,
  AI_HEARING_ROOM_COST_MULT: 1.15,
  AI_HEARING_DOOR_COST_MULT: 0.95,
  AI_HEARING_THROUGH_WALL_ENABLED: true,
  AI_HEARING_MAX_WALL_TILES: 2,
  AI_HEARING_WALL_PENALTY: 6,
  AI_HEARING_BLOCKED_DOOR_PENALTY: 3,
  AI_NOISE_MAX_EVENTS: 32,
  AI_NOISE_GUNSHOT_RADIUS: 16,     // grid tiles
  AI_NOISE_FOOTSTEP_WALK_RADIUS: 4,
  AI_NOISE_FOOTSTEP_SPRINT_RADIUS: 7,
  AI_NOISE_BUMP_RADIUS: 7,
  AI_NOISE_BUMP_TTL: 0.35,
  AI_NOISE_BUMP_STRENGTH: 0.55,
  AI_NOISE_BUMP_COOLDOWN: 0.65,
  AI_NOISE_BUMP_MIN_MOVE_RATIO: 0.18,
  AI_NOISE_DOOR_RADIUS: 12,
  AI_NOISE_DOOR_TTL: 0.9,
  AI_NOISE_DOOR_STRENGTH: 0.85,
  AI_NOISE_IMPACT_RADIUS: 10,
  AI_NOISE_IMPACT_TTL: 0.6,
  AI_NOISE_IMPACT_STRENGTH: 0.7,
  AI_NOISE_IMPACT_PLAYER_ENABLED: true,
  AI_NOISE_IMPACT_PLAYER_RATE_LIMIT_SECONDS: 0.22,
  AI_NOISE_TTL_GUNSHOT: 1.2,
  AI_NOISE_TTL_FOOTSTEP: 0.45,
  AI_NOISE_MEMORY: 2.0,           // seconds a heard noise stays actionable
  // AI scent / smell tracking (breadcrumb trail)
  AI_SCENT_ENABLED: true,
  AI_BASE_SMELL: 10,               // smellRange=10 => baseline
  AI_SCENT_MAX_EVENTS: 64,
  AI_SCENT_DROP_DISTANCE_WORLD: 1.6, // world units between scent nodes (≈ meters)
  AI_SCENT_RADIUS: 8,              // grid tiles (scaled by monster smellRange)
  AI_SCENT_TTL: 12.0,              // seconds a scent node lasts
  AI_SCENT_MEMORY: 6.0,            // seconds a smelled scent stays actionable
  AI_SCENT_SPRINT_STRENGTH: 1.0,
  AI_SCENT_WALK_STRENGTH: 0.7,
  AI_ALERT_BROADCAST_RADIUS: 12,
  AI_ALERT_TTL: 1.0,
  AI_ALERT_COOLDOWN: 1.1,
  AI_INVESTIGATE_TIME: 4.8,
  AI_INVESTIGATE_PAUSE_SECONDS: 0.45,
  AI_SEARCH_RADIUS: 3,
  AI_SEARCH_SECONDS: 7.0,
  AI_CHASE_COOLDOWN_SECONDS: 6.0,
  AI_INTERCEPT_LOOKAHEAD_TILES: 6,
  AI_CHASE_REPLAN_INTERVAL: 0.35,
  AI_MAX_CHASERS: 2,
  AI_RANGED_GLOBAL_ENABLED: true,
  AI_TACTICS_ENABLED: true,
  AI_TACTICS_FLANK_SLOTS: 4,
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
  AI_SQUAD_MAX_RANGED_SHOOTERS: 1,
  AI_SQUAD_FIRE_GRANT_SECONDS: 0.9,
  AI_SQUAD_FLANK_JUNCTION_RADIUS: 7,
  AI_SQUAD_FLANK_JUNCTION_MIN_DIST: 2,

  // Debug overlays (intended for dev/testing; keep off by default for normal play).
  DEBUG_AI_OVERLAY_ENABLED: false,
  DEBUG_AI_MARKERS_ENABLED: false,
  DEBUG_AI_3D_LINES_ENABLED: false,
  DEBUG_AI_FILTER_CHASE_ONLY: false,
  DEBUG_AI_FILTER_LEADER_ONLY: false,
  DEBUG_AI_FILTER_NEAREST_N: 0,
  DEBUG_AI_3D_LINES_UPDATE_MS: 250,
  DEBUG_AI_3D_MAX_PATH_POINTS: 64,
  DEBUG_CRASH_OVERLAY_ENABLED: true,

  // Safe mode (force conservative graphics + lower load)
  SAFE_MODE_ENABLED: false,
  SAFE_MODE_MONSTER_MAX_COUNT: 3,

  // Watchdog (auto downgrade on persistent perf issues)
  WATCHDOG_ENABLED: true,
  WATCHDOG_LOW_FPS_THRESHOLD: 18,
  WATCHDOG_LOW_FPS_SECONDS: 3.0,
  WATCHDOG_DT_SPIKE_THRESHOLD: 0.22,
  WATCHDOG_DT_SPIKE_SECONDS: 1.2,

  // Debug visualization
  DEBUG_NAV_HEATMAP_ENABLED: false,
  DEBUG_NAV_HEATMAP_ALPHA: 0.55,

  // Global noise tuning (applies to NOISE_REQUESTED)
  GLOBAL_NOISE_RADIUS_MULT: 1.0,

  // Spawn Director (waves / squads / drops)
  SPAWN_DIRECTOR_ENABLED: true,
  SPAWN_DIRECTOR_INITIAL_RATIO: 0.4,   // initial alive = count * ratio
	  SPAWN_DIRECTOR_WAVE_INTERVAL: 5.0,   // seconds between spawn waves
	  SPAWN_DIRECTOR_BUDGET_RATE: 1.5,     // budget points per second
	  SPAWN_DIRECTOR_MAX_PICKUPS: 18,
	  SPAWN_DIRECTOR_PRESSURE_START: 0.65, // begin slowing spawns when projectile/FX load rises
	  SPAWN_DIRECTOR_PRESSURE_STOP: 0.85,  // pause spawns when projectile/FX load is high
  SPAWN_DIRECTOR_START_TOOL_LURE: 1,
  SPAWN_DIRECTOR_START_TOOL_TRAP: 1,
  SPAWN_DIRECTOR_START_TOOL_JAMMER: 1,
  SPAWN_DIRECTOR_START_TOOL_DECOY: 1,
  SPAWN_DIRECTOR_START_TOOL_SMOKE: 1,
  SPAWN_DIRECTOR_START_TOOL_FLASH: 1,
  SPAWN_DIRECTOR_START_TOOL_SENSOR: 1,
  SPAWN_DIRECTOR_START_TOOL_MINE: 1,
  SPAWN_DIRECTOR_TOOL_PICKUP_TTL: 45,
  SPAWN_DIRECTOR_TOOL_DROP_CHANCE: 0.06,
  SPAWN_DIRECTOR_ATTACHMENT_PICKUP_TTL: 38,
  SPAWN_DIRECTOR_ATTACHMENT_DROP_CHANCE: 0.05,

  // World devices (destructible props)
  WORLD_DEVICE_ALARM_BOX_MIN: 1,
  WORLD_DEVICE_ALARM_BOX_MAX: 3,
  WORLD_DEVICE_ALARM_BOX_HP: 12,
  WORLD_DEVICE_ALARM_BOX_HIT_RADIUS: 0.55,
  WORLD_DEVICE_ALARM_BOX_LISTEN_RADIUS: 14,
  WORLD_DEVICE_ALARM_BOX_NOISE_RADIUS: 26,
  WORLD_DEVICE_ALARM_BOX_NOISE_COOLDOWN: 2.2,

  WORLD_DEVICE_POWER_BOX_MIN: 0,
  WORLD_DEVICE_POWER_BOX_MAX: 2,
  WORLD_DEVICE_POWER_BOX_HP: 10,
  WORLD_DEVICE_POWER_BOX_HIT_RADIUS: 0.55,
  WORLD_DEVICE_POWER_BOX_EMP_RADIUS: 5.2,
  WORLD_DEVICE_POWER_BOX_EMP_STUN_SECONDS: 0.9,
  WORLD_DEVICE_POWER_BOX_EMP_JAM_SECONDS: 4.5,
  WORLD_DEVICE_POWER_BOX_NOISE_RADIUS: 18,

  WORLD_DEVICE_DOOR_LOCK_MIN: 1,
  WORLD_DEVICE_DOOR_LOCK_MAX: 4,
  WORLD_DEVICE_DOOR_LOCK_HP: 10,
  WORLD_DEVICE_DOOR_LOCK_HIT_RADIUS: 0.55,
  WORLD_DEVICE_DOOR_LOCK_MIN_DIST_FROM_SPAWN: 8,

  WORLD_DEVICE_LIGHT_MIN: 2,
  WORLD_DEVICE_LIGHT_MAX: 6,
  WORLD_DEVICE_LIGHT_HP: 8,
  WORLD_DEVICE_LIGHT_HIT_RADIUS: 0.6,
  WORLD_DEVICE_LIGHT_RADIUS: 9,
  WORLD_DEVICE_LIGHT_INTENSITY: 0.55,
  AI_DARK_VISION_MULT: 0.55,
  AI_DARK_HEARING_MULT: 1.35,
  AI_DARK_SMELL_MULT: 1.25,

  // Player-side darkness presentation when inside dark zones
  DARK_OVERLAY_MAX: 0.75,
  DARK_FOG_MULT: 2.2,

  // Carry / escort movement modifiers (missions can override via params)
  PLAYER_CARRY_HEAVY_SPEED_MULT: 0.72,
  PLAYER_CARRY_HEAVY_DISABLE_SPRINT: true,

  WORLD_DEVICE_SIREN_MIN: 0,
  WORLD_DEVICE_SIREN_MAX: 2,
  WORLD_DEVICE_SIREN_HP: 12,
  WORLD_DEVICE_SIREN_HIT_RADIUS: 0.65,
  WORLD_DEVICE_SIREN_NOISE_RADIUS: 28,
  WORLD_DEVICE_SIREN_NOISE_INTERVAL: 1.25,

  WORLD_DEVICE_BOSS_SHIELD_NODE_HP: 22,
  WORLD_DEVICE_BOSS_SHIELD_NODE_HIT_RADIUS: 0.7,

  // Tools (inventory deployables)
  TOOL_MAX_ACTIVE_DEVICES: 6,
  TOOL_LURE_DURATION: 10.0,
  TOOL_LURE_PULSE_INTERVAL: 0.45,
  TOOL_LURE_NOISE_RADIUS: 14,
  TOOL_LURE_NOISE_TTL: 0.9,
  TOOL_LURE_NOISE_STRENGTH: 0.8,
  TOOL_LURE_SCENT_RADIUS: 12,
  TOOL_LURE_SCENT_TTL: 14.0,
  TOOL_TRAP_DURATION: 40.0,
  TOOL_TRAP_RADIUS: 1.35, // world units
  TOOL_TRAP_STUN_SECONDS: 2.6,
  TOOL_JAMMER_DURATION: 12.0,
  TOOL_JAMMER_RADIUS: 6.5, // world units
  TOOL_JAMMER_REFRESH_SECONDS: 0.6,
  TOOL_DECOY_SPEED: 18.0,
  TOOL_DECOY_LIFETIME: 3.2,
  TOOL_DECOY_NOISE_RADIUS: 18,
  TOOL_DECOY_NOISE_TTL: 1.25,
  TOOL_DECOY_NOISE_STRENGTH: 1.0,
  TOOL_DECOY_SCENT_RADIUS: 14,
  TOOL_DECOY_SCENT_TTL: 16.0,
  TOOL_SMOKE_SPEED: 16.5,
  TOOL_SMOKE_LIFETIME: 2.8,
  TOOL_SMOKE_RADIUS: 3.8, // world units (vision blocker)
  TOOL_SMOKE_DURATION: 12.0,
  TOOL_SMOKE_WEAK_RADIUS_MULT: 0.75,
  TOOL_SMOKE_WEAK_DURATION_MULT: 0.65,
  TOOL_SMOKE_STRONG_RADIUS_MULT: 1.35,
  TOOL_SMOKE_STRONG_DURATION_MULT: 1.35,
  TOOL_FLASH_SPEED: 18.5,
  TOOL_FLASH_LIFETIME: 2.6,
  TOOL_FLASH_RADIUS: 4.8, // world units
  TOOL_FLASH_STUN_SECONDS: 0.65,
  TOOL_FLASH_BLIND_SECONDS: 3.8,
  TOOL_SCENT_SPRAY_SECONDS: 14.0,
  TOOL_SCENT_SPRAY_SCENT_RADIUS_MULT: 0.65,
  TOOL_SCENT_SPRAY_SCENT_STRENGTH_MULT: 0.45,
  TOOL_GLOWSTICK_DURATION: 150.0,
  TOOL_SONAR_RADIUS: 10, // tiles
  TOOL_SONAR_NOISE_RADIUS: 14,
  TOOL_DOOR_WEDGE_DURATION: 12.0,
  TOOL_DECOY_DELAY_SECONDS: 2.75,
  TOOL_DECOY_DELAY_BOOM_RADIUS: 28,
  TOOL_FAKE_TERMINAL_DURATION: 16.0,
  TOOL_FAKE_TERMINAL_PULSE_INTERVAL: 0.9,

  // Autopilot: interaction safety (avoid getting stuck spamming a target).
  AUTOPILOT_INTERACT_STALL_MAX_TRIES: 5,
  AUTOPILOT_INTERACT_STALL_WINDOW_SECONDS: 10,
  AUTOPILOT_INTERACT_STALL_UNREACHABLE_TTL_MS: 25_000,
  TOOL_FAKE_TERMINAL_NOISE_RADIUS: 24,
  TOOL_SENSOR_DURATION: 75.0,
  TOOL_SENSOR_RADIUS: 7.5, // world units
  TOOL_SENSOR_PING_COOLDOWN: 1.75,
  TOOL_MINE_DURATION: 55.0,
  TOOL_MINE_RADIUS: 1.35, // world units
  TOOL_MINE_DAMAGE: 8,
  TOOL_MINE_STUN_SECONDS: 1.4,
  AI_JAMMED_HEARING_MULT: 0.2,
  AI_JAMMED_SMELL_MULT: 0.15,
  AI_JAMMED_VISION_MULT: 0.65,
  AI_BLIND_FIRE_CHANCE: 0.35,
  AI_BLIND_FIRE_MEMORY_SECONDS: 2.5,
  AI_BLIND_FIRE_SPREAD_MULT: 4.0,
  AI_BLIND_FIRE_DAMAGE_MULT: 0.55,
  AI_BLIND_FIRE_NOISE_RADIUS: 14,
  AI_BLIND_RETREAT_DISTANCE_TILES: 2,
  AI_BLIND_RETREAT_MOVE_MULT: 0.9,
  AI_SMOKE_FOOTSTEP_NOISE_MULT: 0.55,  // while player is inside smoke cloud
  AI_SMOKE_GUNSHOT_NOISE_MULT: 0.75,   // while firing inside smoke cloud
  AI_SMOKE_SCENT_STRENGTH_MULT: 0.55,  // while player is inside smoke cloud
  AI_SMOKE_SCENT_RADIUS_MULT: 0.85,    // while player is inside smoke cloud

  // Boss (L10)
  BOSS_SHIELD_NODES: 3,
  BOSS_CORE_HEALTH: 120,
  BOSS_ESCAPE_SECONDS: 35,
  BOSS_NODE_MIN_DIST_FROM_SPAWN: 10,
  BOSS_NODE_MIN_DIST_FROM_EXIT: 6,

  // Skills
  SKILL_EMP_JAM_SECONDS: 4.5,
  SKILL_EMP_CHARGE_RADIUS_BONUS: 1.4,
  SKILL_EMP_CHARGE_JAM_SECONDS_BONUS: 2.0,

  // Weapon attachments
  WEAPON_MOD_SLOTS_DEFAULT: 2,

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
  MAZE_SEED: null,        // optional: deterministic generation seed (number|string)
  MAZE_GENERATION_MAX_ATTEMPTS: 6,
  MAZE_VALIDATION_MIN_EXIT_DISTANCE: 10,

  // Performance
  LOW_PERF_MODE: false,  // 勾選後關閉大部分裝飾/降低像素比提升 FPS
  MINIMAP_SHOW_OBSTACLES: false,         // debug overlay: show obstacleMap tiles on the minimap
  WORLD_SHOW_OBSTACLE_OVERLAY: false,    // debug overlay: show obstacleMap tiles in 3D
  MINIMAP_FORCE_HIDDEN: false,           // roguelite/modes: hide minimap regardless of UI toggle
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
	  PROJECTILE_FAR_DISTANCE_TILES: 18,      // beyond this distance, tick projectiles less often
	  PROJECTILE_FAR_TICK_SECONDS: 0.06,      // far projectile tick interval (seconds)
	  FX_RENDER_DISTANCE_TILES: 18,           // skip spawning impact/explosion visuals beyond this distance
  MONSTER_RENDER_CULL_DISTANCE_TILES: 22, // hide monster models beyond this distance to reduce draw cost

  // Monster defense + drops (reduce complexity, add clear gameplay loops)
  MONSTER_GUARD_ENABLED: true,
  MONSTER_GUARD_CHANCE: 0.14,          // chance to enter guard on hit (when available)
  MONSTER_GUARD_MIN_HEALTH_RATIO: 0.55, // more likely to guard when below this health ratio
  MONSTER_GUARD_DURATION_SECONDS: 0.7,
  MONSTER_GUARD_COOLDOWN_SECONDS: 2.2,
  MONSTER_GUARD_DAMAGE_MULT: 0.35,     // guard reduces incoming damage

  MONSTER_DROP_HEALTH_CHANCE: 0.28,
  MONSTER_DROP_HEALTH_SMALL_AMOUNT: 14,
  MONSTER_DROP_HEALTH_BIG_CHANCE: 0.06,
  MONSTER_DROP_HEALTH_BIG_AMOUNT: 34,
  MONSTER_DROP_HEART_CHANCE: 0.12,
  MONSTER_DROP_HEART_MAX_HEALTH_BONUS: 2, // permanent max health increase

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
  POOL_HDR_ENABLED: true,
  POOL_HDR_PATH: '/pool_1k.hdr',
  ENVIRONMENT_HDR_ENABLED: true,
  ENVIRONMENT_HDR_PATH: '/pool_1k.hdr',
  POOL_FX_ENABLED: true,
  POOL_FX_UPDATE_HZ: 20,              // cap water surface updates (CPU saver)
  POOL_FX_CULL_DISTANCE_TILES: 14,    // hide + stop updating pool FX when far
  POOL_MODEL_CULL_DISTANCE_TILES: 22, // hide pool model when far

  // Post-processing settings
  POST_PROCESSING_ENABLED: true,  // Enable post-processing pipeline

  // Save / progress
  AUTO_SAVE_ENABLED: true,
  AUTO_SAVE_INTERVAL_SECONDS: 45,

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
  AUTOPILOT_TOOL_AI_ENABLED: true,

  // AutoPilot: combat QoL
  AUTOPILOT_SAFE_RELOAD_MIN_DIST_TILES: 6,
  AUTOPILOT_RELOAD_WHEN_MAG_BELOW: 3,

  // AutoPilot: boss node shooting (L10)
  AUTOPILOT_BOSS_NODE_REQUIRE_LOS: true,
  AUTOPILOT_BOSS_NODE_MAX_RANGE_TILES: 12,
  AUTOPILOT_BOSS_NODE_FIRE_RANGE_TILES: 10,
  AUTOPILOT_BOSS_NODE_AIM_Y: 0.55,
  AUTOPILOT_REPLAN_INTERVAL: 0.5,
  AUTOPILOT_AVOID_RADIUS: 0,
  AUTOPILOT_TURN_SPEED: 3.0, // 每秒最大轉向（rad），避免抖頭
  AUTOPILOT_COMBAT_ENABLED: true,
  AUTOPILOT_COMBAT_MAX_RANGE_TILES: 16,   // 目標搜尋最大距離（格）
  AUTOPILOT_COMBAT_FIRE_RANGE_TILES: 12,  // 射擊距離（格）
  AUTOPILOT_COMBAT_FOV_DEG: 110,          // 可開火的視角（度）
  AUTOPILOT_COMBAT_FIRE_ALIGN_DEG: 12,     // 開火時需要對準的角度（度），避免對空氣亂射
  AUTOPILOT_COMBAT_FIRE_ALIGN_PITCH_DEG: 14, // 開火時需要對準的俯仰角（度）
  AUTOPILOT_COMBAT_REQUIRE_LOS: true,     // 必須有直線視野才射擊
  AUTOPILOT_COMBAT_RETARGET_SECONDS: 0.35,// 重新選目標的最小間隔
  AUTOPILOT_COMBAT_DAMAGE_MULT: 2.0,      // 自動駕駛射擊傷害倍率（不影響玩家手動）
  AUTOPILOT_BURST_SPRINT_ENABLED: true,
  AUTOPILOT_BURST_SPRINT_ON_SECONDS: 0.65,
  AUTOPILOT_BURST_SPRINT_OFF_SECONDS: 0.9,
  AUTOPILOT_DIVERSION_DEFAULT_SECONDS: 5.0,
  AUTOPILOT_COMBAT_BURST_ENABLED: true,
  AUTOPILOT_COMBAT_BURST_MIN_SHOTS: 3,
  AUTOPILOT_COMBAT_BURST_MAX_SHOTS: 6,
  AUTOPILOT_COMBAT_BURST_REST_MIN_SECONDS: 0.28,
  AUTOPILOT_COMBAT_BURST_REST_MAX_SECONDS: 0.55,
  AUTOPILOT_PICKUP_UNREACHABLE_TTL: 30_000, // ms: avoid re-targeting a problematic pickup for a while

  // Player collision radius (in tiles)
  PLAYER_COLLISION_RADIUS: 0.35,
};

export function resolveMonsterCount(levelConfig = null) {
  const base = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
  const mult = levelConfig?.monsters?.countMultiplier ?? CONFIG.MONSTER_COUNT_MULTIPLIER ?? 1.0;
  const bonus = levelConfig?.monsters?.countBonus ?? 0;
  const max = levelConfig?.monsters?.maxCount ?? CONFIG.MONSTER_MAX_COUNT ?? 9999;

  const computed = Math.round(base * mult + bonus);
  const safeCap = (CONFIG.SAFE_MODE_ENABLED === true)
    ? Math.max(0, Math.round(Number(CONFIG.SAFE_MODE_MONSTER_MAX_COUNT) || 0))
    : null;
  const cappedMax = safeCap !== null ? Math.min(max, safeCap) : max;
  return Math.max(0, Math.min(cappedMax, computed));
}
