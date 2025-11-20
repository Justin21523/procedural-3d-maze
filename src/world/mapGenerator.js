/**
 * Maze generation algorithms
 * Implements DFS-based maze generation for procedural level creation
 */

import { TILE_TYPES, ROOM_TYPES } from './tileTypes.js';

/**
 * Generate a room-based map with large open spaces
 * Creates distinct rooms connected by corridors
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Object} options - Generation options
 * @returns {Object} Object containing grid and rooms array
 */
export function generateMazeDFS(width, height, options = {}) {
  console.log(`Generating room-based map: ${width}×${height}...`);

  // Initialize grid with all walls
  const grid = Array(height).fill(null).map(() =>
    Array(width).fill(TILE_TYPES.WALL)
  );

  // Generate rooms and corridors directly
  const rooms = generateRooms(width, height);

  // Place rooms in the grid
  rooms.forEach(room => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          grid[y][x] = TILE_TYPES.FLOOR;
        }
      }
    }
  });

  // Connect rooms with corridors
  connectRooms(grid, rooms, width, height);

  console.log(`Generated ${rooms.length} rooms`);

  // Return both grid and room information
  return { grid, rooms };
}

/**
 * Generate room layouts
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @returns {Array} Array of room objects
 */
function generateRooms(width, height) {
  const rooms = [];
  const numRooms = Math.floor(Math.random() * 3) + 8; // 8-10 rooms

  // Define room types
  const roomTypes = [
    ROOM_TYPES.CLASSROOM,
    ROOM_TYPES.OFFICE,
    ROOM_TYPES.BATHROOM,
    ROOM_TYPES.STORAGE,
    ROOM_TYPES.LIBRARY,
  ];

  for (let i = 0; i < numRooms; i++) {
    let attempts = 0;
    let room = null;

    // Try to place room without overlap
    while (attempts < 100) {
      const roomWidth = Math.floor(Math.random() * 5) + 6;  // 6-10 tiles
      const roomHeight = Math.floor(Math.random() * 5) + 6; // 6-10 tiles
      const x = Math.floor(Math.random() * (width - roomWidth - 4)) + 2;
      const y = Math.floor(Math.random() * (height - roomHeight - 4)) + 2;

      const newRoom = {
        x,
        y,
        width: roomWidth,
        height: roomHeight,
        type: roomTypes[Math.floor(Math.random() * roomTypes.length)],
        centerX: x + Math.floor(roomWidth / 2),
        centerY: y + Math.floor(roomHeight / 2),
      };

      // Check for overlap with existing rooms
      let overlaps = false;
      for (const existingRoom of rooms) {
        if (roomsOverlap(newRoom, existingRoom)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        room = newRoom;
        break;
      }

      attempts++;
    }

    if (room) {
      rooms.push(room);
    }
  }

  return rooms;
}

/**
 * Check if two rooms overlap (with padding)
 */
function roomsOverlap(room1, room2) {
  const padding = 2; // Space between rooms (reduced to fit more rooms)
  return !(
    room1.x + room1.width + padding < room2.x ||
    room2.x + room2.width + padding < room1.x ||
    room1.y + room1.height + padding < room2.y ||
    room2.y + room2.height + padding < room1.y
  );
}

/**
 * Connect rooms with corridors
 */
function connectRooms(grid, rooms, width, height) {
  // Connect each room to the next one
  for (let i = 0; i < rooms.length - 1; i++) {
    const room1 = rooms[i];
    const room2 = rooms[i + 1];

    createCorridor(grid, room1.centerX, room1.centerY, room2.centerX, room2.centerY, width, height);
  }

  // Also connect first and last room for better connectivity
  if (rooms.length > 2) {
    const first = rooms[0];
    const last = rooms[rooms.length - 1];
    createCorridor(grid, first.centerX, first.centerY, last.centerX, last.centerY, width, height);
  }

  // Add some extra connections for variety
  for (let i = 0; i < Math.floor(rooms.length / 2); i++) {
    const r1 = rooms[Math.floor(Math.random() * rooms.length)];
    const r2 = rooms[Math.floor(Math.random() * rooms.length)];
    if (r1 !== r2) {
      createCorridor(grid, r1.centerX, r1.centerY, r2.centerX, r2.centerY, width, height);
    }
  }
}

/**
 * Create an L-shaped corridor between two points
 */
function createCorridor(grid, x1, y1, x2, y2, width, height) {
  const corridorWidth = 1; // 1 tile wide for narrow corridors

  // Horizontal corridor
  const startX = Math.min(x1, x2);
  const endX = Math.max(x1, x2);
  for (let x = startX; x <= endX; x++) {
    for (let dy = 0; dy < corridorWidth; dy++) {
      const y = y1 + dy;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        grid[y][x] = TILE_TYPES.FLOOR;
      }
    }
  }

  // Vertical corridor
  const startY = Math.min(y1, y2);
  const endY = Math.max(y1, y2);
  for (let y = startY; y <= endY; y++) {
    for (let dx = 0; dx < corridorWidth; dx++) {
      const x = x2 + dx;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        grid[y][x] = TILE_TYPES.FLOOR;
      }
    }
  }
}

