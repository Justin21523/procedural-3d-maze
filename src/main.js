/**
 * Main entry point for the game
 * Initializes all systems and starts the game
 */

import * as THREE from 'three';
import { CONFIG } from './core/config.js';
import { GameLoop } from './core/gameLoop.js';
import { GameState } from './core/gameState.js';
import { SceneManager } from './rendering/scene.js';
import { FirstPersonCamera } from './rendering/camera.js';
import { Minimap } from './rendering/minimap.js';
import { WorldState } from './world/worldState.js';
import { InputHandler } from './player/input.js';
import { PlayerController } from './player/playerController.js';
import { MonsterManager } from './entities/monsterManager.js';
import { ExitPoint } from './world/exitPoint.js';
import { AudioManager } from './audio/audioManager.js';

/**
 * Initialize and start the game
 */
function initGame() {
  console.log('='.repeat(80));
  console.log('🎮 GAME INITIALIZATION STARTED');
  console.log('📦 VERSION: 2.0.2 - Debug Version');
  console.log('='.repeat(80));

  // Get container elements
  const container = document.getElementById('canvas-container');
  const instructionsOverlay = document.getElementById('instructions');
  const startButton = document.getElementById('start-button');
  const minimapCanvas = document.getElementById('minimap');

  // Debug: Check if elements exist
  console.log('DOM Elements check:');
  console.log('  canvas-container:', container ? '✓' : '✗');
  console.log('  instructions:', instructionsOverlay ? '✓' : '✗');
  console.log('  start-button:', startButton ? '✓' : '✗');
  console.log('  minimap canvas:', minimapCanvas ? '✓' : '✗');
  if (minimapCanvas) {
    console.log(`  minimap size: ${minimapCanvas.width}x${minimapCanvas.height}`);
  }

  // Create world state
  const worldState = new WorldState();
  worldState.initialize();
  console.log('World initialized with procedurally generated maze');

  // Create scene manager
  const sceneManager = new SceneManager(container);
  const lights = sceneManager.getLights();
  sceneManager.buildWorldFromGrid(worldState);
  console.log('Scene built from world state');

  // Create camera
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new FirstPersonCamera(aspect);
  sceneManager.setCamera(camera);
  console.log('Camera created');

  // Create audio manager (requires camera for AudioListener)
  const audioManager = new AudioManager(camera.getCamera());
  console.log('🔊 Audio manager created');

  // Pre-load audio files (optional, gracefully fails if files missing)
  audioManager.setupAmbient('/audio/ambient.mp3').catch(() => {
    console.log('⚠️ Ambient sound not available (optional)');
  });

  // Create minimap
  console.log('Creating minimap with canvas:', minimapCanvas);
  const minimap = new Minimap(minimapCanvas, worldState);
  console.log('Minimap created');

  // Create input handler
  const input = new InputHandler();
  console.log('Input handler created');

  // Create game state manager
  const gameState = new GameState();
  console.log('🎮 Game state created');

  // Create player controller (with gameState and audioManager)
  const player = new PlayerController(worldState, camera, input, gameState, audioManager);
  console.log('Player spawned at:', player.getGridPosition());

  // Create exit point at a far location from spawn
  const exitGridPos = worldState.getExitPoint();
  const exitPoint = new ExitPoint(exitGridPos);
  sceneManager.getScene().add(exitPoint.getMesh());
  console.log('🚪 Exit point created at grid:', exitGridPos);

  // Create monster manager
  const monsterManager = new MonsterManager(sceneManager.getScene(), worldState);
  console.log('👹 Monster manager created');

  // Load monsters with mixed types
  console.log('🎮 Loading monsters with mixed types...');
  const MONSTER_COUNT = CONFIG.MONSTER_COUNT;
  console.log(`📊 Spawning ${MONSTER_COUNT} monsters`);

  // Initialize monsters with mixed types (Hunter, Wanderer, Sentinel, etc.)
  monsterManager.initialize(MONSTER_COUNT)
    .then(() => {
      console.log(`✅ ${MONSTER_COUNT} monsters initialized successfully!`);
      console.log(`   Monster manager has ${monsterManager.getMonsters().length} monsters`);
    })
    .catch(err => {
      console.error('❌ Failed to initialize monsters:', err);
      console.error('   Error details:', err.message);
    });

  // Create game loop with all systems
  const gameLoop = new GameLoop(sceneManager, player, minimap, monsterManager, lights, worldState, gameState, exitPoint);

  // Render initial minimap (before game starts)
  console.log('🗺️ Rendering initial minimap...');
  minimap.render(
    player.getGridPosition(),
    monsterManager.getMonsterPositions(),
    exitGridPos
  );
  console.log('✅ Initial minimap rendered');

  // Setup minimap click to teleport
  minimapCanvas.addEventListener('click', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Convert canvas coordinates to grid coordinates
    const gridX = Math.floor((canvasX - minimap.offsetX) / minimap.tileSize);
    const gridY = Math.floor((canvasY - minimap.offsetY) / minimap.tileSize);

    // Check if the position is walkable
    if (worldState.isWalkable(gridX, gridY)) {
      const worldX = gridX * CONFIG.TILE_SIZE;
      const worldZ = gridY * CONFIG.TILE_SIZE;
      player.setPosition(worldX, CONFIG.PLAYER_HEIGHT, worldZ);
      console.log(`🎯 Teleported to grid (${gridX}, ${gridY}), world (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
    } else {
      console.log(`❌ Cannot teleport to (${gridX}, ${gridY}) - not walkable`);
    }
  });

  // Click canvas to re-lock pointer (when panels are closed)
  container.addEventListener('click', () => {
    const instructions = document.getElementById('instructions');
    const debugPanel = document.getElementById('debug-panel');
    const settingsPanel = document.getElementById('settings-panel');

    // Only lock if game is running and no panels are open
    if (instructions.classList.contains('hidden') &&
        debugPanel.style.display !== 'block' &&
        settingsPanel.classList.contains('hidden')) {
      input.requestPointerLock();
      console.log('🖱️ Click detected, requesting pointer lock');
    }
  });

  // Setup start button
  startButton.addEventListener('click', () => {
    console.log('🎮 Start button clicked!');

    // Hide instructions
    instructionsOverlay.classList.add('hidden');

    // Show settings toggle button
    document.getElementById('toggle-settings').classList.remove('hidden');

    // Start ambient audio (user interaction required for Web Audio API)
    audioManager.playAmbient();
    console.log('🔊 Ambient audio started');

    // Start game loop FIRST (important!)
    console.log('🎬 Starting game loop...');
    gameLoop.start();

    // Request pointer lock AFTER game loop starts
    console.log('🔒 Requesting pointer lock...');
    setTimeout(() => {
      input.requestPointerLock();
    }, 100);

    console.log('✅ Game initialization complete!');
  });

  // Handle ESC key to show instructions again
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      input.exitPointerLock();
      instructionsOverlay.classList.remove('hidden');
      console.log('Game paused - Press start to continue');
    }
  });

  // Setup game over screen buttons
  const restartButton = document.getElementById('restart-button');
  const menuButton = document.getElementById('menu-button');

  restartButton.addEventListener('click', () => {
    console.log('🔄 Restarting game...');

    // Hide game over screen
    document.getElementById('game-over').classList.add('hidden');

    // Stop game loop
    gameLoop.stop();

    // Regenerate world
    worldState.initialize();

    // Rebuild scene
    sceneManager.buildWorldFromGrid(worldState);

    // Create new exit point
    const newExitPos = worldState.getExitPoint();
    sceneManager.getScene().remove(exitPoint.getMesh());
    const newExitPoint = new ExitPoint(newExitPos);
    sceneManager.getScene().add(newExitPoint.getMesh());
    gameLoop.exitPoint = newExitPoint;

    // Reset player position
    const spawnPoint = worldState.getSpawnPoint();
    player.setPosition(spawnPoint.x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, spawnPoint.y * CONFIG.TILE_SIZE);

    // Reset game state
    gameState.reset();

    // Update minimap
    minimap.updateScale();
    minimap.render(player.getGridPosition(), monsterManager.getMonsterPositions());

    // Restart game loop
    gameLoop.start();
    gameState.startTimer();

    console.log('✅ Game restarted!');
  });

  menuButton.addEventListener('click', () => {
    console.log('📋 Returning to menu...');

    // Hide game over screen
    document.getElementById('game-over').classList.add('hidden');

    // Show instructions
    instructionsOverlay.classList.remove('hidden');

    // Stop game loop
    gameLoop.stop();

    // Reset game state
    gameState.reset();

    console.log('✅ Returned to menu');
  });

  // Setup settings panel
  setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap);

  // Setup debug panel
  setupDebugPanel(worldState, player, gameState, gameLoop, exitPoint, monsterManager, sceneManager);

  // Log success
  console.log('='.repeat(50));
  console.log('Initialization complete!');
  console.log('Click "Click to Start" to begin');
  console.log('='.repeat(50));
  console.log('Controls:');
  console.log('  WASD - Move');
  console.log('  Mouse - Look around');
  console.log('  Shift - Sprint');
  console.log('  ESC - Pause / Release mouse');
  console.log('  Tab - Toggle Settings');
  console.log('='.repeat(50));
}

/**
 * Setup settings panel controls
 */
function setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap) {
  const toggleButton = document.getElementById('toggle-settings');
  const settingsPanel = document.getElementById('settings-panel');

  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');

  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');

  const fovSlider = document.getElementById('fov-slider');
  const fovValue = document.getElementById('fov-value');

  const fogSlider = document.getElementById('fog-slider');
  const fogValue = document.getElementById('fog-value');

  const regenerateButton = document.getElementById('regenerate-map');

  let settingsVisible = false;

  // Toggle settings panel
  function toggleSettings() {
    settingsVisible = !settingsVisible;
    if (settingsVisible) {
      settingsPanel.classList.remove('hidden');
      toggleButton.classList.add('hidden');
      // Release pointer lock when opening panel
      input.exitPointerLock();
      console.log('⚙️ Settings panel opened, mouse unlocked');
    } else {
      settingsPanel.classList.add('hidden');
      toggleButton.classList.remove('hidden');
    }
  }

  // Show toggle button after game starts
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      const instructions = document.getElementById('instructions');
      // Only toggle if game has started (instructions hidden)
      if (instructions.classList.contains('hidden')) {
        toggleSettings();
      }
    }
  });

  // Click toggle button
  toggleButton.addEventListener('click', toggleSettings);

  // Speed slider
  speedSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    speedValue.textContent = value.toFixed(1);
    CONFIG.PLAYER_SPEED = value;
  });

  // Sensitivity slider
  sensitivitySlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    sensitivityValue.textContent = value.toFixed(4);
    CONFIG.MOUSE_SENSITIVITY = value;
  });

  // FOV slider
  fovSlider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    fovValue.textContent = value;
    CONFIG.FOV = value;
    camera.getCamera().fov = value;
    camera.getCamera().updateProjectionMatrix();
  });

  // Fog slider
  fogSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    fogValue.textContent = value.toFixed(2);
    sceneManager.getScene().fog.density = value;
  });

  // Regenerate map button
  regenerateButton.addEventListener('click', () => {
    console.log('🔄 Regenerating map...');

    // Stop game loop
    gameLoop.stop();

    // Regenerate world
    worldState.initialize();

    // Rebuild scene
    sceneManager.buildWorldFromGrid(worldState);

    // Reset player position
    const spawnPoint = worldState.getSpawnPoint();
    const worldSpawn = {
      x: spawnPoint.x * CONFIG.TILE_SIZE,
      z: spawnPoint.y * CONFIG.TILE_SIZE
    };
    player.setPosition(worldSpawn.x, CONFIG.PLAYER_HEIGHT, worldSpawn.z);

    // Update minimap
    minimap.updateScale();
    minimap.render(player.getGridPosition(), []);

    // Restart game loop
    gameLoop.start();

    console.log('✅ Map regenerated!');
  });
}

/**
 * Setup debug/cheat panel controls
 */
function setupDebugPanel(worldState, player, gameState, gameLoop, exitPoint, monsterManager, sceneManager) {
  const toggleButton = document.getElementById('toggle-debug');
  const debugPanel = document.getElementById('debug-panel');

  let debugVisible = false;
  let godMode = false;

  // Expose objects for debugging
  window.debugObjects = {
    worldState,
    player,
    gameState,
    gameLoop,
    exitPoint,
    monsterManager,
    sceneManager
  };

  // Show debug button after game starts (use ` key to toggle)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { // ` key
      e.preventDefault();
      const instructions = document.getElementById('instructions');
      if (instructions.classList.contains('hidden')) {
        toggleButton.style.display = toggleButton.style.display === 'none' ? 'block' : 'none';
      }
    }
  });

  // Toggle debug panel
  toggleButton.addEventListener('click', () => {
    debugVisible = !debugVisible;
    debugPanel.style.display = debugVisible ? 'block' : 'none';

    // Release pointer lock when opening panel
    if (debugVisible) {
      input.exitPointerLock();
      console.log('🔧 DEBUG: Panel opened, mouse unlocked');
    }
  });

  // Update debug info every frame
  setInterval(() => {
    if (debugVisible) {
      const gridPos = player.getGridPosition();
      const roomType = worldState.getRoomType(gridPos.x, gridPos.y);
      const spawn = worldState.getSpawnPoint();
      const exit = exitPoint.getGridPosition();

      document.getElementById('debug-grid-pos').textContent = `${gridPos.x}, ${gridPos.y}`;
      document.getElementById('debug-room-type').textContent = roomType;
      document.getElementById('debug-spawn-pos').textContent = `${spawn.x}, ${spawn.y}`;
      document.getElementById('debug-exit-pos').textContent = `${exit.x}, ${exit.y}`;
    }
  }, 100);

  // Teleport buttons
  document.getElementById('debug-tp-spawn').addEventListener('click', () => {
    const spawn = worldState.getSpawnPoint();
    player.setPosition(spawn.x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, spawn.y * CONFIG.TILE_SIZE);
    console.log('🔧 DEBUG: Teleported to spawn');
  });

  document.getElementById('debug-tp-exit').addEventListener('click', () => {
    const exit = exitPoint.getGridPosition();
    player.setPosition(exit.x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, exit.y * CONFIG.TILE_SIZE);
    console.log('🔧 DEBUG: Teleported to exit');
  });

  document.getElementById('debug-tp-random').addEventListener('click', () => {
    const random = worldState.findRandomWalkableTile();
    player.setPosition(random.x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, random.y * CONFIG.TILE_SIZE);
    console.log('🔧 DEBUG: Teleported to random location');
  });

  document.getElementById('debug-tp-monster').addEventListener('click', () => {
    const monsters = monsterManager.getMonsters();
    if (monsters.length > 0) {
      const monsterPos = monsters[0].getGridPosition();
      player.setPosition(monsterPos.x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, monsterPos.y * CONFIG.TILE_SIZE);
      console.log('🔧 DEBUG: Teleported to monster');
    }
  });

  document.getElementById('debug-tp-custom').addEventListener('click', () => {
    const x = parseInt(document.getElementById('debug-tp-x').value);
    const y = parseInt(document.getElementById('debug-tp-y').value);
    if (!isNaN(x) && !isNaN(y) && worldState.isWalkable(x, y)) {
      player.setPosition(x * CONFIG.TILE_SIZE, CONFIG.PLAYER_HEIGHT, y * CONFIG.TILE_SIZE);
      console.log(`🔧 DEBUG: Teleported to (${x}, ${y})`);
    } else {
      console.warn('❌ Invalid coordinates or not walkable');
    }
  });

  // Health buttons
  document.getElementById('debug-health-full').addEventListener('click', () => {
    gameState.currentHealth = gameState.maxHealth;
    console.log('🔧 DEBUG: Health set to full');
  });

  document.getElementById('debug-health-half').addEventListener('click', () => {
    gameState.currentHealth = Math.floor(gameState.maxHealth / 2);
    console.log('🔧 DEBUG: Health set to 50%');
  });

  document.getElementById('debug-health-low').addEventListener('click', () => {
    gameState.currentHealth = 10;
    console.log('🔧 DEBUG: Health set to 10');
  });

  document.getElementById('debug-health-plus').addEventListener('click', () => {
    gameState.heal(20);
    console.log('🔧 DEBUG: Added 20 HP');
  });

  document.getElementById('debug-health-minus').addEventListener('click', () => {
    if (!godMode) {
      gameState.takeDamage(20);
      console.log('🔧 DEBUG: Removed 20 HP');
    }
  });

  // God mode
  document.getElementById('debug-god-mode').addEventListener('change', (e) => {
    godMode = e.target.checked;
    console.log('🔧 DEBUG: God mode', godMode ? 'ON' : 'OFF');
  });

  // Override takeDamage when god mode is on
  const originalTakeDamage = gameState.takeDamage.bind(gameState);
  gameState.takeDamage = function(amount) {
    if (!godMode) {
      originalTakeDamage(amount);
    } else {
      console.log('🔧 DEBUG: God mode blocked damage:', amount);
    }
  };

  // Time buttons
  document.getElementById('debug-time-reset').addEventListener('click', () => {
    gameState.startTime = Date.now();
    gameState.currentTime = 0;
    console.log('🔧 DEBUG: Timer reset');
  });

  document.getElementById('debug-time-stop').addEventListener('click', () => {
    if (gameState.isRunning) {
      gameState.stopTimer();
      console.log('🔧 DEBUG: Timer stopped');
    } else {
      gameState.startTimer();
      console.log('🔧 DEBUG: Timer started');
    }
  });

  document.getElementById('debug-time-plus').addEventListener('click', () => {
    gameState.startTime -= 30000; // Add 30 seconds
    console.log('🔧 DEBUG: Added 30 seconds');
  });

  document.getElementById('debug-time-minus').addEventListener('click', () => {
    gameState.startTime += 30000; // Subtract 30 seconds
    console.log('🔧 DEBUG: Subtracted 30 seconds');
  });

  // Game control buttons
  document.getElementById('debug-win').addEventListener('click', () => {
    gameState.win('强制胜利（调试）');
    gameLoop.showGameOver(true);
    console.log('🔧 DEBUG: Forced win');
  });

  document.getElementById('debug-lose').addEventListener('click', () => {
    gameState.lose('强制失败（调试）');
    gameLoop.showGameOver(false);
    console.log('🔧 DEBUG: Forced lose');
  });

  // Monster model change button
  document.getElementById('debug-apply-model').addEventListener('click', async () => {
    const selectElement = document.getElementById('debug-monster-model');
    const selectedModel = selectElement.value;
    const button = document.getElementById('debug-apply-model');

    console.log(`🔧 DEBUG: Changing monster model to ${selectedModel}`);
    button.textContent = '⏳ Loading...';
    button.disabled = true;

    try {
      await monsterManager.changeMonsterModel(selectedModel);
      button.textContent = '✅ Applied!';
      console.log('🔧 DEBUG: Model changed successfully!');

      setTimeout(() => {
        button.textContent = '🔄 Apply Model';
        button.disabled = false;
      }, 2000);
    } catch (error) {
      console.error('🔧 DEBUG: Failed to change model:', error);
      button.textContent = '❌ Failed';

      setTimeout(() => {
        button.textContent = '🔄 Apply Model';
        button.disabled = false;
      }, 2000);
    }
  });

  // Speed buttons
  document.getElementById('debug-speed-1x').addEventListener('click', () => {
    CONFIG.PLAYER_SPEED = 4;
    console.log('🔧 DEBUG: Speed set to 1x');
  });

  document.getElementById('debug-speed-2x').addEventListener('click', () => {
    CONFIG.PLAYER_SPEED = 8;
    console.log('🔧 DEBUG: Speed set to 2x');
  });

  document.getElementById('debug-speed-5x').addEventListener('click', () => {
    CONFIG.PLAYER_SPEED = 20;
    console.log('🔧 DEBUG: Speed set to 5x');
  });

  // Debug: Log scene info
  window.debugScene = function() {
    try {
      const { sceneManager, exitPoint, player, monsterManager } = window.debugObjects;
      const scene = sceneManager.getScene();
      console.log('=== SCENE DEBUG INFO ===');
      console.log('Total children:', scene.children.length);
      console.log('Exit in scene?', scene.children.includes(exitPoint.getMesh()));
      console.log('Exit position:', exitPoint.getMesh().position);
      console.log('Player position:', player.getPosition());
      console.log('Monster count:', monsterManager.getMonsters().length);
      console.log('======================');
    } catch (e) {
      console.error('Debug failed:', e);
    }
  };
  console.log('🔧 Debug panel initialized (Press ` key)');

  // Expose debug functions globally for browser console
  window.debugMonsters = () => {
    console.log('=== MONSTER DEBUG INFO ===');
    console.log('Monster count:', monsterManager.getMonsters().length);
    monsterManager.getMonsters().forEach((monster, i) => {
      console.log(`\nMonster ${i + 1}:`);
      console.log('  Position:', monster.position);
      console.log('  Grid:', `(${monster.gridX}, ${monster.gridY})`);
      console.log('  State:', monster.state);
      console.log('  Model type:', monster.model.type);
      console.log('  Model children:', monster.model.children.length);
      console.log('  Has animations:', monster.mixer !== null);
    });
  };

  window.debugScene = () => {
    console.log('=== SCENE DEBUG INFO ===');
    const scene = sceneManager.getScene();
    console.log('Scene children:', scene.children.length);
    scene.children.forEach((child, i) => {
      console.log(`  ${i}: ${child.type} - ${child.name || 'unnamed'}`);
    });
  };

  console.log('💡 Debug functions available in console:');
  console.log('   - debugMonsters() - Show monster info');
  console.log('   - debugScene() - Show scene objects');
}

// Start the game when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
