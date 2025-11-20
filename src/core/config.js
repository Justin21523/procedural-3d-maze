/**
 * Global game configuration
 * All game parameters are centralized here for easy tuning
 */

export const CONFIG = {
  // Maze settings (larger map for more rooms)
  MAZE_WIDTH: 50,        // Increased to 50 for more rooms
  MAZE_HEIGHT: 50,       // Increased to 50 for more rooms
  TILE_SIZE: 2,          // Size of each grid cell in world units
  WALL_HEIGHT: 3,        // Height of walls

  // Player settings
  PLAYER_SPEED: 4,       // Movement speed (units per second)
  PLAYER_HEIGHT: 1.6,    // Camera height (eye level)
  PLAYER_RADIUS: 0.4,    // Collision radius (increased for better collision)
  MOUSE_SENSITIVITY: 0.002,

  // Monster settings
  MONSTER_COUNT: 8,              // Number of monsters to spawn (increased for variety)
  MONSTER_SPEED: 9,              // Base monster movement speed (VERY FAST continuous exploration)
  MONSTER_VISION_RANGE: 15,      // Base vision range (varies by type)
  MONSTER_FOV: Math.PI * 2 / 3,  // Base field of view (120 degrees)
  MONSTER_MODEL: 'models/VascodaGama.dae', // Default monster model (can be changed in UI)

  // Rendering settings
  FOV: 75,               // Field of view in degrees
  NEAR_PLANE: 0.1,
  FAR_PLANE: 1000,
  TARGET_FPS: 60,        // Target frames per second

  // Debug settings
  DEBUG_MODE: false,     // Enable debug visualizations
  SHOW_FPS: true,
};
