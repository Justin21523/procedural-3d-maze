/**
 * World state management
 * Stores and provides access to the current maze grid and spawn points
 */

import { TILE_TYPES, ROOM_TYPES, isWalkable as isWalkableTile } from './tileTypes.js';
import { CONFIG } from '../core/config.js';
import { randomInt } from '../utils/math.js';
import { generateMazeDFS, analyzeMaze, createRoomMapFromRooms } from './mapGenerator.js';

export class WorldState {
  constructor() {
    this.grid = null;
    this.roomMap = null;  // Stores room type for each tile
    this.rooms = null;    // Stores room objects
    this.width = 0;
    this.height = 0;
    this.spawnPoint = null;
    this.monsterSpawns = [];
  }

  /**
   * Initialize world with procedurally generated maze (Phase 2)
   * Uses DFS-based maze generation algorithm
   */
  initialize() {
    // Generate maze using DFS algorithm
    const width = CONFIG.MAZE_WIDTH;
    const height = CONFIG.MAZE_HEIGHT;

    console.log(`Generating maze: ${width}×${height}...`);
    const result = generateMazeDFS(width, height);
    this.grid = result.grid;
    this.rooms = result.rooms;

    this.height = this.grid.length;
    this.width = this.grid[0].length;

    // Generate room type map from actual room data
    console.log('Generating room types...');
    this.roomMap = createRoomMapFromRooms(this.grid, this.rooms);

    // Debug: Verify roomMap was created
    console.log('✅ WorldState roomMap created:', this.roomMap ? 'YES' : 'NO');
    if (this.roomMap) {
      console.log('RoomMap dimensions:', this.roomMap.length, 'x', this.roomMap[0].length);
    }

    // Log maze statistics
    const stats = analyzeMaze(this.grid);
    console.log('Maze statistics:', stats);

    // Find a random walkable spawn point for player
    this.spawnPoint = this.findRandomWalkableTile();

    // Find spawn points for monsters (future use)
    this.monsterSpawns = this.findMonsterSpawns(CONFIG.MONSTER_COUNT);
  }

  /**
   * Check if a grid coordinate is walkable
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {boolean} True if walkable, false otherwise
   */
  isWalkable(x, y) {
    // Out of bounds check
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) {
      return false;
    }

    return isWalkableTile(this.grid[y][x]);
  }

  /**
   * Get the tile type at a grid coordinate
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {number} Tile type or null if out of bounds
   */
  getTile(x, y) {
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) {
      return null;
    }
    return this.grid[y][x];
  }

  /**
   * Get the entire grid
   * @returns {Array<Array<number>>} 2D grid array
   */
  getGrid() {
    return this.grid;
  }

  /**
   * Get the room type at a grid coordinate
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {number} Room type or CORRIDOR if out of bounds
   */
  getRoomType(x, y) {
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) {
      return ROOM_TYPES.CORRIDOR;
    }
    return this.roomMap ? this.roomMap[y][x] : ROOM_TYPES.CORRIDOR;
  }

  /**
   * Get the entire room map
   * @returns {Array<Array<number>>} 2D room type array
   */
  getRoomMap() {
    return this.roomMap;
  }

  /**
   * Find a random walkable tile for spawning
   * @returns {Object} Grid coordinates {x, y}
   */
  findRandomWalkableTile() {
    const walkableTiles = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isWalkable(x, y)) {
          walkableTiles.push({ x, y });
        }
      }
    }

    if (walkableTiles.length === 0) {
      console.error('No walkable tiles found!');
      return { x: 1, y: 1 }; // Fallback
    }

    const randomIndex = randomInt(0, walkableTiles.length - 1);
    return walkableTiles[randomIndex];
  }

  /**
   * Find spawn points for monsters
   * @param {number} count - Number of spawn points needed
   * @returns {Array<Object>} Array of grid coordinates {x, y}
   */
  findMonsterSpawns(count) {
    const spawns = [];
    const attempts = count * 10; // Try multiple times to find good spawns

    for (let i = 0; i < attempts && spawns.length < count; i++) {
      const candidate = this.findRandomWalkableTile();

      // Make sure it's not too close to player spawn
      if (this.spawnPoint) {
        const dx = candidate.x - this.spawnPoint.x;
        const dy = candidate.y - this.spawnPoint.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 25) { // Minimum distance squared (5 tiles)
          continue;
        }
      }

      // Make sure it's not too close to other monster spawns
      let tooClose = false;
      for (const spawn of spawns) {
        const dx = candidate.x - spawn.x;
        const dy = candidate.y - spawn.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 9) { // Minimum distance squared (3 tiles)
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        spawns.push(candidate);
      }
    }

    return spawns;
  }

  /**
   * Get player spawn point
   * @returns {Object} Grid coordinates {x, y}
   */
  getSpawnPoint() {
    return this.spawnPoint;
  }

  /**
   * Get monster spawn points
   * @returns {Array<Object>} Array of grid coordinates {x, y}
   */
  getMonsterSpawns() {
    return this.monsterSpawns;
  }

  /**
   * Get exit point (farthest walkable tile from spawn)
   * @returns {Object} Grid coordinates {x, y}
   */
  getExitPoint() {
    if (!this.spawnPoint) {
      return this.findRandomWalkableTile();
    }

    // Find all walkable tiles
    const walkableTiles = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isWalkable(x, y)) {
          const dx = x - this.spawnPoint.x;
          const dy = y - this.spawnPoint.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          walkableTiles.push({ x, y, distance });
        }
      }
    }

    // Sort by distance and pick one from the farthest 10%
    walkableTiles.sort((a, b) => b.distance - a.distance);
    const topTen = Math.floor(walkableTiles.length * 0.1);
    const randomIndex = randomInt(0, Math.max(0, topTen - 1));

    return { x: walkableTiles[randomIndex].x, y: walkableTiles[randomIndex].y };
  }
}