/**
 * Recursively carve paths through the maze using DFS
 * @param {Array<Array<number>>} grid - The maze grid
 * @param {number} x - Current X coordinate
 * @param {number} y - Current Y coordinate
 * @param {number} width - Maze width
 * @param {number} height - Maze height
 */
function carvePath(grid, x, y, width, height) {
  // Mark current cell as floor
  grid[y][x] = TILE_TYPES.FLOOR;

  // Define four directions (North, East, South, West)
  // Move by 2 to maintain wall-path-wall pattern
  const directions = [
    { dx: 0, dy: -2, wallX: 0, wallY: -1 },  // North
    { dx: 2, dy: 0, wallX: 1, wallY: 0 },    // East
    { dx: 0, dy: 2, wallX: 0, wallY: 1 },    // South
    { dx: -2, dy: 0, wallX: -1, wallY: 0 },  // West
  ];

  // Shuffle directions for randomness
  shuffleArray(directions);

  // Try each direction
  for (const dir of directions) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;

    // Check if neighbor is within bounds and unvisited
    if (isInBounds(nx, ny, width, height) && grid[ny][nx] === TILE_TYPES.WALL) {
      // Carve wall between current cell and neighbor
      const wallX = x + dir.wallX;
      const wallY = y + dir.wallY;
      grid[wallY][wallX] = TILE_TYPES.FLOOR;

      // Recursively visit neighbor
      carvePath(grid, nx, ny, width, height);
    }
  }
}

/**
 * Check if coordinates are within grid bounds
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @returns {boolean} True if in bounds
 */
function isInBounds(x, y, width, height) {
  return x > 0 && x < width - 1 && y > 0 && y < height - 1;
}

/**
 * Shuffle an array in place (Fisher-Yates algorithm)
 * @param {Array} array - Array to shuffle
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

/**
 * Generate a simple test maze (for debugging)
 * Creates a small hardcoded maze
 * @returns {Array<Array<number>>} 2D grid array
 */
export function generateTestMaze() {
  return [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ];
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === TILE_TYPES.FLOOR) {
        floorCount++;
      } else {
        wallCount++;
      }
    }
  }

  const total = width * height;
  const floorPercentage = (floorCount / total * 100).toFixed(1);

  return {
    width,
    height,
    total,
    floorCount,
    wallCount,
    floorPercentage: `${floorPercentage}%`,
  };
}

/**
 * Create room map from room objects
 * @param {Array<Array<number>>} grid - The maze grid
 * @param {Array} rooms - Array of room objects
 * @returns {Array<Array<number>>} 2D array of room types
 */
export function createRoomMapFromRooms(grid, rooms) {
  const height = grid.length;
  const width = grid[0].length;

  // Initialize room map with CORRIDOR (default for all floor tiles)
  const roomMap = Array(height).fill(null).map(() =>
    Array(width).fill(ROOM_TYPES.CORRIDOR)
  );

  // Assign room types based on actual room positions
  rooms.forEach(room => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height && grid[y][x] === TILE_TYPES.FLOOR) {
          roomMap[y][x] = room.type;
        }
      }
    }
  });

  // Log room distribution
  const roomCounts = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === TILE_TYPES.FLOOR) {
        const type = roomMap[y][x];
        roomCounts[type] = (roomCounts[type] || 0) + 1;
      }
    }
  }

  console.log('Room distribution:', roomCounts);
  console.log('Room details:', rooms.map(r => ({
    type: Object.keys(ROOM_TYPES).find(key => ROOM_TYPES[key] === r.type),
    size: `${r.width}×${r.height}`,
    position: `(${r.x}, ${r.y})`
  })));

  return roomMap;
}

