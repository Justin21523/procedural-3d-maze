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
  PLAYER_RADIUS: 0.4,    // Collision radius (increased for better collision)
  MOUSE_SENSITIVITY: 0.002,

  // Monster settings
  MONSTER_BASE_HEIGHT: 1.8,// 怪物「基準身高」（未加 type scale） 
  MONSTER_SCALE_MULTIPLIER: 1.5, // 回到較大可視尺寸
  MONSTER_COUNT: 12,              // 調回 8 隻
  MONSTER_SPEED: 9,              // Base monster movement speed (VERY FAST continuous exploration)
  MONSTER_VISION_RANGE: 15,      // Base vision range (varies by type)
  MONSTER_FOV: Math.PI * 2 / 3,  // Base field of view (120 degrees)
  MONSTER_MODEL: '/models/VascodaGama.dae', // Default monster model (can be changed in UI)

  // Rendering settings
  FOV: 75,               // Field of view in degrees
  NEAR_PLANE: 0.1,
  FAR_PLANE: 1000,
  TARGET_FPS: 60,        // Target frames per second

  // Debug settings
  DEBUG_MODE: false,     // Enable debug visualizations
  SHOW_FPS: true,

  // Testing helpers
  AUTO_REVIVE: true,    // 自動復活：血量歸 0 時立刻回滿，方便測試不中斷

  // Mission settings
  MISSION_POINT_COUNT: 5, // 每局任務點數量

  // Performance
  LOW_PERF_MODE: false,  // 勾選後關閉大部分裝飾/降低像素比提升 FPS

  // Autopilot
  AUTOPILOT_ENABLED: true,  // 預設啟用
  AUTOPILOT_DELAY: 0,       // 不等待，除非玩家有輸入才暫停
  AUTOPILOT_REPLAN_INTERVAL: 0.5,
  AUTOPILOT_AVOID_RADIUS: 0,
};
