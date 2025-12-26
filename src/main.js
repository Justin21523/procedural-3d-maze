/**
 * Main entry point for the game
 * Initializes all systems and starts the game
 */

import * as THREE from 'three';
import { CONFIG, resolveMonsterCount } from './core/config.js';
import { EVENTS } from './core/events.js';
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
import { PickupManager } from './entities/pickupManager.js';
import { ExitPoint } from './world/exitPoint.js';
import { AutoPilot } from './ai/autoPilot.js';
import { AudioManager } from './audio/audioManager.js';
import { LEVEL_CATALOG } from './core/levelCatalog.js';
import { Gun } from './player/gun.js';
import { WeaponView } from './player/weaponView.js';
import { LevelDirector } from './core/levelDirector.js';
import { SpawnDirector } from './core/spawnDirector.js';
import { EventBus } from './core/eventBus.js';
import { CombatSystem } from './core/combatSystem.js';
import { FeedbackSystem } from './core/feedbackSystem.js';
import { UIManager } from './ui/uiManager.js';
import { InteractableSystem } from './core/interactions/interactableSystem.js';
import { MissionDirector } from './core/missions/missionDirector.js';

/**
 * Initialize and start the game
 */
async function initGame() {
  console.log('='.repeat(80));
  console.log('🎮 GAME INITIALIZATION STARTED');
  console.log('📦 VERSION: 2.0.2 - Debug Version');
  console.log('='.repeat(80));

  const eventBus = new EventBus();

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
  const minimapResetButton = document.getElementById('minimap-reset');
  const levelLabel = document.getElementById('level-label');
  const levelPrevBtn = document.getElementById('level-prev');
  const levelNextBtn = document.getElementById('level-next');
  const levelJumpInput = document.getElementById('level-jump-input');
  const levelJumpBtn = document.getElementById('level-jump-btn');
  const restartLevelBtn = document.getElementById('restart-level');
  const restartFirstBtn = document.getElementById('restart-first');
  const levelDebugSourceEl = document.getElementById('level-debug-source');
  const levelDebugObjectiveEl = document.getElementById('level-debug-objective');
  const levelDebugExitEl = document.getElementById('level-debug-exit');
  const levelDebugStealthEl = document.getElementById('level-debug-stealth');
  const reloadLevelsBtn = document.getElementById('reload-levels');

  // Debug: Check if elements exist
  console.log('DOM Elements check:');
  console.log('  canvas-container:', container ? '✓' : '✗');
  console.log('  instructions:', instructionsOverlay ? '✓' : '✗');
  console.log('  start-button:', startButton ? '✓' : '✗');
  console.log('  minimap canvas:', minimapCanvas ? '✓' : '✗');
  if (minimapCanvas) {
    console.log(`  minimap size: ${minimapCanvas.width}x${minimapCanvas.height}`);
  }

  // Multi-level state (loaded from public/levels/*.json, with src/core/levelCatalog.js fallback)
  let levelDirector = await LevelDirector.createFromPublic({
    manifestUrl: '/levels/manifest.json',
    fallbackLevels: LEVEL_CATALOG
  });
  let currentLevelIndex = 0;
  let levelConfig = levelDirector.getLevelConfig(currentLevelIndex);
  let missionDirector = null;
  let interactableSystem = null;
  let exitPoint = null;
  let autopilot = null;
  let pickupManager = null;
  let spawnDirector = null;
  let levelLoading = Promise.resolve();
  let lastOutcome = null;
  let lastRunStats = null;
  let minimapHidden = false;

  // Auto-advance / auto-restart after game over
  const AUTO_GAMEOVER_DELAY_MS = 3000;
  let autoGameOverTimer = null;
  let autoGameOverInterval = null;
  let autoGameOverCancelUnsubs = [];

  function setGameOverAutoText(text) {
    const el = document.getElementById('game-over-auto');
    if (!el) return;
    el.textContent = text || '';
  }

  function clearAutoGameOverTimer() {
    if (autoGameOverTimer) {
      clearTimeout(autoGameOverTimer);
      autoGameOverTimer = null;
    }
    if (autoGameOverInterval) {
      clearInterval(autoGameOverInterval);
      autoGameOverInterval = null;
    }
    for (const off of autoGameOverCancelUnsubs) {
      try { off?.(); } catch { /* ignore */ }
    }
    autoGameOverCancelUnsubs = [];
    setGameOverAutoText('');
  }

  function startAutoGameOverCountdown(mode, onDone) {
    clearAutoGameOverTimer();
    const startedAt = performance.now();
    const deadline = startedAt + AUTO_GAMEOVER_DELAY_MS;

    const verb = mode === 'win' ? 'Next level' : 'Restarting';
    let lastSeconds = null;

    const updateText = () => {
      const remainingMs = Math.max(0, deadline - performance.now());
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      if (seconds === lastSeconds) return;
      lastSeconds = seconds;
      setGameOverAutoText(`${verb} in ${seconds}… (press any key/mouse to cancel)`);
    };

    const cancel = () => {
      clearAutoGameOverTimer();
      setGameOverAutoText('Auto action canceled.');
    };

    const listenOnce = (eventName) => {
      const handler = () => cancel();
      window.addEventListener(eventName, handler, { capture: true, passive: true, once: true });
      autoGameOverCancelUnsubs.push(() => window.removeEventListener(eventName, handler, { capture: true }));
    };

    listenOnce('keydown');
    listenOnce('mousedown');
    listenOnce('mousemove');
    listenOnce('touchstart');

    updateText();
    autoGameOverInterval = setInterval(updateText, 50);

    autoGameOverTimer = setTimeout(() => {
      // Only proceed if the overlay is still visible (no manual navigation).
      const overlay = document.getElementById('game-over');
      if (!overlay || overlay.classList.contains('hidden')) {
        clearAutoGameOverTimer();
        return;
      }
      clearAutoGameOverTimer();
      if (typeof onDone === 'function') onDone();
    }, AUTO_GAMEOVER_DELAY_MS);
  }

  function formatLevelSource(levelConfig) {
    const src = levelConfig?.__source;
    if (!src) return 'generated';
    const s = String(src);
    const parts = s.split('/');
    return parts.length > 0 ? parts[parts.length - 1] : s;
  }

  function updateLevelDebugUI() {
    if (levelDebugSourceEl) {
      levelDebugSourceEl.textContent = formatLevelSource(levelConfig);
    }

    const state = missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : null;
    const objectiveText = state?.objective?.objectiveText || '';
    const exitUnlocked = state ? (state.exitUnlocked !== false) : (gameState?.exitUnlocked !== false);

    if (levelDebugObjectiveEl) {
      levelDebugObjectiveEl.textContent = objectiveText || '—';
    }
    if (levelDebugExitEl) {
      levelDebugExitEl.textContent = exitUnlocked ? 'Yes' : 'No';
    }

    let stealthText = '—';
    if (state?.objective?.template === 'stealthNoise') {
      const remaining = Number(state?.objective?.progress?.remaining);
      stealthText = Number.isFinite(remaining) ? `${Math.ceil(remaining)}s` : '—';
    }
    if (levelDebugStealthEl) {
      levelDebugStealthEl.textContent = stealthText;
    }
  }

  function updateLevelUI() {
    const label = `${levelConfig.name || 'Endless'} (L${currentLevelIndex + 1})`;
    if (levelLabel) {
      levelLabel.textContent = label;
    }
    if (levelJumpInput) {
      levelJumpInput.max = levelDirector.getMaxJump();
      levelJumpInput.value = currentLevelIndex + 1;
    }
    updateLevelDebugUI();
  }

  function applyGameOverButtons(isWin) {
    if (nextLevelButton) {
      nextLevelButton.style.display = isWin ? 'inline-block' : 'none';
    }
    if (restartButton) {
      restartButton.textContent = isWin ? 'Replay Level' : 'Restart';
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
  // Add camera to scene so first-person attachments (weapon view) can render.
  sceneManager.getScene().add(camera.getCamera());
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

  const MINIMAP_STORAGE_SIZE = 'maze:minimap:size';
  const MINIMAP_STORAGE_ZOOM = 'maze:minimap:zoom';
  const DEFAULT_MINIMAP_SIZE = 240;
  const DEFAULT_MINIMAP_ZOOM = 1.1;
  const MINIMAP_SIZE_MIN = 140;
  const MINIMAP_SIZE_MAX = 320;
  const MINIMAP_ZOOM_MIN = 1.0;
  const MINIMAP_ZOOM_MAX = 3.0;

  const safeStorageGet = (key) => {
    try {
      return window.localStorage?.getItem?.(key) ?? null;
    } catch {
      return null;
    }
  };
  const safeStorageSet = (key, value) => {
    try {
      window.localStorage?.setItem?.(key, String(value));
    } catch {
      // Ignore (privacy mode / blocked storage)
    }
  };
  const safeStorageRemove = (key) => {
    try {
      window.localStorage?.removeItem?.(key);
    } catch {
      // Ignore
    }
  };

  function clampMinimapSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(MINIMAP_SIZE_MIN, Math.min(MINIMAP_SIZE_MAX, Math.round(n)));
  }

  function clampMinimapZoom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(MINIMAP_ZOOM_MIN, Math.min(MINIMAP_ZOOM_MAX, n));
  }

  // Restore minimap size/zoom from storage (applied before first render).
  let initialMinimapSize = minimapCanvas?.width || DEFAULT_MINIMAP_SIZE;
  const storedSize = clampMinimapSize(parseInt(safeStorageGet(MINIMAP_STORAGE_SIZE) || '', 10));
  initialMinimapSize = storedSize ?? clampMinimapSize(initialMinimapSize) ?? DEFAULT_MINIMAP_SIZE;

  let initialMinimapZoom = DEFAULT_MINIMAP_ZOOM;
  const storedZoom = clampMinimapZoom(parseFloat(safeStorageGet(MINIMAP_STORAGE_ZOOM) || ''));
  initialMinimapZoom = storedZoom ?? DEFAULT_MINIMAP_ZOOM;

  if (minimapCanvas) {
    minimapCanvas.width = initialMinimapSize;
    minimapCanvas.height = initialMinimapSize;
    minimapCanvas.style.width = `${initialMinimapSize}px`;
    minimapCanvas.style.height = `${initialMinimapSize}px`;
    minimap.resize(initialMinimapSize);
    minimap.setZoom(initialMinimapZoom);
  }

  function ensureMinimapVisibleForAdjust() {
    if (!minimapCanvas) return;
    if (!minimapHidden) return;
    minimapHidden = false;
    minimapCanvas.style.display = 'block';
    const controls = document.getElementById('minimap-controls');
    if (controls) controls.style.display = 'block';
    if (minimapToggle) minimapToggle.textContent = 'Hide';
  }

  function applyMinimapSize(size) {
    ensureMinimapVisibleForAdjust();
    const clamped = clampMinimapSize(size) ?? clampMinimapSize(minimapCanvas?.width) ?? DEFAULT_MINIMAP_SIZE;
    minimapCanvas.width = clamped;
    minimapCanvas.height = clamped;
    minimapCanvas.style.width = `${clamped}px`;
    minimapCanvas.style.height = `${clamped}px`;
    minimap.resize(clamped);
    safeStorageSet(MINIMAP_STORAGE_SIZE, clamped);
    if (minimapZoomSlider) {
      const zoom = clampMinimapZoom(parseFloat(minimapZoomSlider.value)) ?? minimap.zoom ?? DEFAULT_MINIMAP_ZOOM;
      minimapZoomSlider.value = String(zoom);
      minimap.setZoom(zoom);
    }
    if (minimapSizeValue) minimapSizeValue.textContent = `${clamped}px`;
    minimap.render(
      player.getGridPosition(),
      monsterManager?.getMonsterPositions() || [],
      exitPoint?.getGridPosition() || null,
      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : []
    );
  }

  // Create input handler
  const input = new InputHandler();
  console.log('Input handler created');

  // Create game state manager
  const gameState = new GameState(eventBus);
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
  const monsterManager = new MonsterManager(sceneManager.getScene(), worldState, player, eventBus);
  console.log('👹 Monster manager created');

  // Interactions + objectives (data-driven missions)
  interactableSystem = new InteractableSystem({
    eventBus,
    scene: sceneManager.getScene(),
    camera,
    input,
    worldState
  });
  exitPoint?.registerInteractable?.(interactableSystem, { eventBus, gameState });

  missionDirector = new MissionDirector({
    eventBus,
    worldState,
    scene: sceneManager.getScene(),
    gameState,
    exitPoint,
    interactableSystem
  });
  missionDirector.startLevel(levelConfig);
  eventBus.on(EVENTS.MISSION_UPDATED, () => updateLevelDebugUI());
  updateLevelDebugUI();

  // Autopilot placeholder（會在 loadLevel 時重新建立）
  autopilot = new AutoPilot(
    worldState,
    monsterManager,
    () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
    exitPoint,
    player,
    levelConfig
  );

  const projectileManager = new ProjectileManager(
    sceneManager.getScene(),
    worldState,
    monsterManager,
    player,
    eventBus
  );

  monsterManager.setProjectileManager(projectileManager);

  const weaponView = new WeaponView(
    sceneManager.getScene(),
    camera,
    player
  );

  const gun = new Gun(
    sceneManager.getScene(),
    camera,
    input,
    projectileManager,
    audioManager,
    weaponView,
    eventBus
  );
  autopilot?.setGun?.(gun);

  const uiManager = new UIManager({
    eventBus,
    player,
    worldState,
    gameState,
    gun
  });
  missionDirector?.syncStatus?.(true);

  pickupManager = new PickupManager(sceneManager.getScene(), player, gameState, gun, audioManager, eventBus);
  spawnDirector = new SpawnDirector(monsterManager, player, pickupManager, eventBus);
  spawnDirector.setGameState(gameState);
  spawnDirector.setGun(gun);
  levelLoading = spawnDirector.startLevel(levelConfig);

  // Combat resolution (damage/explosions) driven by EventBus.
  const combatSystem = new CombatSystem({
    eventBus,
    monsterManager,
    projectileManager,
    playerRef: player,
    gameState
  });
  void combatSystem;

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
    [],
    autopilot,
    projectileManager,
    gun,
    spawnDirector,
    uiManager,
    interactableSystem,
    missionDirector
  );

  // Combat feedback (hit marker + light shake/flash) driven by EventBus
  const feedbackSystem = new FeedbackSystem(eventBus, audioManager, gameLoop?.visualEffects || null);
  void feedbackSystem;

  // Render initial minimap (before game starts)
  console.log('🗺️ Rendering initial minimap...');
  minimap.render(
    player.getGridPosition(),
    monsterManager.getMonsterPositions(),
    exitGridPos,
    missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : []
  );
  console.log('✅ Initial minimap rendered');
  updateLevelUI();

  // Minimap controls
  function applyMinimapZoom(zoom) {
    ensureMinimapVisibleForAdjust();
    const clamped = clampMinimapZoom(zoom) ?? minimap.zoom ?? DEFAULT_MINIMAP_ZOOM;
    minimap.setZoom(clamped);
    safeStorageSet(MINIMAP_STORAGE_ZOOM, clamped);
    if (minimapZoomSlider) minimapZoomSlider.value = String(clamped);
    if (minimapZoomValue) minimapZoomValue.textContent = `${clamped.toFixed(1)}x`;
    minimap.render(
      player.getGridPosition(),
      monsterManager.getMonsterPositions(),
      exitPoint?.getGridPosition?.() || null,
      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : []
    );
    return clamped;
  }

  if (minimapSizeSlider) {
    const initSize = clampMinimapSize(minimapCanvas.width) ?? DEFAULT_MINIMAP_SIZE;
    minimapSizeSlider.value = String(initSize);
    if (minimapSizeValue) minimapSizeValue.textContent = `${initSize}px`;
    minimapSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      applyMinimapSize(size);
    });
  }

  if (minimapZoomSlider) {
    minimapZoomSlider.value = String(clampMinimapZoom(initialMinimapZoom) ?? DEFAULT_MINIMAP_ZOOM);
    if (minimapZoomValue) {
      const z = clampMinimapZoom(parseFloat(minimapZoomSlider.value)) ?? DEFAULT_MINIMAP_ZOOM;
      minimapZoomValue.textContent = `${z.toFixed(1)}x`;
    }
    minimapZoomSlider.addEventListener('input', (e) => {
      applyMinimapZoom(parseFloat(e.target.value));
    });
    // Ensure runtime zoom matches the UI value (including restored storage).
    applyMinimapZoom(parseFloat(minimapZoomSlider.value));
  }

  if (minimapResetButton) {
    minimapResetButton.addEventListener('click', () => {
      safeStorageRemove(MINIMAP_STORAGE_SIZE);
      safeStorageRemove(MINIMAP_STORAGE_ZOOM);

      if (minimapSizeSlider) minimapSizeSlider.value = String(DEFAULT_MINIMAP_SIZE);
      if (minimapZoomSlider) minimapZoomSlider.value = String(DEFAULT_MINIMAP_ZOOM);

      applyMinimapSize(DEFAULT_MINIMAP_SIZE);
      applyMinimapZoom(DEFAULT_MINIMAP_ZOOM);

      minimap.render(
        player.getGridPosition(),
        monsterManager.getMonsterPositions(),
        exitPoint.getGridPosition(),
        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : []
      );
    });
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
      clearAutoGameOverTimer();
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

      // Clear previous level objectives/interactables before rebuilding the scene
      missionDirector?.clear?.();
      interactableSystem?.clear?.();

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
      exitPoint?.registerInteractable?.(interactableSystem, { eventBus, gameState });

      // 重置玩家位置
      const spawnPoint = worldState.getSpawnPoint();
      const tileSize = CONFIG.TILE_SIZE || 1;
      player.setPosition(
        spawnPoint.x * tileSize + tileSize / 2,
        CONFIG.PLAYER_HEIGHT,
        spawnPoint.y * tileSize + tileSize / 2
      );

      // 重置遊戲狀態
      if (resetGameState) {
        gameState.reset();
        gameState.currentHealth = gameState.maxHealth;
      }

      // Rebuild missions/objectives for this level (after reset so totals aren't overwritten)
      if (missionDirector) {
        missionDirector.setRefs({
          worldState,
          scene: sceneManager.getScene(),
          gameState,
          exitPoint,
          interactableSystem,
          eventBus
        });
        missionDirector.startLevel(levelConfig);
      }
      gameLoop.missionDirector = missionDirector;
      gameLoop.interactableSystem = interactableSystem;

      // 隱藏 overlay，保持連續遊戲
      document.getElementById('game-over').classList.add('hidden');
      document.getElementById('instructions').classList.add('hidden');

      // 重建怪物
      monsterManager.clear();
      if (spawnDirector) {
        await spawnDirector.startLevel(levelConfig);
      } else {
        await monsterManager.initializeForLevel(levelConfig);
      }
      monsterManager.setProjectileManager(projectileManager);

      // 重建自動駕駛
      autopilot = new AutoPilot(
        worldState,
        monsterManager,
        () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
        exitPoint,
        player,
        levelConfig
      );
      autopilot?.setGun?.(gun);
      gameLoop.autopilot = autopilot;
      gameLoop.autopilotActive = CONFIG.AUTOPILOT_ENABLED;
      projectileManager.worldState = worldState;
      projectileManager.monsterManager = monsterManager;
      projectileManager.setPlayerRef?.(player);
      projectileManager.reset?.();
      gameLoop.projectileManager = projectileManager;
      gameLoop.gun = gun;
      gameLoop.spawnDirector = spawnDirector;
      gun.reset?.();

      // 更新 minimap
      minimap.updateScale();
      minimap.render(
        player.getGridPosition(),
        monsterManager.getMonsterPositions(),
        newExitPos,
        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : []
      );

      if (startLoop) {
        gameState.startTimer();
        gameLoop.start();
      }
    })();

    return levelLoading;
  }

  if (reloadLevelsBtn) {
    reloadLevelsBtn.addEventListener('click', async () => {
      const prevText = reloadLevelsBtn.textContent;
      reloadLevelsBtn.disabled = true;
      reloadLevelsBtn.textContent = 'Reloading…';

      try {
        await levelLoading;
        levelDirector = await LevelDirector.createFromPublic({
          manifestUrl: '/levels/manifest.json',
          fallbackLevels: LEVEL_CATALOG
        });
        await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
      } catch (err) {
        console.warn('⚠️ Failed to reload level JSON:', err?.message || err);
      } finally {
        reloadLevelsBtn.textContent = prevText;
        reloadLevelsBtn.disabled = false;
      }
    });
  }

  // 通關後等待使用者確認
  gameLoop.onWin = () => {
    lastOutcome = 'win';
    lastRunStats = gameState.getStats();
    applyGameOverButtons(true);
    startAutoGameOverCountdown('win', () => {
      if (!gameState?.gameOver || !gameState?.hasWon) return;
      void loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
    });
  };
  gameLoop.onLose = () => {
    lastOutcome = 'lose';
    lastRunStats = gameState.getStats();
    applyGameOverButtons(false);
    startAutoGameOverCountdown('lose', () => {
      if (!gameState?.gameOver || !gameState?.hasLost) return;
      void loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    });
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
    clearAutoGameOverTimer();

    // Hide game over screen
    document.getElementById('game-over').classList.add('hidden');

    lastOutcome = null;
    await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    console.log('✅ Level restarted!');
  });

  if (nextLevelButton) {
    nextLevelButton.addEventListener('click', async () => {
      console.log('⏭️ Proceeding to next level...');
      clearAutoGameOverTimer();
      document.getElementById('game-over').classList.add('hidden');
      lastOutcome = null;
      await loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
      console.log('✅ Loaded next level');
    });
  }

  menuButton.addEventListener('click', () => {
    console.log('📋 Returning to menu...');
    clearAutoGameOverTimer();

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
  setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap, gameState, {
    regenerateMap: async () => loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true }),
    respawnEnemies: async () => {
      const sd = spawnDirector || gameLoop?.spawnDirector || null;
      const mm = monsterManager || gameLoop?.monsterManager || null;
      const cfg = levelConfig || mm?.levelConfig || sd?.levelConfig || null;

      if (!mm) return;

      const prevEnabled = sd?.enabled ?? true;
      sd?.setEnabled?.(false);
      mm.clear();

      if (sd?.startLevel && cfg) {
        await sd.startLevel(cfg);
      } else if (mm.initializeForLevel) {
        await mm.initializeForLevel(cfg);
      }

      sd?.setEnabled?.(prevEnabled);
    },
    weaponView
  });

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
	function setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap, gameState, hooks = {}) {
	  const toggleButton = document.getElementById('toggle-settings');
	  const settingsPanel = document.getElementById('settings-panel');
	  const autopilotToggle = document.getElementById('autopilot-toggle');
	  const autopilotDelaySlider = document.getElementById('autopilot-delay');
	  const autopilotDelayValue = document.getElementById('autopilot-delay-value');
	  const autopilotCombatToggle = document.getElementById('autopilot-combat-toggle');
	  const autopilotFireRangeSlider = document.getElementById('autopilot-fire-range');
	  const autopilotFireRangeValue = document.getElementById('autopilot-fire-range-value');
	  const autopilotFireFovSlider = document.getElementById('autopilot-fire-fov');
	  const autopilotFireFovValue = document.getElementById('autopilot-fire-fov-value');
	  const autopilotTurnSpeedSlider = document.getElementById('autopilot-turn-speed');
	  const autopilotTurnSpeedValue = document.getElementById('autopilot-turn-speed-value');

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
	  const obstacleMapToggle = document.getElementById('obstacle-map-toggle');
	  const propObstacleChanceSlider = document.getElementById('prop-obstacle-chance-slider');
	  const propObstacleChanceValue = document.getElementById('prop-obstacle-chance-value');
	  const propObstacleMarginSlider = document.getElementById('prop-obstacle-margin-slider');
	  const propObstacleMarginValue = document.getElementById('prop-obstacle-margin-value');
	  const rebuildObstaclesButton = document.getElementById('rebuild-obstacles');

  // Advanced settings
  const aiDifficultySlider = document.getElementById('ai-difficulty-slider');
  const aiDifficultyValue = document.getElementById('ai-difficulty-value');
  const monsterRangedToggle = document.getElementById('monster-ranged-toggle');
  const monsterModelsToggle = document.getElementById('monster-models-toggle');
  const respawnEnemiesButton = document.getElementById('respawn-enemies');

  const weaponViewToggle = document.getElementById('weapon-view-toggle');
  const crosshairToggle = document.getElementById('crosshair-toggle');
  const recoilSlider = document.getElementById('weapon-recoil-slider');
  const recoilValue = document.getElementById('weapon-recoil-value');

  const poolFxToggle = document.getElementById('pool-fx-toggle');
  const hdrToggle = document.getElementById('hdr-toggle');
  const crosshairEl = document.getElementById('crosshair');

	  let settingsVisible = false;

	  function rebuildObstacles() {
	    if (!worldState?.applyEnvironmentObstacles || !worldState?.applyPropObstacles) return;
	    worldState.applyEnvironmentObstacles(null);
	    worldState.applyPropObstacles(null);
	    sceneManager?.buildWorldFromGrid?.(worldState);
	  }

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

	  if (obstacleMapToggle) {
	    obstacleMapToggle.addEventListener('change', (e) => {
	      const enabled = e.target.checked;
	      CONFIG.MINIMAP_SHOW_OBSTACLES = enabled;
	      minimap?.setShowObstacles?.(enabled);
	    });
	  }

	  if (propObstacleChanceSlider && propObstacleChanceValue) {
	    propObstacleChanceSlider.addEventListener('input', (e) => {
	      const value = parseFloat(e.target.value);
	      propObstacleChanceValue.textContent = value.toFixed(2);
	      CONFIG.PROP_OBSTACLE_ROOM_CHANCE = value;
	    });
	    propObstacleChanceSlider.addEventListener('change', () => rebuildObstacles());
	  }

	  if (propObstacleMarginSlider && propObstacleMarginValue) {
	    propObstacleMarginSlider.addEventListener('input', (e) => {
	      const value = parseInt(e.target.value, 10);
	      propObstacleMarginValue.textContent = String(value);
	      CONFIG.PROP_OBSTACLE_MARGIN = value;
	    });
	    propObstacleMarginSlider.addEventListener('change', () => rebuildObstacles());
	  }

	  if (rebuildObstaclesButton) {
	    rebuildObstaclesButton.addEventListener('click', () => rebuildObstacles());
	  }

	  autopilotToggle.addEventListener('change', (e) => {
	    CONFIG.AUTOPILOT_ENABLED = e.target.checked;
	  });

  autopilotDelaySlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    autopilotDelayValue.textContent = value.toFixed(1);
    CONFIG.AUTOPILOT_DELAY = value;
  });

  // Autopilot combat controls
  if (autopilotCombatToggle) {
    autopilotCombatToggle.addEventListener('change', (e) => {
      CONFIG.AUTOPILOT_COMBAT_ENABLED = e.target.checked;
    });
  }

  if (autopilotFireRangeSlider && autopilotFireRangeValue) {
    autopilotFireRangeSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      autopilotFireRangeValue.textContent = String(value);
      CONFIG.AUTOPILOT_COMBAT_FIRE_RANGE_TILES = value;
    });
  }

  if (autopilotFireFovSlider && autopilotFireFovValue) {
    autopilotFireFovSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      autopilotFireFovValue.textContent = String(value);
      CONFIG.AUTOPILOT_COMBAT_FOV_DEG = value;
    });
  }

  if (autopilotTurnSpeedSlider && autopilotTurnSpeedValue) {
    autopilotTurnSpeedSlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      autopilotTurnSpeedValue.textContent = value.toFixed(1);
      CONFIG.AUTOPILOT_TURN_SPEED = value;
    });
  }

  // Regenerate map button
  regenerateButton.addEventListener('click', async () => {
    console.log('🔄 Regenerating map...');
    if (typeof hooks.regenerateMap === 'function') {
      await hooks.regenerateMap();
    } else {
      console.warn('⚠️ regenerateMap hook not available');
    }
    console.log('✅ Map regenerated!');
  });

  // AI difficulty
  if (aiDifficultySlider && aiDifficultyValue) {
    aiDifficultySlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      aiDifficultyValue.textContent = value.toFixed(1);
      CONFIG.AI_DIFFICULTY = value;
    });
  }

  if (monsterRangedToggle) {
    monsterRangedToggle.addEventListener('change', (e) => {
      CONFIG.AI_RANGED_GLOBAL_ENABLED = e.target.checked;
    });
  }

  if (monsterModelsToggle) {
    monsterModelsToggle.addEventListener('change', (e) => {
      CONFIG.MONSTER_USE_ASSET_MODELS = e.target.checked;
    });
  }

  if (respawnEnemiesButton) {
    respawnEnemiesButton.addEventListener('click', async () => {
      if (typeof hooks.respawnEnemies === 'function') {
        await hooks.respawnEnemies();
      } else {
        console.warn('⚠️ respawnEnemies hook not available');
      }
    });
  }

  // Weapon
  if (weaponViewToggle) {
    weaponViewToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      CONFIG.PLAYER_WEAPON_VIEW_ENABLED = enabled;
      hooks.weaponView?.setEnabled?.(enabled);
    });
  }

  if (crosshairToggle && crosshairEl) {
    crosshairToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      CONFIG.PLAYER_CROSSHAIR_ENABLED = enabled;
      crosshairEl.classList.toggle('hidden', !enabled);
    });
  }

  if (recoilSlider && recoilValue) {
    recoilSlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      recoilValue.textContent = value.toFixed(1);
      CONFIG.PLAYER_WEAPON_RECOIL = value;
    });
  }

  // Pool / env
  if (poolFxToggle) {
    poolFxToggle.addEventListener('change', (e) => {
      CONFIG.POOL_FX_ENABLED = e.target.checked;
      sceneManager.buildWorldFromGrid(worldState);
    });
  }

  if (hdrToggle) {
    hdrToggle.addEventListener('change', (e) => {
      CONFIG.ENVIRONMENT_HDR_ENABLED = e.target.checked;
      if (sceneManager.refreshEnvironmentMap) {
        sceneManager.refreshEnvironmentMap();
      }
      sceneManager.buildWorldFromGrid(worldState);
    });
  }

	  // Initialize UI from CONFIG
	  mazeSizeSlider.value = CONFIG.MAZE_WIDTH;
	  mazeSizeValue.textContent = CONFIG.MAZE_WIDTH;
	  roomDensitySlider.value = CONFIG.ROOM_DENSITY;
	  roomDensityValue.textContent = CONFIG.ROOM_DENSITY.toFixed(1);
	  missionCountSlider.value = CONFIG.MISSION_POINT_COUNT;
	  missionCountValue.textContent = CONFIG.MISSION_POINT_COUNT;
	  lowPerfToggle.checked = CONFIG.LOW_PERF_MODE;
	  if (obstacleMapToggle) {
	    obstacleMapToggle.checked = CONFIG.MINIMAP_SHOW_OBSTACLES ?? false;
	    minimap?.setShowObstacles?.(obstacleMapToggle.checked);
	  }
	  if (propObstacleChanceSlider && propObstacleChanceValue) {
	    const value = Number.isFinite(CONFIG.PROP_OBSTACLE_ROOM_CHANCE) ? CONFIG.PROP_OBSTACLE_ROOM_CHANCE : 0.12;
	    propObstacleChanceSlider.value = String(value);
	    propObstacleChanceValue.textContent = Number(value).toFixed(2);
	  }
	  if (propObstacleMarginSlider && propObstacleMarginValue) {
	    const value = Number.isFinite(CONFIG.PROP_OBSTACLE_MARGIN) ? CONFIG.PROP_OBSTACLE_MARGIN : 1;
	    propObstacleMarginSlider.value = String(value);
	    propObstacleMarginValue.textContent = String(value);
	  }
	  autopilotToggle.checked = CONFIG.AUTOPILOT_ENABLED ?? false;
	  const autopilotDelay = CONFIG.AUTOPILOT_DELAY ?? 2;
	  autopilotDelaySlider.value = autopilotDelay;
	  autopilotDelayValue.textContent = autopilotDelay.toFixed(1);

  if (autopilotCombatToggle) {
    autopilotCombatToggle.checked = CONFIG.AUTOPILOT_COMBAT_ENABLED ?? true;
  }
  if (autopilotFireRangeSlider && autopilotFireRangeValue) {
    const value = CONFIG.AUTOPILOT_COMBAT_FIRE_RANGE_TILES ?? 12;
    autopilotFireRangeSlider.value = value;
    autopilotFireRangeValue.textContent = String(value);
  }
  if (autopilotFireFovSlider && autopilotFireFovValue) {
    const value = CONFIG.AUTOPILOT_COMBAT_FOV_DEG ?? 110;
    autopilotFireFovSlider.value = value;
    autopilotFireFovValue.textContent = String(value);
  }
  if (autopilotTurnSpeedSlider && autopilotTurnSpeedValue) {
    const value = CONFIG.AUTOPILOT_TURN_SPEED ?? 3.0;
    autopilotTurnSpeedSlider.value = value;
    autopilotTurnSpeedValue.textContent = value.toFixed(1);
  }

  // Init advanced UI from CONFIG
  if (aiDifficultySlider && aiDifficultyValue) {
    aiDifficultySlider.value = CONFIG.AI_DIFFICULTY ?? 1.0;
    aiDifficultyValue.textContent = (CONFIG.AI_DIFFICULTY ?? 1.0).toFixed(1);
  }
  if (monsterRangedToggle) {
    monsterRangedToggle.checked = CONFIG.AI_RANGED_GLOBAL_ENABLED ?? true;
  }
  if (monsterModelsToggle) {
    monsterModelsToggle.checked = CONFIG.MONSTER_USE_ASSET_MODELS ?? true;
  }

  if (weaponViewToggle) {
    weaponViewToggle.checked = CONFIG.PLAYER_WEAPON_VIEW_ENABLED ?? true;
  }
  if (crosshairToggle && crosshairEl) {
    crosshairToggle.checked = CONFIG.PLAYER_CROSSHAIR_ENABLED ?? true;
    crosshairEl.classList.toggle('hidden', !(CONFIG.PLAYER_CROSSHAIR_ENABLED ?? true));
  }
  if (recoilSlider && recoilValue) {
    recoilSlider.value = CONFIG.PLAYER_WEAPON_RECOIL ?? 1.0;
    recoilValue.textContent = (CONFIG.PLAYER_WEAPON_RECOIL ?? 1.0).toFixed(1);
  }

  if (poolFxToggle) {
    poolFxToggle.checked = CONFIG.POOL_FX_ENABLED ?? true;
  }
  if (hdrToggle) {
    hdrToggle.checked = CONFIG.ENVIRONMENT_HDR_ENABLED ?? true;
  }
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
    player.setPosition(
      spawn.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      CONFIG.PLAYER_HEIGHT,
      spawn.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
    );
    console.log('🔧 DEBUG: Teleported to spawn');
  });

  document.getElementById('debug-tp-exit').addEventListener('click', () => {
    const exit = exitPoint.getGridPosition();
    player.setPosition(
      exit.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      CONFIG.PLAYER_HEIGHT,
      exit.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
    );
    console.log('🔧 DEBUG: Teleported to exit');
  });

  document.getElementById('debug-tp-random').addEventListener('click', () => {
    const random = worldState.findRandomWalkableTile();
    player.setPosition(
      random.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      CONFIG.PLAYER_HEIGHT,
      random.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
    );
    console.log('🔧 DEBUG: Teleported to random location');
  });

  document.getElementById('debug-tp-monster').addEventListener('click', () => {
    const monsters = monsterManager.getMonsters();
    if (monsters.length > 0) {
      const monsterPos = monsters[0].getGridPosition();
      player.setPosition(
        monsterPos.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        CONFIG.PLAYER_HEIGHT,
        monsterPos.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
      console.log('🔧 DEBUG: Teleported to monster');
    }
  });

  document.getElementById('debug-tp-custom').addEventListener('click', () => {
    const x = parseInt(document.getElementById('debug-tp-x').value);
    const y = parseInt(document.getElementById('debug-tp-y').value);
    if (!isNaN(x) && !isNaN(y) && worldState.isWalkable(x, y)) {
      player.setPosition(
        x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        CONFIG.PLAYER_HEIGHT,
        y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
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
    gameState.win('Forced win (debug)');
    console.log('🔧 DEBUG: Forced win');
  });

  document.getElementById('debug-lose').addEventListener('click', () => {
    gameState.lose('Forced loss (debug)');
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
