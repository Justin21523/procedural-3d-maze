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
  CLASSROOMS_BLOCK: 9, // Classroom block / wing
  LAB: 10,             // Laboratory
  CAFETERIA: 11,       // Cafeteria / canteen
  MEDICAL: 12,         // Medical room (special)
  ARMORY: 13,          // Armory (special)
  CONTROL: 14,         // Control / Surveillance (special)
};

/**
 * Room configuration for each room type
 * Defines visual and gameplay properties
 */
export const ROOM_CONFIGS = {
  [ROOM_TYPES.CORRIDOR]: {
    name: 'Corridor',
    wallColor: 0xe8dcc0,
    floorColor: 0xc9b998,
    ceilingColor: 0xf0e8d0,
    lighting: { intensity: 0.6, color: 0xffffdd },
  },
  [ROOM_TYPES.CLASSROOM]: {
    name: 'Classroom',
    wallColor: 0xffffff,    // 纯白墙 - 非常明显
    floorColor: 0xb8d4e8,    // 浅蓝色瓷砖 - 明显不同
    ceilingColor: 0xffffff,
    lighting: { intensity: 0.9, color: 0xffffff }, // 非常亮
  },
  [ROOM_TYPES.OFFICE]: {
    name: 'Office',
    wallColor: 0xd4b896,     // 深米色墙
    floorColor: 0x5c3a1e,    // 深棕木地板 - 明显对比
    ceilingColor: 0xe8d4b8,
    lighting: { intensity: 0.6, color: 0xffc870 }, // 暖橙色
  },
  [ROOM_TYPES.BATHROOM]: {
    name: 'Bathroom',
    wallColor: 0x90d8f0,     // 明显的青蓝色瓷砖
    floorColor: 0x4080a0,    // 深蓝灰地砖 - 很明显
    ceilingColor: 0xe0f0ff,
    lighting: { intensity: 0.8, color: 0xc0e0ff }, // 冷蓝白光
  },
  [ROOM_TYPES.STORAGE]: {
    name: 'Storage',
    wallColor: 0x606060,     // 深灰混凝土 - 很暗
    floorColor: 0x404040,    // 非常深的灰 - 明显对比
    ceilingColor: 0x505050,
    lighting: { intensity: 0.25, color: 0xb0b080 }, // 非常昏暗
  },
  [ROOM_TYPES.LIBRARY]: {
    name: 'Library',
    wallColor: 0xa08060,     // 棕色木板 - 更深
    floorColor: 0x3d2817,    // 深深的木色 - 明显对比
    ceilingColor: 0xc8b090,
    lighting: { intensity: 0.55, color: 0xffcc80 }, // 温暖的黄橙光
  },
  [ROOM_TYPES.POOL]: {
    name: 'Pool',
    wallColor: 0x6ecff6,
    floorColor: 0x1f7ea5,
    ceilingColor: 0xb8e9ff,
    lighting: { intensity: 0.85, color: 0xb8e9ff },
  },
  [ROOM_TYPES.GYM]: {
    name: 'Gym',
    wallColor: 0x222222,
    floorColor: 0x333333,
    ceilingColor: 0x2a2a2a,
    lighting: { intensity: 0.6, color: 0xffe6b3 },
  },
  [ROOM_TYPES.BEDROOM]: {
    name: 'Dorm',
    wallColor: 0xe4d7c5,
    floorColor: 0xc8a97e,
    ceilingColor: 0xf3e9dc,
    lighting: { intensity: 0.65, color: 0xfff0d9 },
  },
  [ROOM_TYPES.CLASSROOMS_BLOCK]: {
    name: 'Classrooms Block',
    wallColor: 0xf7f7f7,
    floorColor: 0x90caf9,
    ceilingColor: 0xffffff,
    lighting: { intensity: 0.9, color: 0xffffff },
  },
  [ROOM_TYPES.LAB]: {
    name: 'Lab',
    wallColor: 0xe0f7fa,
    floorColor: 0xb0bec5,
    ceilingColor: 0xf0ffff,
    lighting: { intensity: 0.8, color: 0xe0ffff },
  },
  [ROOM_TYPES.CAFETERIA]: {
    name: 'Cafeteria',
    wallColor: 0xfff3e0,
    floorColor: 0xa1887f,
    ceilingColor: 0xfff8e1,
    lighting: { intensity: 0.75, color: 0xfff3d6 },
  },
  [ROOM_TYPES.MEDICAL]: {
    name: 'Medical',
    wallColor: 0xf4fbff,
    floorColor: 0x90caf9,
    ceilingColor: 0xffffff,
    lighting: { intensity: 0.9, color: 0xe8f5ff },
  },
  [ROOM_TYPES.ARMORY]: {
    name: 'Armory',
    wallColor: 0x2e2e2e,
    floorColor: 0x4e342e,
    ceilingColor: 0x3a3a3a,
    lighting: { intensity: 0.55, color: 0xffe0b2 },
  },
  [ROOM_TYPES.CONTROL]: {
    name: 'Control',
    wallColor: 0x1e2a36,
    floorColor: 0x263238,
    ceilingColor: 0x1b232c,
    lighting: { intensity: 0.7, color: 0xb3e5fc },
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