/**
 * Generate a room-based map with large open spaces (DEPRECATED - use createRoomMapFromRooms)
 * Creates distinct rooms connected by corridors
 * @param {Array<Array<number>>} grid - The maze grid
 * @returns {Array<Array<number>>} 2D array of room types
 */
export function generateRoomMap(grid) {
  const height = grid.length;
  const width = grid[0].length;

  // Initialize room map with CORRIDOR (default)
  const roomMap = Array(height).fill(null).map(() =>
    Array(width).fill(ROOM_TYPES.CORRIDOR)
  );

  // Define room types to use (excluding corridor which is default)
  const availableRoomTypes = [
    ROOM_TYPES.CLASSROOM,
    ROOM_TYPES.OFFICE,
    ROOM_TYPES.BATHROOM,
    ROOM_TYPES.STORAGE,
    ROOM_TYPES.LIBRARY,
  ];

  // Create larger rectangular rooms by clearing walls
  const numRooms = Math.floor(Math.random() * 4) + 6; // 6-9 rooms
  const createdRooms = [];

  for (let i = 0; i < numRooms; i++) {
    // Larger room size (8-15 tiles)
    const roomWidth = Math.floor(Math.random() * 8) + 8;
    const roomHeight = Math.floor(Math.random() * 8) + 8;

    // Random position with more spacing
    const startX = Math.floor(Math.random() * (width - roomWidth - 4)) + 2;
    const startY = Math.floor(Math.random() * (height - roomHeight - 4)) + 2;

    // Random room type
    const roomType = availableRoomTypes[Math.floor(Math.random() * availableRoomTypes.length)];

    // Clear the room area - make it all walkable floor
    for (let y = startY; y < startY + roomHeight && y < height - 1; y++) {
      for (let x = startX; x < startX + roomWidth && x < width - 1; x++) {
        grid[y][x] = TILE_TYPES.FLOOR; // Clear walls to create open space
        roomMap[y][x] = roomType;
      }
    }

    createdRooms.push({
      type: roomType,
      x: startX,
      y: startY,
      width: roomWidth,
      height: roomHeight
    });
  }

  // Create corridors connecting rooms
  for (let i = 0; i < createdRooms.length - 1; i++) {
    const room1 = createdRooms[i];
    const room2 = createdRooms[i + 1];

    // Center of each room
    const x1 = Math.floor(room1.x + room1.width / 2);
    const y1 = Math.floor(room1.y + room1.height / 2);
    const x2 = Math.floor(room2.x + room2.width / 2);
    const y2 = Math.floor(room2.y + room2.height / 2);

    // Create L-shaped corridor
    // Horizontal corridor
    const startX = Math.min(x1, x2);
    const endX = Math.max(x1, x2);
    for (let x = startX; x <= endX; x++) {
      if (y1 >= 0 && y1 < height) {
        grid[y1][x] = TILE_TYPES.FLOOR;
        if (x >= 0 && x < width - 1 && y1 < height - 1) {
          grid[y1 + 1][x] = TILE_TYPES.FLOOR; // Make corridor 2 tiles wide
        }
      }
    }

    // Vertical corridor
    const startY = Math.min(y1, y2);
    const endY = Math.max(y1, y2);
    for (let y = startY; y <= endY; y++) {
      if (x2 >= 0 && x2 < width && y < height) {
        grid[y][x2] = TILE_TYPES.FLOOR;
        if (x2 < width - 1 && y < height) {
          grid[y][x2 + 1] = TILE_TYPES.FLOOR; // Make corridor 2 tiles wide
        }
      }
    }
  }

  // Log room distribution
  const roomCounts = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const type = roomMap[y][x];
      roomCounts[type] = (roomCounts[type] || 0) + 1;
    }
  }

  console.log('Room distribution:', roomCounts);
  console.log('Created rooms:', createdRooms.map(r => ({
    type: Object.keys(ROOM_TYPES).find(key => ROOM_TYPES[key] === r.type),
    size: `${r.width}x${r.height}`
  })));

  return roomMap;
}
