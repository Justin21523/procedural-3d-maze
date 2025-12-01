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
import { ProjectileManager } from './entities/projectileManager.js';
import { ExitPoint } from './world/exitPoint.js';
import { MissionPoint } from './world/missionPoint.js';
import { AutoPilot } from './ai/autoPilot.js';
import { AudioManager } from './audio/audioManager.js';
import { LEVEL_CONFIGS } from './core/levelConfigs.js';
import { Gun } from './player/gun.js';
import { LevelDirector } from './core/levelDirector.js';

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
  const minimapToggle = document.getElementById('minimap-toggle');
  const minimapSizeSlider = document.getElementById('minimap-size');
  const minimapSizeValue = document.getElementById('minimap-size-value');
  const minimapZoomSlider = document.getElementById('minimap-zoom');
  const minimapZoomValue = document.getElementById('minimap-zoom-value');
  const levelLabel = document.getElementById('level-label');
  const levelPrevBtn = document.getElementById('level-prev');
  const levelNextBtn = document.getElementById('level-next');
  const levelJumpInput = document.getElementById('level-jump-input');
  const levelJumpBtn = document.getElementById('level-jump-btn');
  const restartLevelBtn = document.getElementById('restart-level');
  const restartFirstBtn = document.getElementById('restart-first');

  // Debug: Check if elements exist
  console.log('DOM Elements check:');
  console.log('  canvas-container:', container ? '✓' : '✗');
  console.log('  instructions:', instructionsOverlay ? '✓' : '✗');
  console.log('  start-button:', startButton ? '✓' : '✗');
  console.log('  minimap canvas:', minimapCanvas ? '✓' : '✗');
  if (minimapCanvas) {
    console.log(`  minimap size: ${minimapCanvas.width}x${minimapCanvas.height}`);
  }

  // 多關卡狀態
  const levelDirector = new LevelDirector(LEVEL_CONFIGS);
  let currentLevelIndex = 0;
  let levelConfig = levelDirector.getLevelConfig(currentLevelIndex);
  let missionPoints = [];
  let exitPoint = null;
  let autopilot = null;
  let levelLoading = Promise.resolve();
  let lastOutcome = null;
  let lastRunStats = null;
  let minimapHidden = false;

  function updateLevelUI() {
    const label = `${levelConfig.name || 'Endless'} (L${currentLevelIndex + 1})`;
    if (levelLabel) {
      levelLabel.textContent = label;
    }
    if (levelJumpInput) {
      levelJumpInput.max = levelDirector.getMaxJump();
      levelJumpInput.value = currentLevelIndex + 1;
    }
  }

  function applyGameOverButtons(isWin) {
    if (nextLevelButton) {
      nextLevelButton.style.display = isWin ? 'inline-block' : 'none';
    }
    if (restartButton) {
      restartButton.textContent = isWin ? '重玩本关' : '重新开始';
    }
  }

  // 預設每關自動駕駛開啟（使用者仍可隨時用鍵鼠接管）
  CONFIG.AUTOPILOT_ENABLED = true;
  CONFIG.AUTOPILOT_DELAY = 0;

  // Create world state
  const worldState = new WorldState();
  worldState.initialize(levelConfig);
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
  function applyMinimapSize(size) {
    const clamped = Math.max(140, Math.min(320, size));
    minimapCanvas.width = clamped;
    minimapCanvas.height = clamped;
    minimapCanvas.style.width = `${clamped}px`;
    minimapCanvas.style.height = `${clamped}px`;
    minimap.resize(clamped);
    if (minimapZoomSlider) {
      const zoom = parseFloat(minimapZoomSlider.value) || minimap.zoom || 1;
      minimap.setZoom(zoom);
    }
    minimapSizeValue.textContent = `${clamped}px`;
    minimap.render(
      player.getGridPosition(),
      monsterManager?.getMonsterPositions() || [],
      exitPoint?.getGridPosition() || null,
      missionPoints.map(mp => mp.getGridPosition())
    );
  }

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
  exitPoint = new ExitPoint(exitGridPos);
  sceneManager.getScene().add(exitPoint.getMesh());
  console.log('🚪 Exit point created at grid:', exitGridPos);

  // Create monster manager
  const monsterManager = new MonsterManager(sceneManager.getScene(), worldState, player);
  console.log('👹 Monster manager created');

  // Load monsters with mixed types
  console.log('🎮 Loading monsters with mixed types...');
  const MONSTER_COUNT = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
  console.log(`📊 Spawning ${MONSTER_COUNT} monsters`);

  // Initialize monsters with mixed types (Hunter, Wanderer, Sentinel, etc.)
  monsterManager.initializeForLevel(levelConfig)
    .then(() => {
      console.log(`✅ ${MONSTER_COUNT} monsters initialized successfully!`);
      console.log(`   Monster manager has ${monsterManager.getMonsters().length} monsters`);
    })
    .catch(err => {
      console.error('❌ Failed to initialize monsters:', err);
      console.error('   Error details:', err.message);
    });

  // Create mission points
  missionPoints = worldState.getMissionPoints().map(pos => {
    const mp = new MissionPoint(pos);
    sceneManager.getScene().add(mp.getMesh());
    return mp;
  });
  gameState.setMissionTotal(missionPoints.length);
  console.log(`🎯 Mission points: ${missionPoints.length}`);

  // Autopilot placeholder（會在 loadLevel 時重新建立）
  autopilot = new AutoPilot(
    worldState,
    monsterManager,
    () => missionPoints,
    exitPoint,
    player,
    levelConfig
  );

  const projectileManager = new ProjectileManager(
    sceneManager.getScene(),
    worldState,
    monsterManager
  );

  const gun = new Gun(
    sceneManager.getScene(),
    camera,
    input,
    projectileManager,
    audioManager
  );

  // Create game loop with all systems（autopilot 實體可後續更新）
  let gameLoop = new GameLoop(
    sceneManager,
    player,
    minimap,
    monsterManager,
    lights,
    worldState,
    gameState,
    exitPoint,
    missionPoints,
    autopilot,
    projectileManager,
    gun
  );

  // Render initial minimap (before game starts)
  console.log('🗺️ Rendering initial minimap...');
  minimap.render(
    player.getGridPosition(),
    monsterManager.getMonsterPositions(),
    exitGridPos,
    missionPoints.map(mp => mp.getGridPosition())
  );
  console.log('✅ Initial minimap rendered');
  updateLevelUI();

  // Minimap controls
  if (minimapSizeSlider) {
    minimapSizeSlider.value = minimapCanvas.width;
    minimapSizeValue.textContent = `${minimapCanvas.width}px`;
    minimapSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      applyMinimapSize(size);
    });
  }

  if (minimapZoomSlider) {
    minimapZoomSlider.addEventListener('input', (e) => {
      const zoom = parseFloat(e.target.value) || 1.0;
      minimap.setZoom(zoom);
      minimapZoomValue.textContent = `${zoom.toFixed(1)}x`;
      minimap.render(
        player.getGridPosition(),
        monsterManager.getMonsterPositions(),
        exitPoint.getGridPosition(),
        missionPoints.map(mp => mp.getGridPosition())
      );
    });
    minimapZoomValue.textContent = `${parseFloat(minimapZoomSlider.value || '1.4').toFixed(1)}x`;
    minimap.setZoom(parseFloat(minimapZoomSlider.value || '1.4'));
  }

  if (minimapToggle) {
    minimapToggle.addEventListener('click', () => {
      minimapHidden = !minimapHidden;
      minimapCanvas.style.display = minimapHidden ? 'none' : 'block';
      document.getElementById('minimap-controls').style.display = minimapHidden ? 'none' : 'block';
      minimapToggle.textContent = minimapHidden ? 'Show' : 'Hide';
    });
  }

  /**
   * 重新載入指定關卡
   * @param {number} levelIndex
   * @param {Object} options
   * @param {boolean} options.startLoop - 是否立刻開跑
   * @param {boolean} options.resetGameState - 是否重置血量/計時
   */
  async function loadLevel(levelIndex, { startLoop = false, resetGameState = true } = {}) {
    levelLoading = (async () => {
      currentLevelIndex = Math.max(0, levelIndex);
      levelConfig = levelDirector.getLevelConfig(currentLevelIndex, lastRunStats, lastOutcome);
      console.log(`🔄 Loading level: ${levelConfig.name}`);
      lastOutcome = null;
      updateLevelUI();

      // 重置自動駕駛預設
      CONFIG.AUTOPILOT_ENABLED = true;
      CONFIG.AUTOPILOT_DELAY = 0;

      // 停止當前遊戲迴圈
      gameLoop.stop();
      gameLoop.resetRoundState();

      // 更新血量上限
      if (resetGameState && gameState) {
        const maxHp = Math.round(100 * (levelConfig.player?.maxHealthMultiplier ?? 1));
        gameState.maxHealth = maxHp;
      }

      // 重建世界
      worldState.initialize(levelConfig);
      sceneManager.buildWorldFromGrid(worldState);

      // 重建出口
      const newExitPos = worldState.getExitPoint();
      if (exitPoint) {
        sceneManager.getScene().remove(exitPoint.getMesh());
      }
      exitPoint = new ExitPoint(newExitPos);
      sceneManager.getScene().add(exitPoint.getMesh());
      gameLoop.exitPoint = exitPoint;

      // 任務點
      missionPoints = worldState.getMissionPoints().map(pos => {
        const mp = new MissionPoint(pos);
        sceneManager.getScene().add(mp.getMesh());
        return mp;
      });
      gameState.setMissionTotal(missionPoints.length);
      gameLoop.missionPoints = missionPoints;

      // 重置玩家位置
      const spawnPoint = worldState.getSpawnPoint();
      player.setPosition(
        spawnPoint.x * CONFIG.TILE_SIZE,
        CONFIG.PLAYER_HEIGHT,
        spawnPoint.y * CONFIG.TILE_SIZE
      );

      // 重置遊戲狀態
      if (resetGameState) {
        gameState.reset();
        gameState.currentHealth = gameState.maxHealth;
      }

      // 隱藏 overlay，保持連續遊戲
      document.getElementById('game-over').classList.add('hidden');
      document.getElementById('instructions').classList.add('hidden');

      // 重建怪物
      monsterManager.clear();
      await monsterManager.initializeForLevel(levelConfig);

      // 重建自動駕駛
      autopilot = new AutoPilot(
        worldState,
        monsterManager,
        () => missionPoints,
        exitPoint,
        player,
        levelConfig
      );
      gameLoop.autopilot = autopilot;
      gameLoop.autopilotActive = CONFIG.AUTOPILOT_ENABLED;
      projectileManager.worldState = worldState;
      projectileManager.monsterManager = monsterManager;
      projectileManager.reset?.();
      gameLoop.projectileManager = projectileManager;
      gameLoop.gun = gun;
      gun.cooldown = 0;

      // 更新 minimap
      minimap.updateScale();
      minimap.render(
        player.getGridPosition(),
        monsterManager.getMonsterPositions(),
        newExitPos,
        missionPoints.map(mp => mp.getGridPosition())
      );

      if (startLoop) {
        gameState.startTimer();
        gameLoop.start();
      }
    })();

    return levelLoading;
  }

  // 通關後等待使用者確認
  gameLoop.onWin = () => {
    lastOutcome = 'win';
    lastRunStats = gameState.getStats();
    applyGameOverButtons(true);
  };
  gameLoop.onLose = () => {
    lastOutcome = 'lose';
    lastRunStats = gameState.getStats();
    applyGameOverButtons(false);
  };

  // Level control UI
  if (levelPrevBtn) {
    levelPrevBtn.addEventListener('click', async () => {
      await loadLevel(currentLevelIndex - 1, { startLoop: true, resetGameState: true });
    });
  }

  if (levelNextBtn) {
    levelNextBtn.addEventListener('click', async () => {
      await loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
    });
  }

  if (levelJumpBtn && levelJumpInput) {
    levelJumpBtn.addEventListener('click', async () => {
      const target = Math.max(1, Math.min(levelDirector.getMaxJump(), parseInt(levelJumpInput.value, 10) || 1));
      await loadLevel(target - 1, { startLoop: true, resetGameState: true });
    });
  }

  if (restartLevelBtn) {
    restartLevelBtn.addEventListener('click', async () => {
      await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    });
  }

  if (restartFirstBtn) {
    restartFirstBtn.addEventListener('click', async () => {
      await loadLevel(0, { startLoop: true, resetGameState: true });
    });
  }

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
      const worldX = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
      const worldZ = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
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
  startButton.addEventListener('click', async () => {
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
    await levelLoading;
    gameLoop.start();

    // Request pointer lock immediately in the user gesture
    console.log('🔒 Requesting pointer lock...');
    input.requestPointerLock();

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
  const nextLevelButton = document.getElementById('next-level-button');
  const menuButton = document.getElementById('menu-button');

  restartButton.addEventListener('click', async () => {
    console.log('🔄 Restarting game...');

    // Hide game over screen
    document.getElementById('game-over').classList.add('hidden');

    lastOutcome = null;
    await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    console.log('✅ Level restarted!');
  });

  if (nextLevelButton) {
    nextLevelButton.addEventListener('click', async () => {
      console.log('⏭️ Proceeding to next level...');
      document.getElementById('game-over').classList.add('hidden');
      lastOutcome = null;
      await loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
      console.log('✅ Loaded next level');
    });
  }

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
  setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap, gameState);

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
function setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap, gameState) {
  const toggleButton = document.getElementById('toggle-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const autopilotToggle = document.getElementById('autopilot-toggle');
  const autopilotDelaySlider = document.getElementById('autopilot-delay');
  const autopilotDelayValue = document.getElementById('autopilot-delay-value');

  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');

  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');

  const fovSlider = document.getElementById('fov-slider');
  const fovValue = document.getElementById('fov-value');

  const fogSlider = document.getElementById('fog-slider');
  const fogValue = document.getElementById('fog-value');

  const regenerateButton = document.getElementById('regenerate-map');
  const mazeSizeSlider = document.getElementById('maze-size-slider');
  const mazeSizeValue = document.getElementById('maze-size-value');
  const roomDensitySlider = document.getElementById('room-density-slider');
  const roomDensityValue = document.getElementById('room-density-value');
  const missionCountSlider = document.getElementById('mission-count-slider');
  const missionCountValue = document.getElementById('mission-count-value');
  const lowPerfToggle = document.getElementById('low-perf-toggle');

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

  // Maze size slider (force odd numbers)
  mazeSizeSlider.addEventListener('input', (e) => {
    const raw = parseInt(e.target.value, 10);
    const size = raw % 2 === 0 ? raw + 1 : raw;
    mazeSizeValue.textContent = size;
    CONFIG.MAZE_WIDTH = size;
    CONFIG.MAZE_HEIGHT = size;
  });

  // Room density slider
  roomDensitySlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    roomDensityValue.textContent = value.toFixed(1);
    CONFIG.ROOM_DENSITY = value;
  });

  // Mission count slider
  missionCountSlider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10);
    missionCountValue.textContent = value;
    CONFIG.MISSION_POINT_COUNT = value;
  });

  lowPerfToggle.addEventListener('change', (e) => {
    CONFIG.LOW_PERF_MODE = e.target.checked;
  });

  autopilotToggle.addEventListener('change', (e) => {
    CONFIG.AUTOPILOT_ENABLED = e.target.checked;
  });

  autopilotDelaySlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    autopilotDelayValue.textContent = value.toFixed(1);
    CONFIG.AUTOPILOT_DELAY = value;
  });

  // Regenerate map button
  regenerateButton.addEventListener('click', async () => {
    console.log('🔄 Regenerating map...');
    await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    console.log('✅ Map regenerated!');
  });

  // Initialize UI from CONFIG
  mazeSizeSlider.value = CONFIG.MAZE_WIDTH;
  mazeSizeValue.textContent = CONFIG.MAZE_WIDTH;
  roomDensitySlider.value = CONFIG.ROOM_DENSITY;
  roomDensityValue.textContent = CONFIG.ROOM_DENSITY.toFixed(1);
  missionCountSlider.value = CONFIG.MISSION_POINT_COUNT;
  missionCountValue.textContent = CONFIG.MISSION_POINT_COUNT;
  lowPerfToggle.checked = CONFIG.LOW_PERF_MODE;
  autopilotToggle.checked = CONFIG.AUTOPILOT_ENABLED || false;
  autopilotDelaySlider.value = CONFIG.AUTOPILOT_DELAY || 2;
  autopilotDelayValue.textContent = (CONFIG.AUTOPILOT_DELAY || 2).toFixed(1);
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
