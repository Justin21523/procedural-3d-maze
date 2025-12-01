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
    this.missionPoints = [];
  }

  /**
   * Initialize world with procedurally generated maze (Phase 2)
   * Uses DFS-based maze generation algorithm
   */
  initialize(levelConfig = null) {
    // Generate maze using DFS algorithm
    const mazeCfg = levelConfig?.maze || {};
    const width = mazeCfg.width ?? CONFIG.MAZE_WIDTH;
    const height = mazeCfg.height ?? CONFIG.MAZE_HEIGHT;

    console.log(`Generating maze: ${width}×${height}...`);
    const result = generateMazeDFS(width, height, {
      roomDensity: mazeCfg.roomDensity,
      extraConnectionChance: mazeCfg.extraConnectionChance,
      noDeadEnds: mazeCfg.noDeadEnds ?? true,
      minRoomSize: mazeCfg.minRoomSize,
      maxRoomSize: mazeCfg.maxRoomSize,
      minRoomDoors: mazeCfg.minRoomDoors ?? 2,
      deadEndPasses: mazeCfg.deadEndPasses ?? 3
    });
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
    const monsterCount = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
    this.monsterSpawns = this.findMonsterSpawns(monsterCount);
    // Mission points
    const missionCount = levelConfig?.missions?.missionPointCount ?? CONFIG.MISSION_POINT_COUNT;
    this.missionPoints = this.findMissionPoints(missionCount);
  
  }

  /**
   * Check if a grid coordinate is walkable
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {boolean} True if walkable, false otherwise
   */
  isWalkable(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
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
    // 優先離邊界有安全距、四周可走的格子，避免出生時被碰撞判定卡住
    const preferred = [];
    const fallback = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.isWalkable(x, y)) continue;

        const hasMargin = this.isWalkableWithMargin(x, y, 1);
        const awayFromBorder = x > 1 && y > 1 && x < this.width - 2 && y < this.height - 2;

        if (hasMargin && awayFromBorder) {
          preferred.push({ x, y });
        } else {
          fallback.push({ x, y });
        }
      }
    }

    const pool = preferred.length > 0 ? preferred : fallback;

    if (pool.length === 0) {
      console.error('No walkable tiles found!');
      return { x: 1, y: 1 }; // Fallback
    }

    const randomIndex = randomInt(0, pool.length - 1);
    return pool[randomIndex];
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
      if (!this.isWalkableWithMargin(candidate.x, candidate.y, 1)) {
        continue; // 避開貼牆的出生點
      }

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
   * Get mission points
   */
  getMissionPoints() {
    return this.missionPoints;
  }

  /**
   * Find mission point locations
   */
  findMissionPoints(count) {
    const points = [];
    const attempts = count * 15;

    for (let i = 0; i < attempts && points.length < count; i++) {
      const candidate = this.findRandomWalkableTile();
      if (!this.isWalkableWithMargin(candidate.x, candidate.y, 1)) continue;

      // Keep distance from spawn
      const dx = candidate.x - this.spawnPoint.x;
      const dy = candidate.y - this.spawnPoint.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < 36) continue; // at least 6 tiles away

      // Keep distance from other mission points
      let tooClose = false;
      for (const p of points) {
        const ddx = candidate.x - p.x;
        const ddy = candidate.y - p.y;
        if ((ddx * ddx + ddy * ddy) < 16) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      points.push(candidate);
    }
    return points;
  }

  /**
   * Walkable check with一個方形邊界，確保四周都有可走空間
   * @param {number} x - Grid X
   * @param {number} y - Grid Y
   * @param {number} margin - Padding in tiles to remain walkable
   * @returns {boolean}
   */
  isWalkableWithMargin(x, y, margin = 1) {
    for (let dy = -margin; dy <= margin; dy++) {
      for (let dx = -margin; dx <= margin; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) return false;
        if (!this.isWalkable(nx, ny)) return false;
      }
    }
    return true;
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

  /**
   * Grid-based line of sight check
   */
  hasLineOfSight(a, b) {
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return false;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);

      if (!this.isWalkable(x, y)) {
        return false;
      }
    }
    return true;
  }
}
