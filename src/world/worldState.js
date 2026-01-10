/**
 * World state management
 * Stores and provides access to the current maze grid and spawn points
 */

import { TILE_TYPES, ROOM_TYPES, isWalkable as isWalkableTile } from './tileTypes.js';
import { CONFIG, resolveMonsterCount } from '../core/config.js';
import { randomInt } from '../utils/math.js';
import { generateMazeDFS, analyzeMaze, createRoomMapFromRooms } from './mapGenerator.js';
import { planPropObstacles } from './propPlanner.js';

export class WorldState {
  constructor() {
    this.grid = null;
    this.roomMap = null;  // Stores room type for each tile
    this.rooms = null;    // Stores room objects
    this.obstacleMap = null; // Additional per-tile obstacles (models / props)
    this.propPlan = null; // Planned prop descriptors (visuals align to obstacles)
    this.propSeed = 0;
    this.width = 0;
    this.height = 0;
    this.spawnPoint = null;
    this.exitPoint = null;
    this.monsterSpawns = [];
    this.missionPoints = [];
    this.smokeClouds = [];
  }

  /**
   * Initialize world with procedurally generated maze (Phase 2)
   * Uses DFS-based maze generation algorithm
   */
  initialize(levelConfig = null) {
    this.smokeClouds = [];
    this.exitPoint = null;
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
      deadEndPasses: mazeCfg.deadEndPasses ?? 3,
      // Optional per-level room type weights to steer the theme (Classrooms-like maps).
      roomTypeWeights: levelConfig?.rooms?.typeWeights ?? mazeCfg.roomTypeWeights ?? null
    });
    this.grid = result.grid;
    this.rooms = result.rooms;

    this.height = this.grid.length;
    this.width = this.grid[0].length;

    // Generate room type map from actual room data
    console.log('Generating room types...');
    this.roomMap = createRoomMapFromRooms(this.grid, this.rooms);

    // Apply environment obstacles (e.g., large room props like the pool model)
    this.initializeObstacleMap();
    this.applyEnvironmentObstacles(levelConfig);
    this.applyPropObstacles(levelConfig);

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
    const monsterCount = resolveMonsterCount(levelConfig);
    this.monsterSpawns = this.findMonsterSpawns(monsterCount);
    // Mission points
    const missionCount = levelConfig?.missions?.missionPointCount ?? CONFIG.MISSION_POINT_COUNT;
    this.missionPoints = this.findMissionPoints(missionCount);
  
  }

  initializeObstacleMap() {
    this.obstacleMap = new Array(this.height);
    for (let y = 0; y < this.height; y++) {
      this.obstacleMap[y] = new Array(this.width).fill(false);
    }
  }

  clearObstacles() {
    if (!this.obstacleMap) return;
    for (let y = 0; y < this.height; y++) {
      this.obstacleMap[y].fill(false);
    }
  }

  setObstacle(x, y, blocked = true) {
    if (!this.obstacleMap) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) return;
    this.obstacleMap[y][x] = !!blocked;
  }

  applyEnvironmentObstacles(levelConfig = null) {
    if (!this.obstacleMap) this.initializeObstacleMap();
    this.clearObstacles();
    this.propPlan = null;

    // Pool room: the pool model is an enormous prop with no mesh collision;
    // mark its room tiles as blocked so pathing + movement never "walks through" it.
    const poolEnabled = CONFIG.POOL_MODEL_ENABLED ?? true;
    if (!poolEnabled) return;

    const rooms = Array.isArray(this.rooms) ? this.rooms : [];
    for (const room of rooms) {
      if (!room || room.type !== ROOM_TYPES.POOL) continue;
      const tiles = Array.isArray(room.tiles) ? room.tiles : [];
      for (const t of tiles) {
        this.setObstacle(t.x, t.y, true);
      }
    }
  }

  applyPropObstacles(levelConfig = null) {
    const seed = levelConfig?.props?.seed;
    const maxCount = levelConfig?.budgets?.propsMax;
    planPropObstacles(this, { seed, maxCount });
  }

  getPropPlan() {
    return this.propPlan;
  }

  getPropAt(x, y) {
    if (!this.propPlan) return null;
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) return null;
    return this.propPlan?.[y]?.[x] || null;
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

    if (!isWalkableTile(this.grid[y][x])) {
      return false;
    }
    if (this.obstacleMap && this.obstacleMap[y] && this.obstacleMap[y][x]) {
      return false;
    }
    return true;
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
   * Get the list of generated rooms (with type + bounds).
   * @returns {Array<Object>}
   */
  getRooms() {
    return Array.isArray(this.rooms) ? this.rooms : [];
  }

  getSmokeClouds() {
    return Array.isArray(this.smokeClouds) ? this.smokeClouds : [];
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
    const used = new Set();

    const passes = [
      { attemptsMult: 10, minPlayerDist: 5, minSpawnDist: 3 },
      { attemptsMult: 18, minPlayerDist: 4, minSpawnDist: 2 },
      { attemptsMult: 26, minPlayerDist: 3, minSpawnDist: 1 },
    ];

    for (const pass of passes) {
      if (spawns.length >= count) break;

      const attempts = Math.max(0, count) * pass.attemptsMult;
      const minPlayerDistSq = pass.minPlayerDist * pass.minPlayerDist;
      const minSpawnDistSq = pass.minSpawnDist * pass.minSpawnDist;

      for (let i = 0; i < attempts && spawns.length < count; i++) {
        const candidate = this.findRandomWalkableTile();
        if (!candidate) continue;

        const key = `${candidate.x},${candidate.y}`;
        if (used.has(key)) continue;

        if (!this.isWalkableWithMargin(candidate.x, candidate.y, 1)) {
          continue; // 避開貼牆的出生點
        }

        // Make sure it's not too close to player spawn
        if (this.spawnPoint) {
          const dx = candidate.x - this.spawnPoint.x;
          const dy = candidate.y - this.spawnPoint.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < minPlayerDistSq) {
            continue;
          }
        }

        // Make sure it's not too close to other monster spawns
        let tooClose = false;
        for (const spawn of spawns) {
          const dx = candidate.x - spawn.x;
          const dy = candidate.y - spawn.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < minSpawnDistSq) {
            tooClose = true;
            break;
          }
        }

        if (tooClose) continue;

        used.add(key);
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
    if (this.exitPoint && Number.isFinite(this.exitPoint.x) && Number.isFinite(this.exitPoint.y)) {
      return { x: this.exitPoint.x, y: this.exitPoint.y };
    }
    if (!this.spawnPoint) {
      const p = this.findRandomWalkableTile();
      this.exitPoint = p ? { x: p.x, y: p.y } : null;
      return p;
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

    const exit = { x: walkableTiles[randomIndex].x, y: walkableTiles[randomIndex].y };
    this.exitPoint = exit;
    return { x: exit.x, y: exit.y };
  }

  toSaveData() {
    return {
      width: Number(this.width) || 0,
      height: Number(this.height) || 0,
      grid: this.grid,
      roomMap: this.roomMap,
      rooms: this.rooms,
      spawnPoint: this.spawnPoint,
      exitPoint: this.exitPoint,
      monsterSpawns: this.monsterSpawns,
      missionPoints: this.missionPoints
    };
  }

  applySaveData(data, levelConfig = null) {
    const d = data && typeof data === 'object' ? data : null;
    if (!d) return false;

    const grid = Array.isArray(d.grid) ? d.grid : null;
    const roomMap = Array.isArray(d.roomMap) ? d.roomMap : null;
    if (!grid || !roomMap) return false;

    this.grid = grid;
    this.rooms = Array.isArray(d.rooms) ? d.rooms : [];
    this.roomMap = roomMap;
    this.height = grid.length;
    this.width = grid[0]?.length || 0;

    const sp = d.spawnPoint;
    this.spawnPoint = sp && Number.isFinite(sp.x) && Number.isFinite(sp.y) ? { x: sp.x, y: sp.y } : this.findRandomWalkableTile();

    const ep = d.exitPoint;
    this.exitPoint = ep && Number.isFinite(ep.x) && Number.isFinite(ep.y) ? { x: ep.x, y: ep.y } : null;

    this.monsterSpawns = Array.isArray(d.monsterSpawns) ? d.monsterSpawns : [];
    this.missionPoints = Array.isArray(d.missionPoints) ? d.missionPoints : [];

    this.initializeObstacleMap();
    this.applyEnvironmentObstacles(levelConfig);
    this.applyPropObstacles(levelConfig);
    return true;
  }

  /**
   * Grid-based line of sight check
   */
  hasLineOfSight(a, b) {
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return false;
    }

    // Bresenham line traversal over grid tiles (more conservative than rounding-based sampling).
    let x0 = Math.round(a.x);
    let y0 = Math.round(a.y);
    const x1 = Math.round(b.x);
    const y1 = Math.round(b.y);

    let dx = Math.abs(x1 - x0);
    let sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0);
    let sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      if (!this.isWalkable(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }

    return true;
  }
}
