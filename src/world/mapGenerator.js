/**
 * Maze generation algorithms
 * Implements DFS-based maze generation for procedural level creation
 */

import { TILE_TYPES, ROOM_TYPES } from './tileTypes.js';
import { randomInt } from '../utils/math.js';
import { CONFIG } from '../core/config.js';
/**
 * Generate a room-based map with large open spaces
 * Creates distinct rooms connected by corridors
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Object} options - Generation options
 * @returns {Object} Object containing grid and rooms array
 */
export function generateMazeDFS(width, height, options = {}) {
  // 建議外面給奇數，這裡再保險修一次
  if (width % 2 === 0)  width  -= 1;
  if (height % 2 === 0) height -= 1;

  // 全部先當成牆
  const grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => TILE_TYPES.WALL)
  );

  // ==== 1) DFS carve base corridor maze ====
  carveDFS(grid);

  // 加一些額外通道減少死路
  const extraChance = options.extraConnectionChance ?? 0.18;
  addExtraConnections(grid, extraChance);

  // ==== 2) 從走廊長出房間 ====
  const rooms = carveRoomsFromCorridors(grid, options);

  if (options.noDeadEnds) {
    // 最後一層：打掉走廊死路，讓路網更通透
    removeDeadEnds(grid, options.deadEndPasses ?? 3);
  }

  return { grid, rooms };
}

/**
 * 標準 DFS 迷宮演算法，在「奇數格」上 carve
 */
function carveDFS(grid) {
  const height = grid.length;
  const width = grid[0].length;

  const stack = [];
  const visited = new Set();

  function key(x, y) { return `${x},${y}`; }

  // 起點 (1,1)
  let cx = 1, cy = 1;
  grid[cy][cx] = TILE_TYPES.FLOOR;
  stack.push({ x: cx, y: cy });
  visited.add(key(cx, cy));

  const dirs = [
    { dx:  2, dy:  0 },
    { dx: -2, dy:  0 },
    { dx:  0, dy:  2 },
    { dx:  0, dy: -2 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];

    const neighbors = [];
    for (const d of dirs) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;

      if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
      if (!visited.has(key(nx, ny))) {
        neighbors.push({
          x: nx,
          y: ny,
          between: { x: current.x + d.dx / 2, y: current.y + d.dy / 2 }
        });
      }
    }

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const choice = neighbors[randomInt(0, neighbors.length - 1)];
    const { x: nx, y: ny, between } = choice;

    // 打通牆
    grid[between.y][between.x] = TILE_TYPES.FLOOR;
    grid[ny][nx] = TILE_TYPES.FLOOR;

    visited.add(key(nx, ny));
    stack.push({ x: nx, y: ny });
  }
}

/**
 * 隨機打掉一些牆，讓迷宮有 loop、不要太 linear
 */
function addExtraConnections(grid, chance = 0.05) {
  const height = grid.length;
  const width = grid[0].length;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      if (Math.random() > chance) continue;

      const candidates = [];
      if (x + 2 < width - 1)  candidates.push({ wx: x + 1, wy: y     }); // 向右連
      if (y + 2 < height - 1) candidates.push({ wx: x,     wy: y + 1 }); // 向下連

      if (candidates.length === 0) continue;

      const c = candidates[randomInt(0, candidates.length - 1)];
      if (grid[c.wy][c.wx] === TILE_TYPES.WALL) {
        grid[c.wy][c.wx] = TILE_TYPES.FLOOR;
      }
    }
  }
}

/**
 * 從現有走廊 carve 出房間，並用 DOOR 連接
 */
