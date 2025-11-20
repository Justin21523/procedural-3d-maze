/**
 * Simple test script to verify maze generation
 */

import { generateMazeDFS, analyzeMaze } from './src/world/mapGenerator.js';
import { TILE_TYPES } from './src/world/tileTypes.js';

console.log('Testing maze generation...\n');

// Generate a test maze
const width = 21;
const height = 21;
const grid = generateMazeDFS(width, height);

// Analyze the maze
const stats = analyzeMaze(grid);
console.log('Maze Statistics:');
console.log(`  Size: ${stats.width}×${stats.height}`);
console.log(`  Total tiles: ${stats.total}`);
console.log(`  Floor tiles: ${stats.floorCount}`);
console.log(`  Wall tiles: ${stats.wallCount}`);
console.log(`  Floor percentage: ${stats.floorPercentage}`);

// Print a small ASCII visualization
console.log('\nASCII Visualization (top-left 15x15):');
for (let y = 0; y < Math.min(15, height); y++) {
  let row = '';
  for (let x = 0; x < Math.min(15, width); x++) {
    row += grid[y][x] === TILE_TYPES.FLOOR ? '  ' : '██';
  }
  console.log(row);
}

console.log('\n✅ Maze generation test complete!');
