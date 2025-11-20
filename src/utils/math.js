/**
 * Utility math functions for game calculations
 */

/**
 * Calculate Euclidean distance between two points
 * @param {Object} a - First point {x, y} or {x, y, z}
 * @param {Object} b - Second point {x, y} or {x, y, z}
 * @returns {number} Distance between points
 */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y !== undefined && b.y !== undefined ? a.y - b.y : 0;
  const dz = a.z !== undefined && b.z !== undefined ? a.z - b.z : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate Manhattan distance between two grid points
 * @param {Object} a - First point {x, y}
 * @param {Object} b - Second point {x, y}
 * @returns {number} Manhattan distance
 */
export function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0 to 1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert grid coordinates to world coordinates
 * @param {number} gridX - Grid X coordinate
 * @param {number} gridY - Grid Y coordinate
 * @param {number} tileSize - Size of each tile
 * @returns {Object} World coordinates {x, z}
 */
export function gridToWorld(gridX, gridY, tileSize) {
  return {
    x: gridX * tileSize,
    z: gridY * tileSize,
  };
}

/**
 * Convert world coordinates to grid coordinates
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {number} tileSize - Size of each tile
 * @returns {Object} Grid coordinates {x, y}
 */
export function worldToGrid(worldX, worldZ, tileSize) {
  return {
    x: Math.floor(worldX / tileSize),
    y: Math.floor(worldZ / tileSize),
  };
}

/**
 * Generate a random integer between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random integer
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