function carveRoomsFromCorridors(grid, options = {}) {
  const height = grid.length;
  const width = grid[0].length;

  const rooms = [];
  // Higher base density so rooms dominate over corridors
  const baseRooms = Math.floor((width * height) / 180);
  const density = options.roomDensity ?? CONFIG.ROOM_DENSITY ?? 1.0;
  const minRoomSize = options.minRoomSize ?? 5;
  const maxRoomSize = options.maxRoomSize ?? 10;
  const minDoors = options.minRoomDoors ?? 2;
  const maxRooms = Math.max(20, Math.floor(baseRooms * density));
  let attempts = 0;

  const dirs = [
    { dx:  1, dy:  0 },  // room 在東邊
    { dx: -1, dy:  0 },  // 西
    { dx:  0, dy:  1 },  // 南
    { dx:  0, dy: -1 },  // 北
  ];

  while (rooms.length < maxRooms && attempts < maxRooms * 10) {
    attempts++;

    // 隨機選一個走廊格當「門的走廊端」
    const cx = randomInt(1, width - 2);
    const cy = randomInt(1, height - 2);
    if (grid[cy][cx] !== TILE_TYPES.FLOOR) continue;

    const dir = dirs[randomInt(0, dirs.length - 1)];
    const doorX = cx + dir.dx;
    const doorY = cy + dir.dy;

    // 門的位置必須是牆
    if (!inBounds(doorX, doorY, width, height)) continue;
    if (grid[doorY][doorX] !== TILE_TYPES.WALL) continue;

    // 決定房間大小
    const roomW = randomInt(minRoomSize, maxRoomSize);
    const roomH = randomInt(minRoomSize, maxRoomSize - 1);

    // 根據方向決定房間左上角
    let x, y;
    if (dir.dx === 1) {          // 往右長
      x = doorX + 1;
      y = doorY - Math.floor(roomH / 2);
    } else if (dir.dx === -1) {  // 往左長
      x = doorX - roomW;
      y = doorY - Math.floor(roomH / 2);
    } else if (dir.dy === 1) {   // 往下長
      x = doorX - Math.floor(roomW / 2);
      y = doorY + 1;
    } else {                     // 往上長
      x = doorX - Math.floor(roomW / 2);
      y = doorY - roomH;
    }

    if (!canPlaceRoom(grid, x, y, roomW, roomH, {
      padding: 2,
      maxExistingFloorRatio: 0.75 // allow significant overlap with thin DFS corridors
    })) continue;

    // carve 房間內部
    const tiles = [];
    for (let j = 0; j < roomH; j++) {
      for (let i = 0; i < roomW; i++) {
        const gx = x + i;
        const gy = y + j;
        grid[gy][gx] = TILE_TYPES.FLOOR;
        tiles.push({ x: gx, y: gy });
      }
    }

    // 門設為 DOOR
    grid[doorY][doorX] = TILE_TYPES.DOOR;

    const roomType = pickRoomType();
    const room = {
      type: roomType,
      x,
      y,
      width: roomW,
      height: roomH,
      tiles,
      doors: [{ x: doorX, y: doorY }],
      corridor: { x: cx, y: cy }
    };

    tryAddExtraDoors(grid, room, minDoors);
    rooms.push(room);
  }

  console.log(`🧱 Carved ${rooms.length} rooms`);
  return rooms;
}



function inBounds(x, y, width, height) {
  return x > 0 && y > 0 && x < width - 1 && y < height - 1;
}

/**
 * 房間區域必須完全是牆（避免吃掉既有走廊 / 房間）
 */
function canPlaceRoom(grid, x, y, w, h, options = {}) {
  const height = grid.length;
  const width = grid[0].length;

  const padding = options.padding ?? 1; // leave at least 1 tile of wall around rooms
  const maxExistingFloorRatio = options.maxExistingFloorRatio ?? 0.35; // allow small overlap with corridors

  // Keep a safety margin from outer walls
  if (x < padding || y < padding) return false;
  if (x + w >= width - padding || y + h >= height - padding) return false;

  if (!inBounds(x, y, width, height)) return false;
  if (!inBounds(x + w - 1, y + h - 1, width, height)) return false;

  let existingNonWall = 0;

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const gx = x + i;
      const gy = y + j;

      // Avoid carving through doors (keeps corridors distinct)
      if (grid[gy][gx] === TILE_TYPES.DOOR) {
        return false;
      }

      // Allow carving through some corridors/walkable tiles so rooms can grow out of thin mazes
      if (grid[gy][gx] !== TILE_TYPES.WALL) {
        existingNonWall++;
      }
    }
  }

  const area = w * h;
  const floorRatio = existingNonWall / area;
  return floorRatio <= maxExistingFloorRatio;
}

/**
 * 給房間多開幾個門，減少「單門房」造成的走廊死路感
 */
