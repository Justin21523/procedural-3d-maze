/**
 * Tile type definitions for the maze grid
 * Each tile type represents a different kind of cell in the 2D grid
 */

export const TILE_TYPES = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
};

/**
 * Room type definitions
 * Used to mark different areas of the map with different themes
 */
export const ROOM_TYPES = {
  CORRIDOR: 0,      // 走廊 - Backrooms 经典风格
  CLASSROOM: 1,     // 教室 - 白墙、课桌
  OFFICE: 2,        // 办公室 - 木地板、办公桌
  BATHROOM: 3,      // 洗手间 - 瓷砖
  STORAGE: 4,       // 储藏室 - 混凝土
  LIBRARY: 5,       // 图书馆 - 书架
  POOL: 6,          // 游泳池
  GYM: 7,           // 健身房
  BEDROOM: 8,       // 卧室/宿舍
};

/**
 * Room configuration for each room type
 * Defines visual and gameplay properties
 */
export const ROOM_CONFIGS = {
  [ROOM_TYPES.CORRIDOR]: {
    name: '走廊',
    wallColor: 0xe8dcc0,
    floorColor: 0xc9b998,
    ceilingColor: 0xf0e8d0,
    lighting: { intensity: 0.6, color: 0xffffdd },
  },
  [ROOM_TYPES.CLASSROOM]: {
    name: '教室',
    wallColor: 0xffffff,    // 纯白墙 - 非常明显
    floorColor: 0xb8d4e8,    // 浅蓝色瓷砖 - 明显不同
    ceilingColor: 0xffffff,
    lighting: { intensity: 0.9, color: 0xffffff }, // 非常亮
  },
  [ROOM_TYPES.OFFICE]: {
    name: '办公室',
    wallColor: 0xd4b896,     // 深米色墙
    floorColor: 0x5c3a1e,    // 深棕木地板 - 明显对比
    ceilingColor: 0xe8d4b8,
    lighting: { intensity: 0.6, color: 0xffc870 }, // 暖橙色
  },
  [ROOM_TYPES.BATHROOM]: {
    name: '洗手间',
    wallColor: 0x90d8f0,     // 明显的青蓝色瓷砖
    floorColor: 0x4080a0,    // 深蓝灰地砖 - 很明显
    ceilingColor: 0xe0f0ff,
    lighting: { intensity: 0.8, color: 0xc0e0ff }, // 冷蓝白光
  },
  [ROOM_TYPES.STORAGE]: {
    name: '储藏室',
    wallColor: 0x606060,     // 深灰混凝土 - 很暗
    floorColor: 0x404040,    // 非常深的灰 - 明显对比
    ceilingColor: 0x505050,
    lighting: { intensity: 0.25, color: 0xb0b080 }, // 非常昏暗
  },
  [ROOM_TYPES.LIBRARY]: {
    name: '图书馆',
    wallColor: 0xa08060,     // 棕色木板 - 更深
    floorColor: 0x3d2817,    // 深深的木色 - 明显对比
    ceilingColor: 0xc8b090,
    lighting: { intensity: 0.55, color: 0xffcc80 }, // 温暖的黄橙光
  },
  [ROOM_TYPES.POOL]: {
    name: '游泳池',
    wallColor: 0x6ecff6,
    floorColor: 0x1f7ea5,
    ceilingColor: 0xb8e9ff,
    lighting: { intensity: 0.85, color: 0xb8e9ff },
  },
  [ROOM_TYPES.GYM]: {
    name: '健身房',
    wallColor: 0x222222,
    floorColor: 0x333333,
    ceilingColor: 0x2a2a2a,
    lighting: { intensity: 0.6, color: 0xffe6b3 },
  },
  [ROOM_TYPES.BEDROOM]: {
    name: '宿舍',
    wallColor: 0xe4d7c5,
    floorColor: 0xc8a97e,
    ceilingColor: 0xf3e9dc,
    lighting: { intensity: 0.65, color: 0xfff0d9 },
  },
};

/**
 * Check if a tile type is walkable
 * @param {number} tileType - The tile type to check
 * @returns {boolean} True if walkable, false otherwise
 */
export function isWalkable(tileType) {
  return tileType === TILE_TYPES.FLOOR || tileType === TILE_TYPES.DOOR;
}

/**
 * Get room config by room type
 * @param {number} roomType - Room type
 * @returns {Object} Room configuration
 */
export function getRoomConfig(roomType) {
  return ROOM_CONFIGS[roomType] || ROOM_CONFIGS[ROOM_TYPES.CORRIDOR];
}
