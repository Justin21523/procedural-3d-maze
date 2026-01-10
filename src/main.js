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
import { WorldMarkerSystem } from './rendering/worldMarkerSystem.js';
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
import { InventorySystem } from './core/inventorySystem.js';
import { NoiseBridgeSystem } from './core/noiseBridgeSystem.js';
import { ToolSystem } from './core/toolSystem.js';
import { UIManager } from './ui/uiManager.js';
import { HomeMenu } from './ui/homeMenu.js';
import { CampaignManager } from './core/campaignManager.js';
import { SaveManager } from './core/saveManager.js';
import { InteractableSystem } from './core/interactions/interactableSystem.js';
import { HidingSpotSystem } from './core/interactions/hidingSpotSystem.js';
import { MissionDirector } from './core/missions/missionDirector.js';
import { WorldStateEffectsSystem } from './core/worldStateEffectsSystem.js';

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
	  const minimapCanvas = document.getElementById('minimap');
	  const minimapViewport = document.getElementById('minimap-viewport');
	  const minimapToggle = document.getElementById('minimap-toggle');
	  const minimapSizeSlider = document.getElementById('minimap-size');
	  const minimapSizeValue = document.getElementById('minimap-size-value');
	  const minimapZoomSlider = document.getElementById('minimap-zoom');
	  const minimapZoomValue = document.getElementById('minimap-zoom-value');
	  const minimapResetButton = document.getElementById('minimap-reset');
  const levelLabel = document.getElementById('level-label');
  const hudLevelEl = document.getElementById('hud-level');
  const hudCampaignEl = document.getElementById('hud-campaign');
  const homeCampaignInfoEl = document.getElementById('home-campaign-info');
  const campaignVictoryEl = document.getElementById('campaign-victory');
  const campaignVictoryTitleEl = document.getElementById('campaign-victory-title');
  const campaignVictorySummaryEl = document.getElementById('campaign-victory-summary');
  const campaignVictoryTableEl = document.getElementById('campaign-victory-table');
  const campaignNewButton = document.getElementById('campaign-new-button');
  const campaignMenuButton = document.getElementById('campaign-menu-button');
  const levelPrevBtn = document.getElementById('level-prev');
  const levelNextBtn = document.getElementById('level-next');
  const levelJumpInput = document.getElementById('level-jump-input');
  const levelJumpBtn = document.getElementById('level-jump-btn');
  const restartLevelBtn = document.getElementById('restart-level');
  const restartFirstBtn = document.getElementById('restart-first');
	  const levelDebugSourceEl = document.getElementById('level-debug-source');
	  const levelDebugObjectiveEl = document.getElementById('level-debug-objective');
	  const levelDebugNextEl = document.getElementById('level-debug-next');
	  const levelDebugExitEl = document.getElementById('level-debug-exit');
	  const levelDebugStealthEl = document.getElementById('level-debug-stealth');
	  const levelDebugInventoryEl = document.getElementById('level-debug-inventory');
	  const reloadLevelsBtn = document.getElementById('reload-levels');
	  const hudNextInteractEl = document.getElementById('hud-next-interact');
	  const hudExitUnlockedEl = document.getElementById('hud-exit-unlocked');
	  const hudObjectiveTimerEl = document.getElementById('hud-objective-timer');

  // Debug: Check if elements exist
  console.log('DOM Elements check:');
  console.log('  canvas-container:', container ? '✓' : '✗');
  console.log('  instructions:', instructionsOverlay ? '✓' : '✗');
  console.log('  minimap canvas:', minimapCanvas ? '✓' : '✗');
  if (minimapCanvas) {
    console.log(`  minimap size: ${minimapCanvas.width}x${minimapCanvas.height}`);
  }

  // Multi-level state (loaded from public/levels/*.json, with src/core/levelCatalog.js fallback)
  let levelDirector = await LevelDirector.createFromPublic({
    manifestUrl: '/levels/manifest.json',
    fallbackLevels: LEVEL_CATALOG
  });

  // Campaign state (10 authored levels)
  const campaignLevelCount = Math.max(1, Math.min(10, levelDirector.getLevelCount?.() || 10));
  const campaignManager = new CampaignManager({ levelCount: campaignLevelCount, failureLimit: 2 });
  let campaignState = campaignManager.load();
  const saveManager = new SaveManager();

  let currentLevelIndex = clampLevelIndex(campaignState?.run?.currentLevelIndex ?? 0);
  let levelConfig = levelDirector.getLevelConfig(currentLevelIndex);
  let missionDirector = null;
  let interactableSystem = null;
  let hidingSpotSystem = null;
  let exitPoint = null;
  let autopilot = null;
  let pickupManager = null;
  let spawnDirector = null;
  let noiseBridgeSystem = null;
  let toolSystem = null;
  let worldMarkerSystem = null;
  let levelLoading = Promise.resolve();
  let lastOutcome = null;
  let lastRunStats = null;
  let minimapHidden = false;
  let hasRunStarted = false;
  let homeMenu = null;

  function getCampaignLevelCount() {
    return campaignManager.levelCount;
  }

  function renderCampaignInfo() {
    const run = campaignState?.run || {};
    const levelCount = getCampaignLevelCount();
    const failures = run.failures ?? 0;
    const limit = run.failureLimit ?? 2;
    const nextRaw = Math.round(Number(run.currentLevelIndex ?? 0));
    const isComplete = nextRaw >= levelCount && campaignManager.isComplete(campaignState);
    const nextPlayable = isComplete ? (levelCount - 1) : clampLevelIndex(nextRaw);
    const completed = campaignManager.computeSummary(campaignState).completedLevels || 0;
    const nextLevelConfig = levelDirector?.getLevelConfig ? levelDirector.getLevelConfig(nextPlayable) : null;
    const nextName = nextLevelConfig?.name ? String(nextLevelConfig.name) : `L${nextPlayable + 1}`;

    if (hudCampaignEl) {
      hudCampaignEl.textContent = isComplete
        ? `Campaign Complete • Failures ${failures}/${limit}`
        : `Campaign ${Math.min(nextPlayable + 1, levelCount)}/${levelCount} • Failures ${failures}/${limit}`;
    }

    if (homeCampaignInfoEl) {
      const last = campaignState?.lastRunSummary;
      const lastLine = last
        ? `Last run: ${last.completedLevels}/${levelCount} cleared • Avg ${last.averages?.timeFormatted || '00:00'} • Score ${Math.round(last.averages?.score || 0)}`
        : 'Last run: —';
      homeCampaignInfoEl.textContent =
        (isComplete ? `Next: Campaign complete (open Victory screen)\n` : `Next: ${nextName} (${nextPlayable + 1}/${levelCount})\n`) +
        `Progress: ${completed}/${levelCount} cleared • Failures ${failures}/${limit}\n` +
        `${lastLine}`;
    }
  }

  function clampLevelIndex(idx) {
    const n = Math.round(Number(idx));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(getCampaignLevelCount() - 1, n));
  }

  function showCampaignSummary(summary, title = '🏆 Campaign Summary') {
    if (!campaignVictoryEl) return;
    if (campaignVictoryTitleEl) campaignVictoryTitleEl.textContent = String(title || '🏆 Campaign Summary');
    if (campaignVictorySummaryEl) {
      const avg = summary.averages || {};
      campaignVictorySummaryEl.textContent =
        `Cleared ${summary.completedLevels}/${summary.levelCount} levels • Failures ${summary.failures}/${summary.failureLimit}\n` +
        `Avg Time ${avg.timeFormatted || '00:00'} • Avg Steps ${Math.round(avg.steps || 0)} • Avg Rooms ${Math.round(avg.roomsVisited || 0)} • Weighted Score ${Math.round(avg.score || 0)}`;
    }
    if (campaignVictoryTableEl) {
      const rows = summary.completed || [];
      const header =
        `<div style="display:grid; grid-template-columns: 60px 1fr 120px 90px 90px 90px; gap: 8px; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.82); font-size: 12px;">` +
        `<div>#</div><div>Level</div><div>Time</div><div>Steps</div><div>Rooms</div><div>Score</div></div>`;
      const body = rows.map((r) => {
        return `<div style="display:grid; grid-template-columns: 60px 1fr 120px 90px 90px 90px; gap: 8px; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.92); font-size: 13px;">` +
          `<div>${r.levelIndex + 1}</div>` +
          `<div>${escapeHtml(r.name)}</div>` +
          `<div>${escapeHtml(r.timeFormatted)}</div>` +
          `<div>${r.steps}</div>` +
          `<div>${r.roomsVisited}</div>` +
          `<div>${r.score}</div>` +
          `</div>`;
      }).join('');
      campaignVictoryTableEl.innerHTML = header + body;
    }

    campaignVictoryEl.classList.remove('hidden');
  }

  function showCampaignVictory() {
    const summary = campaignManager.computeSummary(campaignState);
    showCampaignSummary(summary, '🏆 Campaign Complete!');
  }

  function hideCampaignVictory() {
    campaignVictoryEl?.classList.add('hidden');
  }

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

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
	    const nextInteractId = state?.objective?.nextInteractId || '';
	    const exitUnlocked = state ? (state.exitUnlocked !== false) : (gameState?.exitUnlocked !== false);
	    const remaining = Number(state?.objective?.progress?.remaining);

	    if (levelDebugObjectiveEl) {
	      levelDebugObjectiveEl.textContent = objectiveText || '—';
	    }
    if (levelDebugNextEl) {
      levelDebugNextEl.textContent = nextInteractId ? String(nextInteractId) : '—';
    }
	    if (levelDebugExitEl) {
	      levelDebugExitEl.textContent = exitUnlocked ? 'Yes' : 'No';
	    }

	    if (hudNextInteractEl) {
	      hudNextInteractEl.textContent = nextInteractId ? String(nextInteractId) : '—';
	    }
	    if (hudExitUnlockedEl) {
	      hudExitUnlockedEl.textContent = exitUnlocked ? 'Yes' : 'No';
	      hudExitUnlockedEl.style.color = exitUnlocked ? '#66ff99' : '#ff6666';
	    }
	    if (hudObjectiveTimerEl) {
	      if (Number.isFinite(remaining)) {
	        hudObjectiveTimerEl.textContent = `${Math.ceil(Math.max(0, remaining))}s`;
	        hudObjectiveTimerEl.style.color = remaining > 0 ? '#ffd700' : '#66ff99';
	      } else {
	        hudObjectiveTimerEl.textContent = '—';
	        hudObjectiveTimerEl.style.color = '#cccccc';
	      }
	    }

	    let stealthText = '—';
	    if (state?.objective?.template === 'stealthNoise') {
	      stealthText = Number.isFinite(remaining) ? `${Math.ceil(remaining)}s` : '—';
	    }
	    if (levelDebugStealthEl) {
	      levelDebugStealthEl.textContent = stealthText;
	    }

    if (levelDebugInventoryEl && gameState?.getInventorySnapshot) {
      const snap = gameState.getInventorySnapshot() || {};
      const keys = Object.keys(snap);
      if (keys.length === 0) {
        levelDebugInventoryEl.textContent = '—';
      } else {
        const preferred = ['fuse', 'evidence', 'power_on'];
        keys.sort((a, b) => {
          const ia = preferred.indexOf(a);
          const ib = preferred.indexOf(b);
          if (ia !== -1 || ib !== -1) {
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          }
          return a.localeCompare(b);
        });
        const parts = [];
        for (const k of keys) {
          const v = snap[k];
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n <= 0) continue;
          parts.push(`${k}:${n}`);
        }
        levelDebugInventoryEl.textContent = parts.length > 0 ? parts.join(', ') : '—';
      }
    }
  }

  function updateLevelUI() {
    const label = `${levelConfig.name || 'Endless'} (L${currentLevelIndex + 1})`;
    if (levelLabel) {
      levelLabel.textContent = label;
    }
    if (hudLevelEl) {
      hudLevelEl.textContent = label;
    }
    if (hudCampaignEl) {
      renderCampaignInfo();
    }
    if (levelJumpInput) {
      const maxJump = levelDirector.getMaxJump();
      levelJumpInput.max = Number.isFinite(maxJump) ? String(maxJump) : '';
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
	  const MINIMAP_RENDER_SIZE = 240;
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
	  let initialMinimapSize = DEFAULT_MINIMAP_SIZE;
	  const storedSize = clampMinimapSize(parseInt(safeStorageGet(MINIMAP_STORAGE_SIZE) || '', 10));
	  initialMinimapSize = storedSize ?? DEFAULT_MINIMAP_SIZE;

	  let initialMinimapZoom = DEFAULT_MINIMAP_ZOOM;
	  const storedZoom = clampMinimapZoom(parseFloat(safeStorageGet(MINIMAP_STORAGE_ZOOM) || ''));
	  initialMinimapZoom = storedZoom ?? DEFAULT_MINIMAP_ZOOM;

	  if (minimapCanvas) {
	    minimapCanvas.width = MINIMAP_RENDER_SIZE;
	    minimapCanvas.height = MINIMAP_RENDER_SIZE;
	    minimap.resize(MINIMAP_RENDER_SIZE);
	    minimap.setZoom(initialMinimapZoom);
	  }
	  if (minimapViewport) {
	    minimapViewport.style.width = `${initialMinimapSize}px`;
	    minimapViewport.style.height = `${initialMinimapSize}px`;
	  } else if (minimapCanvas) {
	    minimapCanvas.style.width = `${initialMinimapSize}px`;
	    minimapCanvas.style.height = `${initialMinimapSize}px`;
	  }

	  function ensureMinimapVisibleForAdjust() {
	    const viewport = minimapViewport || minimapCanvas;
	    if (!viewport) return;
	    if (!minimapHidden) return;
	    minimapHidden = false;
	    viewport.style.display = 'block';
	    const controls = document.getElementById('minimap-controls');
	    if (controls) controls.style.display = 'block';
	    if (minimapToggle) minimapToggle.textContent = 'Hide';
	  }

	  function applyMinimapSize(size) {
	    ensureMinimapVisibleForAdjust();
	    const clamped = clampMinimapSize(size) ?? clampMinimapSize(minimapCanvas?.width) ?? DEFAULT_MINIMAP_SIZE;
	    if (minimapViewport) {
	      minimapViewport.style.width = `${clamped}px`;
	      minimapViewport.style.height = `${clamped}px`;
	    } else if (minimapCanvas) {
	      minimapCanvas.style.width = `${clamped}px`;
	      minimapCanvas.style.height = `${clamped}px`;
	    }
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
	      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
        {
          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
          devicePositions: toolSystem?.getDeviceMarkers?.() || []
        }
	    );
	    return clamped;
	  }

  // Create input handler
  const input = new InputHandler();
  console.log('Input handler created');

  // Create game state manager
  const gameState = new GameState(eventBus);
  console.log('🎮 Game state created');

  const inventorySystem = new InventorySystem({ eventBus, gameState });
  void inventorySystem;

  const worldStateEffectsSystem = new WorldStateEffectsSystem({
    eventBus,
    gameState,
    lights,
    audioManager,
    powerOffMultiplier: CONFIG.POWER_OFF_LIGHT_MULTIPLIER
  });

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
  monsterManager.setAudioManager?.(audioManager);
  noiseBridgeSystem = new NoiseBridgeSystem({ eventBus, monsterManager });
  void noiseBridgeSystem;
  toolSystem = new ToolSystem({
    eventBus,
    scene: sceneManager.getScene(),
    worldState,
    player,
    monsterManager,
    gameState,
    audioManager
  });
  toolSystem.startLevel(levelConfig);

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
    monsterManager,
    scene: sceneManager.getScene(),
    gameState,
    exitPoint,
    interactableSystem
  });
  missionDirector.startLevel(levelConfig);

  hidingSpotSystem = new HidingSpotSystem({
    eventBus,
    worldState,
    scene: sceneManager.getScene(),
    interactableSystem,
    player
  });
  hidingSpotSystem.startLevel(levelConfig);

  worldStateEffectsSystem.startLevel(levelConfig);
  eventBus.on(EVENTS.MISSION_UPDATED, () => updateLevelDebugUI());
  eventBus.on(EVENTS.INVENTORY_UPDATED, () => updateLevelDebugUI());
  updateLevelDebugUI();

  // Autopilot placeholder（會在 loadLevel 時重新建立）
  autopilot = new AutoPilot(
    worldState,
    monsterManager,
    () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
    exitPoint,
    player,
    levelConfig,
    () => (pickupManager?.getPickupMarkers?.() || [])
  );

	  const projectileManager = new ProjectileManager(
	    sceneManager.getScene(),
	    worldState,
	    monsterManager,
	    player,
	    eventBus
	  );

	  monsterManager.setProjectileManager(projectileManager);
	  toolSystem?.setRefs?.({ projectileManager, audioManager });

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

  // Live meta updates (from Meta Preview page) for weapon view tuning.
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const metaChannel = new BroadcastChannel('p3dm-meta');
      metaChannel.onmessage = (ev) => {
        const msg = ev?.data || null;
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'weapon') {
          void gun.reloadWeaponMetaOverrides?.();
        }
      };
    }
  } catch (err) {
    void err;
  }

  const uiManager = new UIManager({
    eventBus,
    player,
    worldState,
    gameState,
    gun,
    monsterManager,
    projectileManager,
    toolSystem,
    missionDirector,
    sceneManager
  });
  missionDirector?.syncStatus?.(true);

		  pickupManager = new PickupManager(sceneManager.getScene(), player, gameState, gun, audioManager, eventBus);
		  uiManager?.setRefs?.({ pickupManager });
		  spawnDirector = new SpawnDirector(monsterManager, player, pickupManager, eventBus);
		  spawnDirector.setGameState(gameState);
		  spawnDirector.setGun(gun);
		  spawnDirector.setProjectileManager?.(projectileManager);
		  levelLoading = spawnDirector.startLevel(levelConfig);

	  worldMarkerSystem = new WorldMarkerSystem({
	    eventBus,
	    scene: sceneManager.getScene(),
	    camera,
	    player,
	    worldState,
	    pickupManager,
	    toolSystem,
	    missionDirector,
	    exitPoint
	  });

	  // Combat resolution (damage/explosions) driven by EventBus.
	  const combatSystem = new CombatSystem({
	    eventBus,
	    monsterManager,
    projectileManager,
    playerRef: player,
    gameState,
    audioManager
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
    toolSystem,
    uiManager,
	    interactableSystem,
	    missionDirector
	  );
	  gameLoop.worldMarkerSystem = worldMarkerSystem;

  // Combat feedback (hit marker + light shake/flash) driven by EventBus
  const feedbackSystem = new FeedbackSystem(eventBus, audioManager, gameLoop?.visualEffects || null);
  void feedbackSystem;

  // Render initial minimap (before game starts)
  console.log('🗺️ Rendering initial minimap...');
  minimap.render(
    player.getGridPosition(),
    monsterManager.getMonsterPositions(),
    exitGridPos,
    missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
    {
      pickupPositions: pickupManager?.getPickupMarkers?.() || [],
      devicePositions: toolSystem?.getDeviceMarkers?.() || []
    }
  );
  console.log('✅ Initial minimap rendered');
  updateLevelUI();
  renderCampaignInfo();

  if (campaignNewButton) {
    campaignNewButton.addEventListener('click', () => {
      void resetCampaign('New campaign started. Configure settings, then start.');
    });
  }
  if (campaignMenuButton) {
    campaignMenuButton.addEventListener('click', () => {
      hideCampaignVictory();
      homeMenu?.setVisible?.(true);
      homeMenu?.setActiveTab?.('play');
    });
  }

  // Home menu: mount panels into tabs (keeps gameplay HUD clean).
  const homeMountSettings = document.getElementById('home-mount-settings');
  const homeMountLevel = document.getElementById('home-mount-level');
  const homeMountDebug = document.getElementById('home-mount-debug');
  const settingsPanelEl = document.getElementById('settings-panel');
  const levelPanelEl = document.getElementById('level-panel');
  const debugPanelEl = document.getElementById('debug-panel');

  if (homeMountSettings && settingsPanelEl) {
    homeMountSettings.appendChild(settingsPanelEl);
    settingsPanelEl.classList.remove('hidden');
  }
  if (homeMountLevel && levelPanelEl) {
    homeMountLevel.appendChild(levelPanelEl);
    levelPanelEl.classList.remove('hidden');
  }
  if (homeMountDebug && debugPanelEl) {
    homeMountDebug.appendChild(debugPanelEl);
  }

  homeMenu = new HomeMenu({
    root: instructionsOverlay,
    onStartNew: () => void startNewRun(),
    onContinue: () => {
      if (hasRunStarted && !gameState?.gameOver) {
        void continueRun();
        return;
      }
      if (saveManager.hasSave()) {
        void loadSavedGame();
        return;
      }
      homeMenu?.setStatus?.('No active run or save found.');
    },
    onRestart: () => void restartRun(),
    onAbandon: () => void abandonRun(),
    onRestartCampaign: () => void resetCampaign('Campaign restarted. Configure settings, then start.'),
    onSave: () => saveGame(),
    onLoadSave: () => void loadSavedGame(),
    onClearSave: () => clearSavedGame()
  });
  homeMenu.setActiveTab('play');
  homeMenu.setVisible(true);
  homeMenu.setCanContinue(saveManager.hasSave(), saveManager.hasSave() ? '' : 'No active run or save yet');
  homeMenu.setCanRestart(false, 'No active run yet');
  homeMenu.setCanAbandon(false, 'No active run yet');
  homeMenu.setStatus('Configure settings, then start.');
  homeMenu.setCanSave(false, 'Start a run first');
  homeMenu.setCanLoadSave(saveManager.hasSave(), 'No save found');
  homeMenu.setCanClearSave(saveManager.hasSave(), 'No save found');
  homeMenu.setSaveInfo(saveManager.hasSave() ? 'Save found. You can load it any time from here.' : 'No save found yet.');

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
      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
      {
        pickupPositions: pickupManager?.getPickupMarkers?.() || [],
        devicePositions: toolSystem?.getDeviceMarkers?.() || []
      }
    );
    return clamped;
  }

	  if (minimapSizeSlider) {
	    const initSize = clampMinimapSize(initialMinimapSize) ?? DEFAULT_MINIMAP_SIZE;
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
        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
        {
          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
          devicePositions: toolSystem?.getDeviceMarkers?.() || []
        }
      );
    });
  }

	  if (minimapToggle) {
	    minimapToggle.addEventListener('click', () => {
	      minimapHidden = !minimapHidden;
	      const viewport = minimapViewport || minimapCanvas;
	      if (viewport) {
	        viewport.style.display = minimapHidden ? 'none' : 'block';
	      }
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
      currentLevelIndex = clampLevelIndex(levelIndex);
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
      hidingSpotSystem?.clear?.();
      interactableSystem?.clear?.();
      toolSystem?.clear?.();

      // 更新血量上限
      if (resetGameState && gameState) {
        const maxHp = Math.round(100 * (levelConfig.player?.maxHealthMultiplier ?? 1));
        gameState.maxHealth = maxHp;
      }

      // 重建世界
      worldState.initialize(levelConfig);
      sceneManager.buildWorldFromGrid(worldState);
	      toolSystem?.setRefs?.({
	        eventBus,
	        scene: sceneManager.getScene(),
	        worldState,
	        player,
	        monsterManager,
	        gameState,
	        projectileManager,
	        audioManager
	      });
      toolSystem?.startLevel?.(levelConfig);

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
	      worldMarkerSystem?.setRefs?.({
	        eventBus,
	        scene: sceneManager.getScene(),
	        camera,
	        player,
	        worldState,
	        pickupManager,
	        toolSystem,
	        missionDirector,
	        exitPoint
	      });

      if (hidingSpotSystem) {
        hidingSpotSystem.setRefs({
          worldState,
          scene: sceneManager.getScene(),
          interactableSystem,
          eventBus,
          player
        });
        hidingSpotSystem.startLevel(levelConfig);
      }
      worldStateEffectsSystem?.startLevel?.(levelConfig);
      gameLoop.missionDirector = missionDirector;
      gameLoop.interactableSystem = interactableSystem;

      // Hide overlays when entering gameplay.
      document.getElementById('game-over').classList.add('hidden');
      if (startLoop) {
        homeMenu?.setVisible?.(false);
        hasRunStarted = true;
        homeMenu?.setCanContinue?.(true);
        homeMenu?.setCanRestart?.(true);
      }

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
        levelConfig,
        () => (pickupManager?.getPickupMarkers?.() || [])
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
        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
        {
          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
          devicePositions: toolSystem?.getDeviceMarkers?.() || []
        }
      );

      if (startLoop) {
        campaignState = campaignManager.recordAttempt(campaignState, currentLevelIndex);
        renderCampaignInfo();
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
    campaignState = campaignManager.recordWin(campaignState, currentLevelIndex, levelConfig, lastRunStats);
    renderCampaignInfo();

    const levelCount = getCampaignLevelCount();
    const completedAll = campaignState?.run?.currentLevelIndex >= levelCount;
    if (completedAll) {
      clearAutoGameOverTimer();
      document.getElementById('game-over')?.classList.add('hidden');
      input.exitPointerLock();
      gameLoop.stop();
      showCampaignVictory();
      return;
    }
    startAutoGameOverCountdown('win', () => {
      if (!gameState?.gameOver || !gameState?.hasWon) return;
      void loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
    });
  };
  gameLoop.onLose = () => {
    lastOutcome = 'lose';
    lastRunStats = gameState.getStats();
    applyGameOverButtons(false);
    const prevFailures = campaignState?.run?.failures ?? 0;
    campaignState = campaignManager.recordLoss(campaignState, currentLevelIndex, levelConfig, lastRunStats);
    renderCampaignInfo();

    const resetTriggered =
      (prevFailures + 1 >= (campaignState?.lastRunSummary?.failureLimit ?? 2)) &&
      (campaignState?.run?.failures ?? 0) === 0 &&
      campaignState?.lastRunSummary?.endReason === 'failureLimit';

    if (resetTriggered) {
      clearAutoGameOverTimer();
      document.getElementById('game-over')?.classList.add('hidden');
      input.exitPointerLock();
      gameLoop.stop();
      hasRunStarted = false;

      currentLevelIndex = 0;
      levelConfig = levelDirector.getLevelConfig(0);
      updateLevelUI();

    homeMenu?.setActiveTab?.('play');
    homeMenu?.setCanContinue?.(false, 'No active run');
    homeMenu?.setCanRestart?.(false, 'No active run');
    homeMenu?.setCanAbandon?.(false, 'No active run');
    homeMenu?.setStatus?.('Reached 2 failures → campaign reset to Level 1.');
    homeMenu?.setVisible?.(true);
    return;
  }

    startAutoGameOverCountdown('lose', () => {
      if (!gameState?.gameOver || !gameState?.hasLost) return;
      // If we hit the failure limit, CampaignManager already reset the run to level 1.
      const nextIdx = clampLevelIndex(campaignState?.run?.currentLevelIndex ?? 0);
      void loadLevel(nextIdx, { startLoop: true, resetGameState: true });
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
      const raw = parseInt(levelJumpInput.value, 10) || 1;
      const maxJump = levelDirector.getMaxJump();
      const max = Number.isFinite(maxJump) ? maxJump : Infinity;
      const target = Math.max(1, Math.min(max, raw));
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
      // "Go to L1" should actually restart the campaign, not just load level 1
      // with old progress still marked as cleared/complete.
      clearAutoGameOverTimer();
      document.getElementById('game-over')?.classList.add('hidden');
      hideCampaignVictory();

      saveManager?.clear?.();
      campaignState = campaignManager.startNewRun(campaignState);
      renderCampaignInfo();

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

  // Click canvas to re-lock pointer (only during active gameplay)
  container.addEventListener('click', () => {
    if (!document.body.classList.contains('mode-game')) return;
    if (!instructionsOverlay?.classList.contains('hidden')) return;
    if (gameState?.gameOver) return;
    if (gameLoop?.running !== true) return;
    if (input?.requestPointerLock) {
      input.requestPointerLock(container);
      console.log('🖱️ Click detected, requesting pointer lock');
    }
  });

  async function startNewRun() {
    console.log('🎮 Home: start campaign run');
    clearAutoGameOverTimer();
    document.getElementById('game-over')?.classList.add('hidden');

    if (campaignManager.isComplete(campaignState)) {
      showCampaignVictory();
      return;
    }

    homeMenu.setStatus('Starting…');
    homeMenu.setVisible(false);

    input.resetState?.();
    input.requestPointerLock(container);
    audioManager.playAmbient();
    await loadLevel(clampLevelIndex(campaignState?.run?.currentLevelIndex ?? 0), { startLoop: true, resetGameState: true });

    homeMenu.setCanContinue(true);
    homeMenu.setCanRestart(true);
    homeMenu.setCanAbandon(true);
    homeMenu.setCanSave(true);
    homeMenu.setStatus('');
    input.requestPointerLock(container);
  }

  async function continueRun() {
    if (!hasRunStarted || gameState?.gameOver) return;
    console.log('▶️ Home: continue');
    homeMenu.setVisible(false);
    gameState?.resumeTimer?.();
    audioManager.playAmbient();
    gameLoop.start();
    input.requestPointerLock(container);
  }

  function resetCampaign(statusText) {
    // Reset progress AND avoid old saves restoring a completed run.
    saveManager?.clear?.();
    campaignState = campaignManager.startNewRun(campaignState);
    hideCampaignVictory();
    renderCampaignInfo();

    clearAutoGameOverTimer();
    input.exitPointerLock();
    input.resetState?.();
    gameLoop.stop();
    gameLoop.resetRoundState?.();

    // Keep gameState intact for debugging if it exists, but make sure we're not in a "game over" overlay.
    document.getElementById('game-over')?.classList.add('hidden');
    gameState?.reset?.();
    hasRunStarted = false;

    currentLevelIndex = 0;
    levelConfig = levelDirector.getLevelConfig(0);
    updateLevelUI();

    homeMenu?.setActiveTab?.('play');
    homeMenu?.setVisible?.(true);
    homeMenu?.setCanContinue?.(false, 'No active run or save yet');
    homeMenu?.setCanRestart?.(false, 'No active run');
    homeMenu?.setCanAbandon?.(false, 'No active run');
    homeMenu?.setCanSave?.(false, 'Start a run first');
    homeMenu?.setCanLoadSave?.(saveManager.hasSave(), 'No save found');
    homeMenu?.setCanClearSave?.(saveManager.hasSave(), 'No save found');
    homeMenu?.setSaveInfo?.('Save cleared for new campaign.');
    homeMenu?.setStatus?.(statusText || 'Campaign restarted.');
  }

  function buildSavePayload() {
    const pos = player.getPosition();
    const yaw = typeof camera.getYaw === 'function' ? camera.getYaw() : 0;
    const pitch = typeof camera.getPitch === 'function' ? camera.getPitch() : 0;
    const exitGrid = exitPoint?.getGridPosition?.() || worldState.getExitPoint();
    if (exitGrid) {
      worldState.exitPoint = { x: exitGrid.x, y: exitGrid.y };
    }

    return {
      version: 1,
      savedAtMs: Date.now(),
      campaignState,
      currentLevelIndex,
      levelId: levelConfig?.id ?? null,
      world: worldState.toSaveData(),
      player: {
        position: [pos.x, pos.y, pos.z],
        yaw,
        pitch
      },
      gameState: gameState.toSaveData(),
      gun: gun?.toSaveData?.() || null
    };
  }

  function saveGame() {
    if (!hasRunStarted) {
      homeMenu?.setStatus?.('No active run to save.');
      return;
    }
    const payload = buildSavePayload();
    const ok = saveManager.save(payload);
    if (!ok) {
      console.warn('⚠️ Save failed (storage quota blocked?)');
    }
    homeMenu?.setCanLoadSave?.(saveManager.hasSave());
    homeMenu?.setCanClearSave?.(saveManager.hasSave());
    homeMenu?.setSaveInfo?.(ok ? `Saved at ${new Date(payload.savedAtMs).toLocaleString()}` : 'Save failed (storage blocked).');
    if (ok) homeMenu?.setStatus?.('Saved.');
  }

  function clearSavedGame() {
    const ok = saveManager.clear();
    homeMenu?.setCanLoadSave?.(saveManager.hasSave(), 'No save found');
    homeMenu?.setCanClearSave?.(saveManager.hasSave(), 'No save found');
    homeMenu?.setSaveInfo?.(ok ? 'Save deleted.' : 'Delete failed.');
  }

  async function loadSavedGame() {
    const save = saveManager.load();
    if (!save) {
      homeMenu?.setStatus?.('No save found.');
      homeMenu?.setCanLoadSave?.(false, 'No save found');
      homeMenu?.setCanClearSave?.(false, 'No save found');
      return;
    }

    homeMenu?.setStatus?.('Loading save…');
    homeMenu?.setVisible?.(false);
    clearAutoGameOverTimer();
    document.getElementById('game-over')?.classList.add('hidden');

    // Campaign metadata
    if (save.campaignState && typeof save.campaignState === 'object') {
      campaignState = save.campaignState;
      campaignManager.save(campaignState);
      renderCampaignInfo();
    }

    // Stop the current loop and clear round state
    gameLoop.stop();
    gameLoop.resetRoundState();

    // Clear previous level objectives/interactables before rebuilding the scene
    missionDirector?.clear?.();
    hidingSpotSystem?.clear?.();
    interactableSystem?.clear?.();
    toolSystem?.clear?.();

    currentLevelIndex = clampLevelIndex(save.currentLevelIndex ?? 0);
    levelConfig = levelDirector.getLevelConfig(currentLevelIndex, lastRunStats, lastOutcome);
    updateLevelUI();

    // Rebuild world from save data
    const okWorld = worldState.applySaveData(save.world, levelConfig);
    if (!okWorld) {
      homeMenu?.setVisible?.(true);
      homeMenu?.setStatus?.('Save data is incompatible; starting fresh level instead.');
      await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
      return;
    }
    sceneManager.buildWorldFromGrid(worldState);

    toolSystem?.setRefs?.({
      eventBus,
      scene: sceneManager.getScene(),
      worldState,
      player,
      monsterManager,
      gameState,
      projectileManager,
      audioManager
    });
    toolSystem?.startLevel?.(levelConfig);

    // Exit point (use saved/cached value)
    const ep = worldState.getExitPoint();
    if (exitPoint) {
      sceneManager.getScene().remove(exitPoint.getMesh());
    }
    exitPoint = new ExitPoint(ep);
    sceneManager.getScene().add(exitPoint.getMesh());
    gameLoop.exitPoint = exitPoint;
    exitPoint?.registerInteractable?.(interactableSystem, { eventBus, gameState });

    // Missions / world markers / hiding spots
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
    worldMarkerSystem?.setRefs?.({
      eventBus,
      scene: sceneManager.getScene(),
      camera,
      player,
      worldState,
      pickupManager,
      toolSystem,
      missionDirector,
      exitPoint
    });
    if (hidingSpotSystem) {
      hidingSpotSystem.setRefs({
        worldState,
        scene: sceneManager.getScene(),
        interactableSystem,
        eventBus,
        player
      });
      hidingSpotSystem.startLevel(levelConfig);
    }
    worldStateEffectsSystem?.startLevel?.(levelConfig);
    gameLoop.missionDirector = missionDirector;
    gameLoop.interactableSystem = interactableSystem;

    // Restore player
    const p = save.player && typeof save.player === 'object' ? save.player : null;
    const arr = Array.isArray(p?.position) ? p.position : null;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const sp = worldState.getSpawnPoint();
    const x = arr && arr.length >= 3 ? Number(arr[0]) : (sp.x * tileSize + tileSize / 2);
    const y = arr && arr.length >= 3 ? Number(arr[1]) : CONFIG.PLAYER_HEIGHT;
    const z = arr && arr.length >= 3 ? Number(arr[2]) : (sp.y * tileSize + tileSize / 2);
    player.setPosition(x, y, z);
    camera.setYawPitch?.(Number(p?.yaw) || 0, Number(p?.pitch) || 0);

    // Restore game state + weapon state
    gameState.reset();
    gameState.applySaveData(save.gameState);
    gameState.resumeTimer?.();
    gun.reset?.();
    gun.applySaveData?.(save.gun);

    // Rebuild monsters (we don't restore individual monster state yet)
    monsterManager.clear();
    if (spawnDirector) {
      await spawnDirector.startLevel(levelConfig);
    } else {
      await monsterManager.initializeForLevel(levelConfig);
    }
    monsterManager.setProjectileManager(projectileManager);

    // Rebuild autopilot + projectile system
    autopilot = new AutoPilot(
      worldState,
      monsterManager,
      () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
      exitPoint,
      player,
      levelConfig,
      () => (pickupManager?.getPickupMarkers?.() || [])
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

    // Update minimap
    minimap.updateScale();
    minimap.render(
      player.getGridPosition(),
      monsterManager.getMonsterPositions(),
      ep,
      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
      {
        pickupPositions: pickupManager?.getPickupMarkers?.() || [],
        devicePositions: toolSystem?.getDeviceMarkers?.() || []
      }
    );

    hasRunStarted = true;
    homeMenu?.setCanContinue?.(true);
    homeMenu?.setCanRestart?.(true);
    homeMenu?.setCanAbandon?.(true);
    homeMenu?.setCanSave?.(true);
    homeMenu?.setStatus?.('');

    input.resetState?.();
    audioManager.playAmbient();
    gameLoop.start();
    input.requestPointerLock(container);
    homeMenu?.setSaveInfo?.(`Loaded save from ${new Date(save.savedAtMs).toLocaleString()}`);
  }

  async function restartRun() {
    if (!hasRunStarted) return;
    console.log('🔄 Home: restart current run');
    clearAutoGameOverTimer();
    document.getElementById('game-over')?.classList.add('hidden');

    homeMenu.setStatus('Restarting…');
    homeMenu.setVisible(false);
    input.resetState?.();
    input.requestPointerLock(container);
    audioManager.playAmbient();
    await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
    homeMenu.setCanContinue(true);
    homeMenu.setCanRestart(true);
    homeMenu.setCanAbandon(true);
    homeMenu.setStatus('');
    input.requestPointerLock(container);
  }

  async function abandonRun() {
    if (!hasRunStarted) return;
    console.log('🏳️ Home: abandon run');

    clearAutoGameOverTimer();
    document.getElementById('game-over')?.classList.add('hidden');

    const currentStats = gameState?.getStats ? gameState.getStats() : null;
    const { next, summary } = campaignManager.endRun(campaignState, {
      reason: 'abandon',
      atLevelIndex: currentLevelIndex,
      levelConfig,
      stats: currentStats
    });
    campaignState = next;
    renderCampaignInfo();

    input.exitPointerLock();
    input.resetState?.();
    gameLoop.stop();
    gameState.reset();
    hasRunStarted = false;

    // Show the "celebration" summary screen using cleared levels only.
    showCampaignSummary(summary, '🏁 Run Summary');
  }

  // Handle ESC key to open/close Home menu (and pause game)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      e.preventDefault();

      if (!instructionsOverlay?.classList.contains('hidden')) {
        // Menu is open: allow quick resume if possible.
        if (hasRunStarted && !gameState?.gameOver) {
          void continueRun();
        }
        return;
      }

      input.exitPointerLock();
      input.resetState?.();
      gameState?.pauseTimer?.();
      gameLoop.stop();
      homeMenu.setVisible(true);
      homeMenu.setActiveTab('play');
      const canContinue = (hasRunStarted && !gameState?.gameOver) || saveManager.hasSave();
      const continueReason =
        gameState?.gameOver ? 'Run ended' :
        (!hasRunStarted && !saveManager.hasSave()) ? 'No active run or save yet' :
        '';
      homeMenu.setCanContinue(canContinue, continueReason);
      homeMenu.setCanRestart(hasRunStarted, 'No active run');
      homeMenu.setCanAbandon(hasRunStarted, 'No active run');
      homeMenu.setCanSave(hasRunStarted, 'No active run');
      homeMenu.setCanLoadSave(saveManager.hasSave(), 'No save found');
      homeMenu.setCanClearSave(saveManager.hasSave(), 'No save found');
      if (gameState?.gameOver) {
        homeMenu.setStatus('Run ended. Start a new run.');
      } else {
        homeMenu.setStatus('Paused. Continue or restart.');
      }
      console.log('⏸️ Opened Home menu');
    }
  });

  // Quick save/load hotkeys (work even during gameplay)
  window.addEventListener('keydown', (e) => {
    const tag = String(e.target?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
    if (isTyping) return;

    if (e.code === 'F5') {
      e.preventDefault();
      saveGame();
      return;
    }
    if (e.code === 'F9') {
      e.preventDefault();
      void loadSavedGame();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      saveGame();
      return;
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

  // Auto-save system (tracks progress without manual intervention)
  const autosave = {
    accumulator: 0,
    lastSavedAtMs: 0
  };
  const autosaveUnsub = gameLoop?.systemRegistry?.add?.('autosave', (dt) => {
    if (!(CONFIG.AUTO_SAVE_ENABLED ?? true)) return;
    if (!hasRunStarted) return;
    if (gameState?.gameOver) return;
    if (homeMenu && !instructionsOverlay?.classList.contains('hidden')) return; // menu open

    autosave.accumulator += Math.max(0, Number(dt) || 0);
    const interval = Math.max(10, Number(CONFIG.AUTO_SAVE_INTERVAL_SECONDS) || 45);
    if (autosave.accumulator < interval) return;
    autosave.accumulator = autosave.accumulator % interval;

    const before = autosave.lastSavedAtMs;
    saveGame();
    autosave.lastSavedAtMs = Date.now();
    if (autosave.lastSavedAtMs !== before) {
      console.log(`💾 Auto-saved (${interval}s)`);
    }
  }, { order: 175 });
  void autosaveUnsub;

  menuButton.addEventListener('click', () => {
    console.log('📋 Returning to menu...');
    clearAutoGameOverTimer();

    // Hide game over screen
    document.getElementById('game-over').classList.add('hidden');

    // Stop game loop
    gameLoop.stop();
    input.exitPointerLock();
    gameState?.pauseTimer?.();

    homeMenu.setActiveTab('play');
    homeMenu.setCanContinue(saveManager.hasSave(), saveManager.hasSave() ? '' : 'No active run or save yet');
    homeMenu.setCanRestart(hasRunStarted, 'No active run');
    homeMenu.setCanAbandon(hasRunStarted, 'No active run');
    homeMenu.setCanSave(hasRunStarted, 'No active run');
    homeMenu.setCanLoadSave(saveManager.hasSave(), 'No save found');
    homeMenu.setCanClearSave(saveManager.hasSave(), 'No save found');
    renderCampaignInfo();
    homeMenu.setStatus('Run ended. Restart, abandon, or start a new run.');
    homeMenu.setVisible(true);

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

  // Setup debug panel (safe/no-op if elements removed)
  setupDebugPanel(worldState, player, gameState, gameLoop, exitPoint, monsterManager, sceneManager, input);

  // Log success
  console.log('='.repeat(50));
  console.log('Initialization complete!');
  console.log('Click "Click to Start" to begin');
  console.log('='.repeat(50));
  console.log('Controls:');
  console.log('  WASD - Move');
  console.log('  Mouse - Look around');
  console.log('  Shift - Sprint');
  console.log('  ESC - Home menu / Pause');
  console.log('='.repeat(50));
}

/**
 * Setup settings panel controls
 */
	function setupSettingsPanel(sceneManager, camera, input, worldState, player, gameLoop, minimap, gameState, hooks = {}) {
	  const settingsPanel = document.getElementById('settings-panel');
	  if (!settingsPanel) return;
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
	  const obstacleOverlayToggle = document.getElementById('obstacle-overlay-toggle');
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

	  const squadMaxShootersSlider = document.getElementById('squad-max-shooters');
	  const squadMaxShootersValue = document.getElementById('squad-max-shooters-value');
	  const squadFireGrantSlider = document.getElementById('squad-fire-grant');
	  const squadFireGrantValue = document.getElementById('squad-fire-grant-value');
	  const squadFlankHoldSlider = document.getElementById('squad-flank-hold');
	  const squadFlankHoldValue = document.getElementById('squad-flank-hold-value');
	  const squadMemorySlider = document.getElementById('squad-memory');
	  const squadMemoryValue = document.getElementById('squad-memory-value');
	  const squadNoiseShareSlider = document.getElementById('squad-noise-share');
	  const squadNoiseShareValue = document.getElementById('squad-noise-share-value');
	  const squadCoverRadiusSlider = document.getElementById('squad-cover-radius');
	  const squadCoverRadiusValue = document.getElementById('squad-cover-radius-value');

	  const weaponViewToggle = document.getElementById('weapon-view-toggle');
	  const crosshairToggle = document.getElementById('crosshair-toggle');
	  const recoilSlider = document.getElementById('weapon-recoil-slider');
	  const recoilValue = document.getElementById('weapon-recoil-value');

	  const poolFxToggle = document.getElementById('pool-fx-toggle');
	  const hdrToggle = document.getElementById('hdr-toggle');
	  const crosshairEl = document.getElementById('crosshair');

	  const openDebugHubButton = document.getElementById('open-debug-hub');
	  const openEnemyLabButton = document.getElementById('open-enemy-lab');
	  const openAiTestButton = document.getElementById('open-ai-test');
	  const openDiagnosticsButton = document.getElementById('open-diagnostics');

	  function openToolPage(path) {
	    const href = String(path || '').trim();
	    if (!href) return;
	    try {
	      const w = window.open(href, '_blank', 'noopener,noreferrer');
	      if (w) w.opener = null;
	    } catch {
	      // ignore
	    }
	  }

	  function rebuildObstacles() {
	    if (!worldState?.applyEnvironmentObstacles || !worldState?.applyPropObstacles) return;
	    worldState.applyEnvironmentObstacles(null);
	    worldState.applyPropObstacles(null);
	    sceneManager?.buildWorldFromGrid?.(worldState);
	  }

	  if (openDebugHubButton) openDebugHubButton.addEventListener('click', () => openToolPage('/debug-hub.html'));
	  if (openEnemyLabButton) openEnemyLabButton.addEventListener('click', () => openToolPage('/enemy-lab.html'));
	  if (openAiTestButton) openAiTestButton.addEventListener('click', () => openToolPage('/test-ai.html'));
	  if (openDiagnosticsButton) openDiagnosticsButton.addEventListener('click', () => openToolPage('/diagnostic.html'));

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

	  if (obstacleOverlayToggle) {
	    obstacleOverlayToggle.addEventListener('change', (e) => {
	      const enabled = e.target.checked;
	      CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY = enabled;
	      sceneManager?.setObstacleOverlayEnabled?.(enabled, worldState);
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

	  if (squadMaxShootersSlider && squadMaxShootersValue) {
	    squadMaxShootersSlider.addEventListener('input', (e) => {
	      const value = Math.max(1, parseInt(e.target.value, 10) || 1);
	      squadMaxShootersValue.textContent = String(value);
	      CONFIG.AI_SQUAD_MAX_RANGED_SHOOTERS = value;
	    });
	  }

	  if (squadFireGrantSlider && squadFireGrantValue) {
	    squadFireGrantSlider.addEventListener('input', (e) => {
	      const value = Math.max(0.2, parseFloat(e.target.value) || 0.9);
	      squadFireGrantValue.textContent = value.toFixed(1);
	      CONFIG.AI_SQUAD_FIRE_GRANT_SECONDS = value;
	    });
	  }

	  if (squadFlankHoldSlider && squadFlankHoldValue) {
	    squadFlankHoldSlider.addEventListener('input', (e) => {
	      const value = Math.max(1, parseInt(e.target.value, 10) || 8);
	      squadFlankHoldValue.textContent = String(value);
	      CONFIG.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS = value;
	    });
	  }

	  if (squadMemorySlider && squadMemoryValue) {
	    squadMemorySlider.addEventListener('input', (e) => {
	      const value = Math.max(1, parseFloat(e.target.value) || 6.5);
	      squadMemoryValue.textContent = value.toFixed(1);
	      CONFIG.AI_SQUAD_MEMORY_SECONDS = value;
	    });
	  }

	  if (squadNoiseShareSlider && squadNoiseShareValue) {
	    squadNoiseShareSlider.addEventListener('input', (e) => {
	      const value = Math.max(0, parseFloat(e.target.value) || 2.0);
	      squadNoiseShareValue.textContent = value.toFixed(1);
	      CONFIG.AI_SQUAD_NOISE_SHARE_SECONDS = value;
	    });
	  }

	  if (squadCoverRadiusSlider && squadCoverRadiusValue) {
	    squadCoverRadiusSlider.addEventListener('input', (e) => {
	      const value = Math.max(1, parseInt(e.target.value, 10) || 9);
	      squadCoverRadiusValue.textContent = String(value);
	      CONFIG.AI_SQUAD_COVER_RADIUS = value;
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
	  if (obstacleOverlayToggle) {
	    obstacleOverlayToggle.checked = CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY ?? false;
	    sceneManager?.setObstacleOverlayEnabled?.(obstacleOverlayToggle.checked, worldState);
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

		  if (squadMaxShootersSlider && squadMaxShootersValue) {
		    const value = Math.max(1, Math.round(CONFIG.AI_SQUAD_MAX_RANGED_SHOOTERS ?? 2));
		    squadMaxShootersSlider.value = String(value);
		    squadMaxShootersValue.textContent = String(value);
		  }

		  if (squadFireGrantSlider && squadFireGrantValue) {
		    const value = Number.isFinite(CONFIG.AI_SQUAD_FIRE_GRANT_SECONDS) ? CONFIG.AI_SQUAD_FIRE_GRANT_SECONDS : 0.9;
		    squadFireGrantSlider.value = String(value);
		    squadFireGrantValue.textContent = Number(value).toFixed(1);
		  }

		  if (squadFlankHoldSlider && squadFlankHoldValue) {
		    const value = Math.max(1, Math.round(CONFIG.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS ?? 8));
		    squadFlankHoldSlider.value = String(value);
		    squadFlankHoldValue.textContent = String(value);
		  }

		  if (squadMemorySlider && squadMemoryValue) {
		    const value = Number.isFinite(CONFIG.AI_SQUAD_MEMORY_SECONDS) ? CONFIG.AI_SQUAD_MEMORY_SECONDS : 6.5;
		    squadMemorySlider.value = String(value);
		    squadMemoryValue.textContent = Number(value).toFixed(1);
		  }

		  if (squadNoiseShareSlider && squadNoiseShareValue) {
		    const value = Number.isFinite(CONFIG.AI_SQUAD_NOISE_SHARE_SECONDS) ? CONFIG.AI_SQUAD_NOISE_SHARE_SECONDS : 2.0;
		    squadNoiseShareSlider.value = String(value);
		    squadNoiseShareValue.textContent = Number(value).toFixed(1);
		  }

		  if (squadCoverRadiusSlider && squadCoverRadiusValue) {
		    const value = Math.max(1, Math.round(CONFIG.AI_SQUAD_COVER_RADIUS ?? 9));
		    squadCoverRadiusSlider.value = String(value);
		    squadCoverRadiusValue.textContent = String(value);
		  }

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
function setupDebugPanel(worldState, player, gameState, gameLoop, exitPoint, monsterManager, sceneManager, input) {
  const toggleButton = document.getElementById('toggle-debug');
  const debugPanel = document.getElementById('debug-panel');
  if (!debugPanel) return;

  // Debug UI now lives inside the Home menu; keep the old toggle button hidden.
  if (toggleButton) toggleButton.style.display = 'none';

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

  // Ensure panel is not stuck hidden by legacy inline styles.
  debugPanel.style.display = 'block';

  const monsterModelSelect = document.getElementById('debug-monster-model');
  const prettyEnemyLabel = (modelPath) => {
    const raw = String(modelPath || '');
    const parts = raw.split('/').filter(Boolean);
    const idx = parts.indexOf('enemy');
    if (idx >= 0 && parts.length >= idx + 3) {
      const enemyName = parts[idx + 1];
      const file = parts.slice(idx + 2).join('/');
      return `${enemyName} / ${file}`;
    }
    return raw;
  };

  const populateMonsterModelSelect = async () => {
    if (!monsterModelSelect) return;
    monsterModelSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(loading…)';
    monsterModelSelect.appendChild(placeholder);

    try {
      const res = await fetch('/models/enemy/manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = Array.isArray(json?.models) ? json.models : [];
      const models = list.filter((p) => typeof p === 'string' && p.startsWith('/models/enemy/'));

      monsterModelSelect.innerHTML = '';
      for (const modelPath of models) {
        const opt = document.createElement('option');
        opt.value = modelPath;
        opt.textContent = prettyEnemyLabel(modelPath);
        opt.title = modelPath;
        monsterModelSelect.appendChild(opt);
      }

      const preferred = CONFIG.MONSTER_MODEL;
      if (preferred && models.includes(preferred)) {
        monsterModelSelect.value = preferred;
      } else if (models.length > 0) {
        monsterModelSelect.value = models[0];
      } else {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '(no enemy models found)';
        monsterModelSelect.appendChild(none);
        monsterModelSelect.value = '';
      }
    } catch (err) {
      console.warn('⚠️ DEBUG: Failed to load enemy manifest:', err);
      monsterModelSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(manifest load failed)';
      monsterModelSelect.appendChild(opt);
    }
  };

  void populateMonsterModelSelect();

  // Update debug info every frame (only when visible)
  setInterval(() => {
    if (debugPanel.offsetParent !== null) {
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

    if (!selectedModel) {
      console.warn('🔧 DEBUG: No monster model selected');
      return;
    }

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
  console.log('🔧 Debug panel initialized (Home menu → Debug)');

  // Expose debug functions globally for browser console
  window.debugMonsters = () => {
    console.log('=== MONSTER DEBUG INFO ===');
    console.log('Monster count:', monsterManager.getMonsters().length);
    monsterManager.getMonsters().forEach((monster, i) => {
      console.log(`\nMonster ${i + 1}:`);
      console.log('  ID:', monster.id);
      console.log('  Type:', monster.type);
      console.log('  Grid:', monster.getGridPosition());
      console.log('  World:', monster.getWorldPosition?.() || monster.position);
      console.log('  Health:', `${monster.health}/${monster.maxHealth}`);
      console.log('  Dead:', monster.isDead);
      console.log('  Model:', monster.getModel?.()?.name || monster.getModel?.()?.type);
      console.log('  Has animations:', !!monster.mixer);
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