function tryAddExtraDoors(grid, room, minDoors = 2) {
  if (!room || minDoors <= 1) return;
  const width = grid[0].length;
  const height = grid.length;

  const perimeterTiles = room.tiles.filter(t =>
    t.x === room.x ||
    t.x === room.x + room.width - 1 ||
    t.y === room.y ||
    t.y === room.y + room.height - 1
  );

  const existingDoorKeys = new Set(room.doors.map(d => `${d.x},${d.y}`));

  for (const tile of perimeterTiles) {
    if (room.doors.length >= minDoors) break;

    const neighbors = [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 }
    ];

    for (const n of neighbors) {
      if (n.x <= 0 || n.y <= 0 || n.x >= width - 1 || n.y >= height - 1) continue;
      if (grid[n.y][n.x] !== TILE_TYPES.FLOOR) continue; // 只連走廊

      const key = `${tile.x},${tile.y}`;
      if (existingDoorKeys.has(key)) continue;

      grid[tile.y][tile.x] = TILE_TYPES.DOOR;
      room.doors.push({ x: tile.x, y: tile.y });
      existingDoorKeys.add(key);
      break;
    }
  }
}

/**
 * 隨機選一種房間類型
 */
function pickRoomType() {
  const types = [
    ROOM_TYPES.CLASSROOM,
    ROOM_TYPES.OFFICE,
    ROOM_TYPES.BATHROOM,
    ROOM_TYPES.STORAGE,
    ROOM_TYPES.LIBRARY,
    ROOM_TYPES.POOL,
    ROOM_TYPES.GYM,
    ROOM_TYPES.BEDROOM,
  ];
  return types[randomInt(0, types.length - 1)];
}

/**
 * 把 rooms 陣列轉成 roomMap[y][x] = ROOM_TYPES.*
 */
export function createRoomMapFromRooms(grid, rooms) {
  const height = grid.length;
  const width = grid[0].length;

  const roomMap = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ROOM_TYPES.CORRIDOR)
  );

  for (const room of rooms) {
    for (const tile of room.tiles) {
      roomMap[tile.y][tile.x] = room.type;
    }
    for (const door of room.doors || []) {
      // 門也標成該房間類型，方便 minimap / 材質切換
      roomMap[door.y][door.x] = room.type;
    }
  }

  return roomMap;
} 


/**
 * Analyze maze statistics (for debugging)
 * @param {Array<Array<number>>} grid - The maze grid
 * @returns {Object} Statistics about the maze
 */
export function analyzeMaze(grid) {
  const height = grid.length;
  const width = grid[0].length;

  let floorCount = 0;
  let wallCount = 0;
  let deadEnds = 0;

  function isWalkable(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return grid[y][x] !== TILE_TYPES.WALL;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === TILE_TYPES.WALL) {
        wallCount++;
      } else {
        floorCount++;
        const neighbors =
          (isWalkable(x + 1, y) ? 1 : 0) +
          (isWalkable(x - 1, y) ? 1 : 0) +
          (isWalkable(x, y + 1) ? 1 : 0) +
          (isWalkable(x, y - 1) ? 1 : 0);

        if (neighbors === 1) deadEnds++;
      }
    }
  }

  return {
    width,
    height,
    floorCount,
    wallCount,
    deadEnds,
  };
}

/**
 * 打掉迷宮死路：找到只有單一出口的走廊，強制再挖一個方向
 */
function removeDeadEnds(grid, passes = 2) {
  const height = grid.length;
  const width = grid[0].length;
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];

  for (let p = 0; p < passes; p++) {
    let changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] === TILE_TYPES.WALL) continue;

        let neighbors = 0;
        const wallCandidates = [];
        for (const d of dirs) {
          const nx = x + d.dx;
          const ny = y + d.dy;
          if (grid[ny][nx] === TILE_TYPES.WALL) {
            wallCandidates.push({ x: nx, y: ny });
          } else {
            neighbors++;
          }
        }

        if (neighbors <= 1 && wallCandidates.length > 0) {
          const pick = wallCandidates[randomInt(0, wallCandidates.length - 1)];
          grid[pick.y][pick.x] = TILE_TYPES.FLOOR;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}
