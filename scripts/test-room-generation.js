/**
 * Test script for room-based map generation
 * Verifies that large rooms are being created instead of narrow corridors
 */

import { generateMazeDFS, analyzeMaze, createRoomMapFromRooms } from '../src/world/mapGenerator.js';
import { TILE_TYPES, ROOM_TYPES } from '../src/world/tileTypes.js';

console.log('=== Testing Room-Based Map Generation ===\n');

// Generate a test map
const width = 50;
const height = 50;
const result = generateMazeDFS(width, height);
const grid = result.grid;
const rooms = result.rooms;

// Analyze the map
const stats = analyzeMaze(grid);
console.log('\n=== Map Statistics ===');
console.log(`Dimensions: ${stats.width}×${stats.height}`);
console.log(`Total tiles: ${stats.total}`);
console.log(`Floor tiles: ${stats.floorCount} (${stats.floorPercentage})`);
console.log(`Wall tiles: ${stats.wallCount}`);

// Find contiguous floor regions (rooms)
console.log('\n=== Analyzing Room Spaces ===');

function findLargestRectangle(grid) {
  const rooms = [];
  const visited = Array(grid.length).fill(null).map(() =>
    Array(grid[0].length).fill(false)
  );

  // Find all floor regions
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid[0].length - 1; x++) {
      if (grid[y][x] === TILE_TYPES.FLOOR && !visited[y][x]) {
        // Found unvisited floor, measure the region
        const region = measureRegion(grid, x, y, visited);
        if (region.width >= 5 && region.height >= 5) {
          rooms.push(region);
        }
      }
    }
  }

  return rooms;
}

function measureRegion(grid, startX, startY, visited) {
  // Simple BFS to find rectangular regions
  let minX = startX, maxX = startX;
  let minY = startY, maxY = startY;
  const queue = [{x: startX, y: startY}];
  visited[startY][startX] = true;
  let tileCount = 0;

  while (queue.length > 0) {
    const {x, y} = queue.shift();
    tileCount++;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Check 4 neighbors
    const neighbors = [
      {x: x + 1, y},
      {x: x - 1, y},
      {x, y: y + 1},
      {x, y: y - 1}
    ];

    for (const n of neighbors) {
      if (n.x >= 0 && n.x < grid[0].length &&
          n.y >= 0 && n.y < grid.length &&
          grid[n.y][n.x] === TILE_TYPES.FLOOR &&
          !visited[n.y][n.x]) {
        visited[n.y][n.x] = true;
        queue.push(n);
      }
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    tiles: tileCount
  };
}

const largeRooms = findLargestRectangle(grid);
console.log(`Found ${largeRooms.length} large regions (≥5×5):\n`);

largeRooms.sort((a, b) => b.tiles - a.tiles);
largeRooms.slice(0, 10).forEach((room, i) => {
  console.log(`${i + 1}. Position: (${room.x}, ${room.y}), Size: ${room.width}×${room.height}, Tiles: ${room.tiles}`);
});

// Create room map
const roomMap = createRoomMapFromRooms(grid, rooms);

// Visualize a small section of the map
console.log('\n=== Map Visualization (Top-Left 20×20) ===');
console.log('█ = Wall, · = Floor\n');

for (let y = 0; y < Math.min(20, height); y++) {
  let row = '';
  for (let x = 0; x < Math.min(20, width); x++) {
    row += grid[y][x] === TILE_TYPES.WALL ? '█' : '·';
  }
  console.log(row);
}

// Visualize room types
console.log('\n=== Room Type Visualization (Top-Left 20×20) ===');
console.log('█ = Wall, C = Corridor, L = Library, O = Office, R = Classroom, B = Bathroom, S = Storage\n');

const roomChars = {
  [ROOM_TYPES.CORRIDOR]: 'C',
  [ROOM_TYPES.CLASSROOM]: 'R',
  [ROOM_TYPES.OFFICE]: 'O',
  [ROOM_TYPES.BATHROOM]: 'B',
  [ROOM_TYPES.STORAGE]: 'S',
  [ROOM_TYPES.LIBRARY]: 'L',
};

for (let y = 0; y < Math.min(20, height); y++) {
  let row = '';
  for (let x = 0; x < Math.min(20, width); x++) {
    if (grid[y][x] === TILE_TYPES.WALL) {
      row += '█';
    } else {
      row += roomChars[roomMap[y][x]] || '?';
    }
  }
  console.log(row);
}

// Validation
console.log('\n=== Validation ===');
if (largeRooms.length >= 5) {
  console.log('✅ PASS: Found multiple large room spaces');
} else {
  console.log('❌ FAIL: Not enough large room spaces found');
}

if (stats.floorPercentage.replace('%', '') > 20) {
  console.log('✅ PASS: Sufficient open space');
} else {
  console.log('❌ FAIL: Not enough open space');
}

const avgRoomSize = largeRooms.length > 0
  ? largeRooms.reduce((sum, r) => sum + r.tiles, 0) / largeRooms.length
  : 0;
console.log(`Average room size: ${avgRoomSize.toFixed(1)} tiles`);

if (avgRoomSize > 50) {
  console.log('✅ PASS: Rooms are large enough');
} else {
  console.log('❌ FAIL: Rooms are too small (maze-like corridors)');
}
