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
import { AIDebugRenderer } from './rendering/aiDebugRenderer.js';
import { WorldState } from './world/worldState.js';
import { InputHandler } from './player/input.js';
import { PlayerController } from './player/playerController.js';
import { MonsterManager } from './entities/monsterManager.js';
import { ProjectileManager } from './entities/projectileManager.js';
import { PickupManager } from './entities/pickupManager.js';
import { DeviceManager } from './entities/deviceManager.js';
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
import { NoiseDebugSystem } from './core/noiseDebugSystem.js';
import { ToolSystem } from './core/toolSystem.js';
import { BossSystem } from './core/bossSystem.js';
import { createHomeMenuAdapter } from './ui/homeMenuAdapter.js';
import { CampaignManager } from './core/campaignManager.js';
import { SaveManager } from './core/saveManager.js';
import {
  selectMutatorsForLevel,
  describeMutators,
  computeMutatorEffects,
  grantProgressionUnlocks
} from './core/rogueliteMutators.js';
import { InteractableSystem } from './core/interactions/interactableSystem.js';
import { HidingSpotSystem } from './core/interactions/hidingSpotSystem.js';
import { MissionDirector } from './core/missions/missionDirector.js';
import { WorldStateEffectsSystem } from './core/worldStateEffectsSystem.js';
import { EncounterDirector } from './core/encounters/encounterDirector.js';
import { FeatureDirector } from './core/worldFeatures/featureDirector.js';
import { Diagnostics } from './core/diagnostics/diagnostics.js';
import { loadSettings, saveSettings as saveSettingsV2, resetSettings as resetSettingsV2, applySettingsToConfig } from './core/settings/settingsStore.js';
import { createGameApi } from './ui/gameApi.js';
import { mountUI } from './ui/react/mountUI.jsx';
import { createUiSnapshotBridge } from './ui/uiSnapshot.js';

const STORAGE_KEYS = {
  AI_DEBUG_PREFS: 'maze:ai:debug:prefs',
  DEBUG_UI: 'maze:debug:ui:v1'
};

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

function readJsonStorage(key) {
  const raw = safeStorageGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function resolveDebugUiEnabled() {
  try {
    const params = new URLSearchParams(window.location?.search || '');
    const qp = params.get('debug');
    if (qp === '1' || qp === 'true') {
      safeStorageSet(STORAGE_KEYS.DEBUG_UI, '1');
      return true;
    }
    if (qp === '0' || qp === 'false') {
      safeStorageRemove(STORAGE_KEYS.DEBUG_UI);
      return false;
    }
  } catch {
    // ignore
  }

  const stored = safeStorageGet(STORAGE_KEYS.DEBUG_UI);
  return stored === '1' || stored === 'true';
}

function clampNum(value, { min = -Infinity, max = Infinity, fallback = null } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function loadUserSettingsIntoConfig() {
  const settings = loadSettings();
  applySettingsToConfig(settings, CONFIG);
}

function applySettingsOverridesToLevelConfig(levelConfig) {
  if (!levelConfig) return levelConfig;
  const cfg =
    (typeof structuredClone === 'function')
      ? structuredClone(levelConfig)
      : JSON.parse(JSON.stringify(levelConfig));
  cfg.maze = cfg.maze || {};
  cfg.missions = cfg.missions || {};
  cfg.maze.width = CONFIG.MAZE_WIDTH;
  cfg.maze.height = CONFIG.MAZE_HEIGHT;
  cfg.maze.roomDensity = CONFIG.ROOM_DENSITY;
  if (CONFIG.MAZE_SEED !== null && CONFIG.MAZE_SEED !== undefined && CONFIG.MAZE_SEED !== '') {
    cfg.maze.seed = CONFIG.MAZE_SEED;
  }
  cfg.missions.missionPointCount = CONFIG.MISSION_POINT_COUNT;
  return cfg;
}

function applySafeModeOverrides() {
  if (CONFIG.SAFE_MODE_ENABLED !== true) return;
  CONFIG.LOW_PERF_MODE = true;
  CONFIG.ENVIRONMENT_HDR_ENABLED = false;
  CONFIG.POOL_FX_ENABLED = false;
  CONFIG.SHADOW_ENABLED = false;
  CONFIG.POST_PROCESSING_ENABLED = false;
  CONFIG.BLOOM_ENABLED = false;
  CONFIG.RENDER_MAX_PIXEL_RATIO = Math.min(Number(CONFIG.RENDER_MAX_PIXEL_RATIO) || 1.0, 1.0);
  CONFIG.RENDER_MIN_PIXEL_RATIO = Math.min(Number(CONFIG.RENDER_MIN_PIXEL_RATIO) || 0.85, 0.75);
}

function setBootStatus(text) {
  const overlay = document.getElementById('instructions');
  if (overlay) overlay.classList.remove('hidden');
  const shell = document.getElementById('home-shell');
  if (!shell) return;
  let el = document.getElementById('boot-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-status';
    el.style.marginTop = '8px';
    el.style.padding = '10px';
    el.style.borderRadius = '10px';
    el.style.border = '1px solid rgba(255,255,255,0.14)';
    el.style.background = 'rgba(255,255,255,0.06)';
    el.style.color = 'rgba(255,255,255,0.92)';
    el.style.fontSize = '13px';
    el.style.lineHeight = '1.45';
    el.style.whiteSpace = 'pre-line';
    shell.appendChild(el);
  }
  el.textContent = String(text || '');
}

// Surface hard boot errors even if initGame fails early (before UI binds).
window.addEventListener('error', (e) => {
  const msg = String(e?.error?.message || e?.message || 'Unknown error');
  console.error('💥 Uncaught error:', msg, e?.error || e);
  setBootStatus(`Boot error: ${msg}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || 'Unhandled rejection');
  console.error('💥 Unhandled rejection:', msg, e?.reason || e);
  setBootStatus(`Boot error: ${msg}`);
});

/**
 * Initialize and start the game
 */
	async function initGame() {
	  console.log('='.repeat(80));
	  console.log('🎮 GAME INITIALIZATION STARTED');
	  console.log('📦 VERSION: 2.0.2 - Debug Version');
	  console.log('='.repeat(80));

	  const eventBus = new EventBus();
	  const gameApi = createGameApi();
  gameApi.setRefs({ eventBus });
  const debugUiEnabled = resolveDebugUiEnabled();
  document.body.classList.toggle('show-debug', debugUiEnabled);
  document.body.classList.add('ui-react');
  let minimapClickTeleportEnabled = false;
  CONFIG.DEBUG_MODE = debugUiEnabled;
  loadUserSettingsIntoConfig();
  // URL override: ?safe=1 forces safe mode for this session.
  try {
    const params = new URLSearchParams(window.location?.search || '');
    if (params.get('safe') === '1' || params.get('safe') === 'true') {
      CONFIG.SAFE_MODE_ENABLED = true;
    }
  } catch {
    // ignore
  }
  // For normal play, keep debug visualizations off even if previously saved.
  if (!debugUiEnabled) {
    CONFIG.DEBUG_AI_OVERLAY_ENABLED = false;
    CONFIG.DEBUG_AI_MARKERS_ENABLED = false;
    CONFIG.DEBUG_AI_3D_LINES_ENABLED = false;
    CONFIG.DEBUG_NAV_HEATMAP_ENABLED = false;
  }
  applySafeModeOverrides();

  // Load persisted AI debug prefs only when debug UI is enabled (to keep normal gameplay clean).
  if (debugUiEnabled) {
    const prefs = readJsonStorage(STORAGE_KEYS.AI_DEBUG_PREFS);
    if (prefs && typeof prefs === 'object') {
      const b = (v) => (typeof v === 'boolean' ? v : null);
      const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

      const overlay = b(prefs.overlay);
      const markers = b(prefs.markers);
      const navHeat = b(prefs.navHeatmap);
      const lines = b(prefs.lines3d);
      const chaseOnly = b(prefs.chaseOnly);
      const leaderOnly = b(prefs.leaderOnly);
      const nearestN = n(prefs.nearestN);
      const minimapTeleportEnabled = b(prefs.minimapTeleportEnabled);

      if (overlay !== null) CONFIG.DEBUG_AI_OVERLAY_ENABLED = overlay;
      if (markers !== null) CONFIG.DEBUG_AI_MARKERS_ENABLED = markers;
      if (navHeat !== null) CONFIG.DEBUG_NAV_HEATMAP_ENABLED = navHeat;
      if (lines !== null) CONFIG.DEBUG_AI_3D_LINES_ENABLED = lines;
      if (chaseOnly !== null) CONFIG.DEBUG_AI_FILTER_CHASE_ONLY = chaseOnly;
      if (leaderOnly !== null) CONFIG.DEBUG_AI_FILTER_LEADER_ONLY = leaderOnly;
      if (nearestN !== null) CONFIG.DEBUG_AI_FILTER_NEAREST_N = nearestN;
      if (minimapTeleportEnabled !== null) minimapClickTeleportEnabled = minimapTeleportEnabled;
    }
  }

  const diagnostics = new Diagnostics({ version: '2.0.2' });
  diagnostics.attachWindowHandlers();
  window.__mazeDiagnostics = diagnostics;
  gameApi.setRefs({ diagnostics });
  gameApi.getSettings = () => loadSettings();
  gameApi.actions.copyCrashReport = async () => diagnostics.copyReportToClipboard();
  mountUI({ gameApi });
  const uiSnapshotBridge = createUiSnapshotBridge({
    gameApi,
    eventBus,
    diagnostics,
    getGameLoop: () => gameLoop,
    getWorldState: () => worldState,
    getLevelConfig: () => levelConfig
  });
  uiSnapshotBridge.attach();

  // Get container elements
  const container = document.getElementById('canvas-container');
  const instructionsOverlay = document.getElementById('instructions');
  const minimapCanvas = document.getElementById('minimap');
  const minimapViewport = document.getElementById('minimap-viewport');

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
	  let levelConfig = applySettingsOverridesToLevelConfig(applyRogueliteToLevelConfig(levelDirector.getLevelConfig(currentLevelIndex), currentLevelIndex));
	  gameApi.setRefs({ levelConfig });
	  diagnostics?.setContext?.({ levelIndex: currentLevelIndex, levelId: levelConfig?.id ?? levelConfig?.name ?? null, seed: levelConfig?.maze?.seed ?? null });
  let missionDirector = null;
  let encounterDirector = null;
  let featureDirector = null;
  let interactableSystem = null;
  let hidingSpotSystem = null;
  let exitPoint = null;
  let autopilot = null;
  let pickupManager = null;
  let spawnDirector = null;
  let noiseBridgeSystem = null;
  let toolSystem = null;
  let deviceManager = null;
  let bossSystem = null;
  let worldMarkerSystem = null;
  let gameLoop = null;
  let levelLoading = Promise.resolve();
  let lastOutcome = null;
  let lastRunStats = null;
  let minimapHidden = false;
  let hasRunStarted = false;
  let homeMenu = null;
  let bootReady = false;

  const TUTORIAL_SEEN_KEY = 'maze3d_tutorial_seen';

  function hasSeenTutorial() {
    try {
      return window.localStorage?.getItem(TUTORIAL_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markTutorialSeen() {
    try {
      window.localStorage?.setItem(TUTORIAL_SEEN_KEY, '1');
    } catch {
      // ignore (storage may be blocked)
    }
  }

  function openToolPageExternal(path) {
    const href = String(path || '').trim();
    if (!href) return;
    try {
      // In desktop (Tauri) builds, keep navigation inside the app window.
      // In browser dev, open a new tab.
      const isTauri =
        (typeof window !== 'undefined') && (
          !!window.__TAURI__ ||
          !!window.__TAURI_INTERNALS__ ||
          (typeof navigator !== 'undefined' && /tauri/i.test(String(navigator.userAgent || '')))
        );
      if (isTauri) {
        const url = new URL(href, window.location.origin);
        window.location.assign(url.toString());
        return;
      }
      const w = window.open(href, '_blank', 'noopener,noreferrer');
      if (w) w.opener = null;
    } catch {
      // ignore
    }
  }

  // Bind Home menu as early as possible so buttons remain responsive even if later init fails.
  homeMenu = createHomeMenuAdapter({ root: instructionsOverlay, gameApi });
  gameApi.actions.setHomeTab = (key) => homeMenu?.setActiveTab?.(key);

	    const requestPrompt = async ({ title = 'Confirm', text = '', okText = 'OK', cancelText = 'Cancel' } = {}) => {
	      const id = `prompt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
	      return await new Promise((resolve) => {
	        const off = eventBus?.on?.(EVENTS.UI_PROMPT_RESULT, (payload) => {
	          if (!payload || String(payload.id || '') !== id) return;
	          off?.();
	          resolve(payload.accepted === true);
	        });
	        eventBus?.emit?.(EVENTS.UI_PROMPT, { id, title, text, okText, cancelText });
	      });
	    };
	    gameApi.actions.requestPrompt = requestPrompt;

	    gameApi.actions.setDebugUiEnabled = (enabled) => {
	      try {
	        if (enabled === true) safeStorageSet(STORAGE_KEYS.DEBUG_UI, '1');
	        else safeStorageRemove(STORAGE_KEYS.DEBUG_UI);
	      } catch {
	        // ignore
	      }
	      try {
	        window.location.reload();
	      } catch {
	        // ignore
	      }
	    };

	    const copyText = async (text) => {
	      const t = String(text ?? '');
	      try {
	        await navigator.clipboard.writeText(t);
	        return true;
	      } catch {
	        try {
	          // Fallback: best-effort prompt for manual copy
	          window.prompt('Copy to clipboard:', t);
	          return true;
	        } catch {
	          return false;
	        }
	      }
	    };

	    gameApi.actions.copySettingsJson = async () => {
	      const settings = loadSettings();
	      const payload = {
	        version: '2.0.2',
	        tMs: Date.now(),
	        settings,
	        config: {
	          MAZE_WIDTH: CONFIG.MAZE_WIDTH,
	          MAZE_HEIGHT: CONFIG.MAZE_HEIGHT,
	          ROOM_DENSITY: CONFIG.ROOM_DENSITY,
	          MISSION_POINT_COUNT: CONFIG.MISSION_POINT_COUNT,
	          PLAYER_SPEED: CONFIG.PLAYER_SPEED,
	          MOUSE_SENSITIVITY: CONFIG.MOUSE_SENSITIVITY,
	          FOV: CONFIG.FOV,
	          FOG_DENSITY: CONFIG.FOG_DENSITY,
	          LOW_PERF_MODE: CONFIG.LOW_PERF_MODE,
	          SAFE_MODE_ENABLED: CONFIG.SAFE_MODE_ENABLED,
	          MONSTER_COUNT_MULTIPLIER: CONFIG.MONSTER_COUNT_MULTIPLIER,
	          AI_DIFFICULTY: CONFIG.AI_DIFFICULTY,
	          AUTOPILOT_ENABLED: CONFIG.AUTOPILOT_ENABLED
	        }
	      };
	      return await copyText(JSON.stringify(payload, null, 2));
	    };

	    gameApi.actions.copySnapshotJson = async () => {
	      const s = gameApi?.getSnapshot?.() || {};
	      const payload = { version: '2.0.2', tMs: Date.now(), snapshot: s };
	      return await copyText(JSON.stringify(payload, null, 2));
	    };

	    const toast = (text, seconds = 2.0) => {
	      try {
	        eventBus?.emit?.(EVENTS.UI_TOAST, { text: String(text || ''), seconds });
	      } catch {
	        // ignore
	      }
	    };

	    gameApi.actions.runAssetSanityCheck = async () => {
	      const results = [];
	      const probe = async (url, kind = 'GET') => {
	        const abs = new URL(String(url), window.location.origin).toString();
	        const started = performance.now();
	        try {
	          const res = await fetch(abs, { method: kind, cache: 'no-store' });
	          const ms = Math.round(performance.now() - started);
	          results.push({ url: String(url), ok: res.ok, status: res.status, ms });
	          return res.ok;
	        } catch (err) {
	          const ms = Math.round(performance.now() - started);
	          results.push({ url: String(url), ok: false, status: 0, ms, error: String(err?.message || err) });
	          return false;
	        }
	      };

	      // Critical manifests
	      await probe('/levels/manifest.json');
	      await probe('/models/enemy/manifest.json');
	      await probe('/models/weapon/manifest.json');

	      // Representative assets (fast sanity check)
	      await probe('/models/enemy/CityLicker/CityLicker.dae');
	      await probe('/models/weapon/assault_rifle_pbr.glb');

	      const okCount = results.filter((r) => r.ok).length;
	      toast(`Asset check: ${okCount}/${results.length} ok`, okCount === results.length ? 1.6 : 3.2);

	      const payload = {
	        version: '2.0.2',
	        tMs: Date.now(),
	        origin: String(window.location.origin),
	        results
	      };
	      await copyText(JSON.stringify(payload, null, 2));
	      return results;
	    };

	    gameApi.actions.rebuildObstacles = async () => {
	      if (!bootReady) return false;
	      if (!worldState || !sceneManager) return false;
	      const ok = await requestPrompt({
	        title: 'Rebuild obstacles?',
	        text: 'This will rebuild obstacle maps and re-render the scene. (Testing tool)',
	        okText: 'Rebuild',
	        cancelText: 'Cancel'
	      });
	      if (!ok) return false;
	      try {
	        worldState.applyEnvironmentObstacles?.(levelConfig);
	        worldState.applyPropObstacles?.(levelConfig);
	        sceneManager.buildWorldFromGrid(worldState);
	        minimap?.render?.(
	          player?.getGridPosition?.() || null,
	          monsterManager?.getMonsterPositions?.() || [],
	          exitPoint?.getGridPosition?.() || null,
	          missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
	          {
	            pickupPositions: pickupManager?.getPickupMarkers?.() || [],
	            devicePositions: [
	              ...(toolSystem?.getDeviceMarkers?.() || []),
	              ...(deviceManager?.getDeviceMarkers?.() || [])
	            ],
	            navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
	            navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
	            aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
	              ? monsterManager.getAIDebugMinimapMarkers({
	                onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	                onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
	                nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
	              })
	              : null
	          }
	        );
	      } catch (err) {
	        console.warn('⚠️ rebuildObstacles failed:', err);
	        return false;
	      }
	      return true;
	    };

	    gameApi.actions.reloadLevels = async () => {
	      if (!bootReady) return false;
	      const ok = await requestPrompt({
	        title: 'Reload level JSON?',
	        text: 'This will re-fetch `/levels/manifest.json` and rebuild the LevelDirector. (Testing tool)',
	        okText: 'Reload',
	        cancelText: 'Cancel'
	      });
	      if (!ok) return false;
	      try {
	        levelDirector = await LevelDirector.createFromPublic({
	          manifestUrl: '/levels/manifest.json',
	          fallbackLevels: LEVEL_CATALOG
	        });
	        renderCampaignInfo();
	      } catch (err) {
	        console.warn('⚠️ reloadLevels failed:', err);
	        return false;
	      }
	      return true;
	    };

    gameApi.actions.startNewRun = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void startNewRun();
    };
    gameApi.actions.continueRun = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      if (hasRunStarted && !gameState?.gameOver) return void continueRun();
      if (saveManager.hasSave()) return void loadSavedGame();
      homeMenu?.setStatus?.('No active run or save found.');
    };
    gameApi.actions.restartRun = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void restartRun();
    };
    gameApi.actions.abandonRun = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void (async () => {
        const ok = await requestPrompt({
          title: 'Abandon run?',
          text: 'You will lose current progress for this run.',
          okText: 'Abandon',
          cancelText: 'Cancel'
        });
        if (!ok) return;
        await abandonRun();
      })();
    };
    gameApi.actions.restartCampaign = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void (async () => {
        const ok = await requestPrompt({
          title: 'Restart campaign?',
          text: 'This will clear the current campaign progress and save.',
          okText: 'Restart',
          cancelText: 'Cancel'
        });
        if (!ok) return;
        resetCampaign('Campaign restarted. Configure settings, then start.');
      })();
    };
    gameApi.actions.saveGame = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      saveGame();
    };
    gameApi.actions.loadSavedGame = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void loadSavedGame();
    };
    gameApi.actions.clearSavedGame = () => {
      if (!bootReady) return homeMenu?.setStatus?.('Loading…');
      void (async () => {
        const ok = await requestPrompt({
          title: 'Delete save?',
          text: 'This cannot be undone.',
          okText: 'Delete',
          cancelText: 'Cancel'
        });
        if (!ok) return;
        clearSavedGame();
      })();
    };
    gameApi.actions.dismissCampaignReport = () => {
      hideCampaignVictory();
      homeMenu?.setVisible?.(true);
      homeMenu?.setActiveTab?.('play');
    };

    gameApi.actions.openDebugHub = () => openToolPageExternal('/debug-hub.html');
    gameApi.actions.openEnemyLab = () => openToolPageExternal('/enemy-lab.html');
    gameApi.actions.openAiTest = () => openToolPageExternal('/test-ai.html');
    gameApi.actions.openDiagnostics = () => openToolPageExternal('/diagnostic.html');
  homeMenu.setActiveTab('play');
  homeMenu.setVisible(true);
  homeMenu.setCanContinue(saveManager.hasSave(), saveManager.hasSave() ? '' : 'No active run or save yet');
  homeMenu.setCanRestart(false, 'Loading…');
  homeMenu.setCanAbandon(false, 'Loading…');
  homeMenu.setCanSave(false, 'Loading…');
  homeMenu.setCanLoadSave(saveManager.hasSave(), 'No save found');
  homeMenu.setCanClearSave(saveManager.hasSave(), 'No save found');
  homeMenu.setSaveInfo(saveManager.hasSave() ? 'Save found. You can load it any time from here.' : 'No save found yet.');
  homeMenu.setStatus(hasSeenTutorial() ? 'Loading…' : 'Loading… (Tip: read Guide, then start a new run)');

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
	    const last = campaignState?.lastRunSummary;
	    const lastLine = last
	      ? `Last run: ${last.completedLevels}/${levelCount} cleared • Avg ${last.averages?.timeFormatted || '00:00'} • Score ${Math.round(last.averages?.score || 0)}`
	      : 'Last run: —';

    // React UI snapshot (keep serializable + human readable).
    gameApi?.setUiState?.({
      campaign: {
        levelCount,
        completedLevels: completed,
        failures,
        failureLimit: limit,
        nextLevelIndex: nextPlayable,
        nextLevelName: nextName,
        isComplete,
        hudText: isComplete
          ? `Campaign Complete • Failures ${failures}/${limit}`
          : `Campaign ${Math.min(nextPlayable + 1, levelCount)}/${levelCount} • Failures ${failures}/${limit}`,
        infoText:
          (isComplete ? `Next: Campaign complete\n` : `Next: ${nextName} (${nextPlayable + 1}/${levelCount})\n`) +
          `Progress: ${completed}/${levelCount} cleared • Failures ${failures}/${limit}\n` +
          `${lastLine}`,
        lastRunText: lastLine
      }
    });
  }

  function clampLevelIndex(idx) {
    const n = Math.round(Number(idx));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(getCampaignLevelCount() - 1, n));
  }

  function showCampaignSummary(summary, title = 'Campaign Report') {
    const safeSummary = summary && typeof summary === 'object' ? summary : null;
    const avg = safeSummary?.averages || {};
    const rows = Array.isArray(safeSummary?.completed) ? safeSummary.completed : [];
    const summaryText =
      safeSummary
        ? `Cleared ${safeSummary.completedLevels}/${safeSummary.levelCount} levels • Failures ${safeSummary.failures}/${safeSummary.failureLimit}\n` +
          `Avg Time ${avg.timeFormatted || '00:00'} • Avg Steps ${Math.round(avg.steps || 0)} • Avg Rooms ${Math.round(avg.roomsVisited || 0)} • Weighted Score ${Math.round(avg.score || 0)}`
        : '';

    gameApi?.setUiState?.({
      victory: {
        visible: true,
        title: String(title || 'Campaign Report'),
        summaryText,
        rows: rows.map((r) => ({
          levelIndex: r.levelIndex,
          name: r.name,
          timeFormatted: r.timeFormatted,
          steps: r.steps,
          roomsVisited: r.roomsVisited,
          score: r.score
        }))
      }
    });
  }

  function showCampaignVictory() {
    const summary = campaignManager.computeSummary(campaignState);
    showCampaignSummary(summary, 'Campaign Complete');
  }

  function hideCampaignVictory() {
    gameApi?.setUiState?.({ victory: { visible: false } });
  }

  // Legacy auto-advance UI removed (React overlays provide navigation).
  function clearAutoGameOverTimer() {}

  function ensureLevelMutators(levelIndex) {
    const idx = clampLevelIndex(levelIndex);
    const run = campaignState?.run || {};
    const list = Array.isArray(run.levelMutators) ? [...run.levelMutators] : [];
    if (Array.isArray(list[idx]) && list[idx].length > 0) {
      return list[idx].map(String);
    }

    const mutatorIds = selectMutatorsForLevel({
      runId: run.runId,
      levelIndex: idx,
      permanent: campaignState?.permanent || null
    });

    list[idx] = mutatorIds;
    campaignState = { ...campaignState, run: { ...run, levelMutators: list } };
    campaignManager.save(campaignState);
    return mutatorIds;
  }

  function applyRogueliteToLevelConfig(baseLevelConfig, levelIndex) {
    const mutatorIds = ensureLevelMutators(levelIndex);
    const mutators = describeMutators(mutatorIds);
    const effects = computeMutatorEffects(mutatorIds);

    const cfg = baseLevelConfig ? JSON.parse(JSON.stringify(baseLevelConfig)) : {};
    cfg.roguelite = {
      mutatorIds,
      mutators,
      effects
    };

    // Apply data-driven effects to level config (so other systems naturally pick it up).
    const monsters = cfg.monsters && typeof cfg.monsters === 'object' ? cfg.monsters : {};
    const baseMult = Number.isFinite(monsters.countMultiplier) ? monsters.countMultiplier : 1.0;
    const baseBonus = Number.isFinite(monsters.countBonus) ? monsters.countBonus : 0;
    const mMult = Number.isFinite(effects.monsterCountMult) ? effects.monsterCountMult : 1.0;
    const mBonus = Number.isFinite(effects.monsterCountBonus) ? effects.monsterCountBonus : 0;
    cfg.monsters = {
      ...monsters,
      countMultiplier: baseMult * mMult,
      countBonus: baseBonus + mBonus
    };

    const pickups = cfg.pickups && typeof cfg.pickups === 'object' ? cfg.pickups : {};
    const tools = pickups.tools && typeof pickups.tools === 'object' ? pickups.tools : {};
    const drop = tools.drop && typeof tools.drop === 'object' ? tools.drop : {};
    if (Number.isFinite(drop.chance)) {
      const mult = Number.isFinite(effects.toolDropChanceMult) ? effects.toolDropChanceMult : 1.0;
      drop.chance = Math.max(0, Math.min(1, drop.chance * mult));
    }
    cfg.pickups = { ...pickups, tools: { ...tools, drop } };

    return cfg;
  }

	  let baseFogDensity = null;
    let baseGlobalNoiseMult = null;
    let baseMaxChasers = null;
    let baseVisionGlobalMult = null;
    let baseHearingGlobalMult = null;
    let baseSmellGlobalMult = null;
    let baseGunEnabled = null;
  function applyRogueliteRuntimeEffects(sceneManagerRef, playerRef, gunRef, currentLevelConfig) {
    const effects = currentLevelConfig?.roguelite?.effects || null;
    if (!effects || typeof effects !== 'object') return;

    if (baseFogDensity === null) {
      const d = sceneManagerRef?.getScene?.()?.fog?.density;
      baseFogDensity = Number.isFinite(d) ? d : 0.08;
    }

    const fog = sceneManagerRef?.getScene?.()?.fog;
    if (fog && Number.isFinite(baseFogDensity)) {
      const mult = Number.isFinite(effects.fogDensityMult) ? effects.fogDensityMult : 1.0;
      fog.density = baseFogDensity * mult;
    }

    if (baseGlobalNoiseMult === null) {
      baseGlobalNoiseMult = Number(CONFIG.GLOBAL_NOISE_RADIUS_MULT) || 1.0;
    }
    const gMult = Number.isFinite(effects.globalNoiseRadiusMult) ? effects.globalNoiseRadiusMult : 1.0;
    CONFIG.GLOBAL_NOISE_RADIUS_MULT = Math.max(0.5, Math.min(3.0, baseGlobalNoiseMult * gMult));

    if (baseMaxChasers === null) {
      baseMaxChasers = Number(CONFIG.AI_MAX_CHASERS) || 0;
    }
    const bonus = Number.isFinite(effects.aiMaxChasersBonus) ? effects.aiMaxChasersBonus : 0;
    CONFIG.AI_MAX_CHASERS = Math.max(0, Math.min(8, Math.round(baseMaxChasers + bonus)));

    if (baseVisionGlobalMult === null) baseVisionGlobalMult = Number(CONFIG.AI_VISION_GLOBAL_MULT) || 1.0;
    if (baseHearingGlobalMult === null) baseHearingGlobalMult = Number(CONFIG.AI_HEARING_GLOBAL_MULT) || 1.0;
    if (baseSmellGlobalMult === null) baseSmellGlobalMult = Number(CONFIG.AI_SMELL_GLOBAL_MULT) || 1.0;
    const vMult = Number.isFinite(effects.aiVisionGlobalMult) ? effects.aiVisionGlobalMult : 1.0;
    const hMult = Number.isFinite(effects.aiHearingGlobalMult) ? effects.aiHearingGlobalMult : 1.0;
    const sMult = Number.isFinite(effects.aiSmellGlobalMult) ? effects.aiSmellGlobalMult : 1.0;
    CONFIG.AI_VISION_GLOBAL_MULT = Math.max(0.5, Math.min(2.0, baseVisionGlobalMult * vMult));
    CONFIG.AI_HEARING_GLOBAL_MULT = Math.max(0.5, Math.min(2.0, baseHearingGlobalMult * hMult));
    CONFIG.AI_SMELL_GLOBAL_MULT = Math.max(0.5, Math.min(2.0, baseSmellGlobalMult * sMult));

    if (baseGunEnabled === null) baseGunEnabled = CONFIG.PLAYER_GUN_ENABLED !== false;
    CONFIG.PLAYER_GUN_ENABLED = effects.playerGunDisabled === true ? false : baseGunEnabled;

    CONFIG.MINIMAP_FORCE_HIDDEN = effects.minimapDisabled === true;

    playerRef?.setRunModifiers?.({ playerDamageTakenMult: effects.playerDamageTakenMult });
    gunRef?.setRunModifiers?.({
      weaponDamageMult: effects.weaponDamageMult,
      weaponRecoilMult: effects.weaponRecoilMult,
      weaponSpreadMult: effects.weaponSpreadMult,
      weaponPierceBonus: effects.weaponPierceBonus,
      gunshotNoiseRadiusMult: effects.gunshotNoiseRadiusMult,
      ammoReserveMult: effects.ammoReserveMult
    });
  }

  // Autopilot defaults are controlled via CONFIG + Settings panel (do not force-reset here).

  // Create world state
  const worldState = new WorldState();
  gameApi.setRefs({ worldState });
  worldState.initialize(levelConfig);
  console.log('World initialized with procedurally generated maze');

  // Create scene manager
  const sceneManager = new SceneManager(container);
  const lights = sceneManager.getLights();
  sceneManager.buildWorldFromGrid(worldState);
  console.log('Scene built from world state');
  gameApi.setRefs({ sceneManager });

  // Create camera
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new FirstPersonCamera(aspect);
  sceneManager.setCamera(camera);
  // Add camera to scene so first-person attachments (weapon view) can render.
  sceneManager.getScene().add(camera.getCamera());
  console.log('Camera created');
  gameApi.setRefs({ camera });

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
  gameApi.setRefs({ minimap });
  minimap.setShowObstacles?.(CONFIG.MINIMAP_SHOW_OBSTACLES === true);

	  const MINIMAP_STORAGE_SIZE = 'maze:minimap:size';
	  const MINIMAP_STORAGE_ZOOM = 'maze:minimap:zoom';
	  const MINIMAP_RENDER_SIZE = 240;
	  const DEFAULT_MINIMAP_SIZE = 240;
	  const DEFAULT_MINIMAP_ZOOM = 1.1;
	  const MINIMAP_SIZE_MIN = 140;
	  const MINIMAP_SIZE_MAX = 320;
	  const MINIMAP_ZOOM_MIN = 1.0;
	  const MINIMAP_ZOOM_MAX = 3.0;

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

	  let minimapDisplaySize = clampMinimapSize(initialMinimapSize) ?? DEFAULT_MINIMAP_SIZE;

	  function applyMinimapSize(size) {
	    const clamped = clampMinimapSize(size) ?? minimapDisplaySize ?? DEFAULT_MINIMAP_SIZE;
	    minimapDisplaySize = clamped;
	    const viewport = minimapViewport || minimapCanvas;
	    if (viewport && CONFIG.MINIMAP_FORCE_HIDDEN !== true && minimapHidden) {
	      minimapHidden = false;
	      viewport.style.display = 'block';
	    }
	    if (minimapViewport) {
	      minimapViewport.style.width = `${clamped}px`;
	      minimapViewport.style.height = `${clamped}px`;
	    } else if (minimapCanvas) {
	      minimapCanvas.style.width = `${clamped}px`;
	      minimapCanvas.style.height = `${clamped}px`;
	    }
	    safeStorageSet(MINIMAP_STORAGE_SIZE, clamped);
	    minimap.render(
	      player.getGridPosition(),
	      monsterManager?.getMonsterPositions() || [],
	      exitPoint?.getGridPosition() || null,
	      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
        {
          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
	          devicePositions: [
	            ...(toolSystem?.getDeviceMarkers?.() || []),
	            ...(deviceManager?.getDeviceMarkers?.() || [])
	          ],
	          navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
	          navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
	          aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
	            ? monsterManager.getAIDebugMinimapMarkers({
	              onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	              onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
              nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
            })
            : null
        }
	    );
	    return clamped;
	  }

  // Create input handler
  const input = new InputHandler();
  console.log('Input handler created');
  gameApi.setRefs({ input });

  // Create game state manager
  const gameState = new GameState(eventBus);
  console.log('🎮 Game state created');
  gameApi.setRefs({ gameState });

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
  gameApi.setRefs({ player });

  // Create exit point at a far location from spawn
  const exitGridPos = worldState.getExitPoint();
  exitPoint = new ExitPoint(exitGridPos);
  sceneManager.getScene().add(exitPoint.getMesh());
  console.log('🚪 Exit point created at grid:', exitGridPos);

	  // Create monster manager
	  const monsterManager = new MonsterManager(sceneManager.getScene(), worldState, player, eventBus);
	  console.log('👹 Monster manager created');
	  monsterManager.setAudioManager?.(audioManager);
	  gameApi.setRefs({ monsterManager });
	  const aiDebugRenderer = new AIDebugRenderer({ scene: sceneManager.getScene(), monsterManager });

	  // React Debug "cheats" actions (teleport/health/time/win-lose/godmode).
	  let debugGodModeEnabled = false;
	  let debugTakeDamageOriginal = null;

	  const teleportToGrid = (gridX, gridY) => {
	    if (!debugUiEnabled) return false;
	    const x = Math.round(Number(gridX));
	    const y = Math.round(Number(gridY));
	    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	    if (!worldState?.isWalkable?.(x, y)) return false;
	    const worldX = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
	    const worldZ = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
	    player?.setPosition?.(worldX, CONFIG.PLAYER_HEIGHT, worldZ);
	    return true;
	  };

	  const setGodMode = (enabled) => {
	    if (!debugUiEnabled) return false;
	    debugGodModeEnabled = enabled === true;
	    if (!debugTakeDamageOriginal) {
	      debugTakeDamageOriginal = gameState?.takeDamage?.bind?.(gameState) || null;
	    }
	    if (!debugTakeDamageOriginal || !gameState) return false;
	    if (debugGodModeEnabled) {
	      gameState.takeDamage = (amount) => {
	        console.log('🔧 DEBUG: God mode blocked damage:', amount);
	        return false;
	      };
	    } else {
	      gameState.takeDamage = debugTakeDamageOriginal;
	    }
	    return true;
	  };

	  const emitHealth = (amount = 0) => {
	    try {
	      eventBus?.emit?.(EVENTS.PLAYER_DAMAGED, {
	        amount,
	        currentHealth: gameState?.currentHealth ?? null,
	        maxHealth: gameState?.maxHealth ?? null,
	        died: false,
	        autoRevived: false
	      });
	    } catch {
	      // ignore
	    }
	  };

	  gameApi.actions.debugTeleportSpawn = () => teleportToGrid(worldState?.getSpawnPoint?.()?.x, worldState?.getSpawnPoint?.()?.y);
	  gameApi.actions.debugTeleportExit = () => teleportToGrid(exitPoint?.getGridPosition?.()?.x, exitPoint?.getGridPosition?.()?.y);
	  gameApi.actions.debugTeleportRandom = () => {
	    const p = worldState?.findRandomWalkableTile?.() || null;
	    return teleportToGrid(p?.x, p?.y);
	  };
	  gameApi.actions.debugTeleportMonster = () => {
	    const monsters = monsterManager?.getMonsters?.() || [];
	    const m = monsters && monsters.length ? monsters[0] : null;
	    const g = m?.getGridPosition?.() || m?.gridPos || null;
	    return teleportToGrid(g?.x, g?.y);
	  };
	  gameApi.actions.debugTeleportGrid = (x, y) => teleportToGrid(x, y);
	  gameApi.actions.debugSetGodMode = (enabled) => setGodMode(enabled === true);

	  gameApi.actions.debugSetHealthPercent = (pct) => {
	    if (!debugUiEnabled || !gameState) return false;
	    const p = Math.max(0, Math.min(100, Number(pct)));
	    if (!Number.isFinite(p)) return false;
	    gameState.currentHealth = Math.max(0, Math.round((gameState.maxHealth || 100) * (p / 100)));
	    gameState.isDead = false;
	    emitHealth(0);
	    return true;
	  };
	  gameApi.actions.debugAdjustHealth = (delta) => {
	    if (!debugUiEnabled || !gameState) return false;
	    const d = Number(delta);
	    if (!Number.isFinite(d)) return false;
	    const max = Number(gameState.maxHealth) || 100;
	    gameState.currentHealth = Math.max(0, Math.min(max, (Number(gameState.currentHealth) || 0) + d));
	    gameState.isDead = false;
	    emitHealth(d);
	    return true;
	  };

	  gameApi.actions.debugTimeReset = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    gameState.startTime = Date.now();
	    gameState.currentTime = 0;
	    return true;
	  };
	  gameApi.actions.debugTimeToggle = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    if (gameState.isRunning) gameState.stopTimer();
	    else gameState.startTimer();
	    return true;
	  };
	  gameApi.actions.debugTimePlus = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    gameState.startTime -= 30000;
	    return true;
	  };
	  gameApi.actions.debugTimeMinus = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    gameState.startTime += 30000;
	    return true;
	  };

	  gameApi.actions.debugForceWin = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    gameState.win?.('Forced win (debug)');
	    return true;
	  };
	  gameApi.actions.debugForceLose = () => {
	    if (!debugUiEnabled || !gameState) return false;
	    gameState.lose?.('Forced loss (debug)');
	    return true;
	  };
	  gameApi.actions.debugSpeedPreset = (mult = 1) => {
	    if (!debugUiEnabled) return false;
	    const m = Number(mult);
	    if (!Number.isFinite(m) || m <= 0) return false;
	    CONFIG.PLAYER_SPEED = (Number(CONFIG.PLAYER_SPEED) || 4) * m;
	    return true;
	  };

	  const syncDebugPrefsToUi = () => {
	    gameApi?.setUiState?.({
	      debug: {
	        overlay: CONFIG.DEBUG_AI_OVERLAY_ENABLED !== false,
	        markers: CONFIG.DEBUG_AI_MARKERS_ENABLED !== false,
	        navHeatmap: CONFIG.DEBUG_NAV_HEATMAP_ENABLED === true,
	        minimapShowObstacles: CONFIG.MINIMAP_SHOW_OBSTACLES === true,
	        worldShowObstacleOverlay: CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY === true,
	        minimapTeleportEnabled: minimapClickTeleportEnabled === true,
	        lines3d: CONFIG.DEBUG_AI_3D_LINES_ENABLED === true,
	        chaseOnly: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	        leaderOnly: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
	        nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0,
	        hearingGlobalMult: CONFIG.AI_HEARING_GLOBAL_MULT ?? null,
	        hearingUsePathDistance: CONFIG.AI_HEARING_USE_PATH_DISTANCE ?? null,
        hearingCorridorCostMult: CONFIG.AI_HEARING_CORRIDOR_COST_MULT ?? null,
        hearingRoomCostMult: CONFIG.AI_HEARING_ROOM_COST_MULT ?? null,
        hearingDoorCostMult: CONFIG.AI_HEARING_DOOR_COST_MULT ?? null,
        hearingThroughWallEnabled: CONFIG.AI_HEARING_THROUGH_WALL_ENABLED ?? null,
        hearingMaxWallTiles: CONFIG.AI_HEARING_MAX_WALL_TILES ?? null,
        hearingWallPenalty: CONFIG.AI_HEARING_WALL_PENALTY ?? null,
        hearingBlockedDoorPenalty: CONFIG.AI_HEARING_BLOCKED_DOOR_PENALTY ?? null
      }
    });
  };

	  const persistDebugPrefs = () => {
	    const payload = {
	      overlay: CONFIG.DEBUG_AI_OVERLAY_ENABLED !== false,
	      markers: CONFIG.DEBUG_AI_MARKERS_ENABLED !== false,
	      navHeatmap: CONFIG.DEBUG_NAV_HEATMAP_ENABLED === true,
	      minimapShowObstacles: CONFIG.MINIMAP_SHOW_OBSTACLES === true,
	      worldShowObstacleOverlay: CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY === true,
	      minimapTeleportEnabled: minimapClickTeleportEnabled === true,
	      lines3d: CONFIG.DEBUG_AI_3D_LINES_ENABLED === true,
	      chaseOnly: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	      leaderOnly: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
	      nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0,
	      hearingGlobalMult: CONFIG.AI_HEARING_GLOBAL_MULT,
      hearingUsePathDistance: CONFIG.AI_HEARING_USE_PATH_DISTANCE,
      hearingCorridorCostMult: CONFIG.AI_HEARING_CORRIDOR_COST_MULT,
      hearingRoomCostMult: CONFIG.AI_HEARING_ROOM_COST_MULT,
      hearingDoorCostMult: CONFIG.AI_HEARING_DOOR_COST_MULT,
      hearingThroughWallEnabled: CONFIG.AI_HEARING_THROUGH_WALL_ENABLED,
      hearingMaxWallTiles: CONFIG.AI_HEARING_MAX_WALL_TILES,
      hearingWallPenalty: CONFIG.AI_HEARING_WALL_PENALTY,
      hearingBlockedDoorPenalty: CONFIG.AI_HEARING_BLOCKED_DOOR_PENALTY
    };
    safeStorageSet(STORAGE_KEYS.AI_DEBUG_PREFS, JSON.stringify(payload));
  };

	  const applyDebugPrefsPatch = (patch = {}) => {
	    if (!debugUiEnabled) return;
	    if (!patch || typeof patch !== 'object') return;

    const bool = (v) => (typeof v === 'boolean' ? v : null);
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const overlay = bool(patch.overlay);
    const markers = bool(patch.markers);
    const navHeatmap = bool(patch.navHeatmap);
    const lines3d = bool(patch.lines3d);
    const chaseOnly = bool(patch.chaseOnly);
    const leaderOnly = bool(patch.leaderOnly);
	    const nearestN = num(patch.nearestN);
	    const minimapShowObstacles = bool(patch.minimapShowObstacles);
	    const worldShowObstacleOverlay = bool(patch.worldShowObstacleOverlay);
	    const minimapTeleportEnabled = bool(patch.minimapTeleportEnabled);

    if (overlay !== null) CONFIG.DEBUG_AI_OVERLAY_ENABLED = overlay;
    if (markers !== null) CONFIG.DEBUG_AI_MARKERS_ENABLED = markers;
	    if (navHeatmap !== null) CONFIG.DEBUG_NAV_HEATMAP_ENABLED = navHeatmap;
	    if (minimapShowObstacles !== null) {
	      CONFIG.MINIMAP_SHOW_OBSTACLES = minimapShowObstacles;
	      minimap?.setShowObstacles?.(minimapShowObstacles);
	      saveSettingsV2({ minimapShowObstacles });
	    }
	    if (worldShowObstacleOverlay !== null) {
	      CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY = worldShowObstacleOverlay;
	      sceneManager?.setObstacleOverlayEnabled?.(worldShowObstacleOverlay, worldState);
	      saveSettingsV2({ worldShowObstacleOverlay });
	    }
	    if (minimapTeleportEnabled !== null) minimapClickTeleportEnabled = minimapTeleportEnabled;
	    if (lines3d !== null) CONFIG.DEBUG_AI_3D_LINES_ENABLED = lines3d;
	    if (chaseOnly !== null) CONFIG.DEBUG_AI_FILTER_CHASE_ONLY = chaseOnly;
	    if (leaderOnly !== null) CONFIG.DEBUG_AI_FILTER_LEADER_ONLY = leaderOnly;
	    if (nearestN !== null) CONFIG.DEBUG_AI_FILTER_NEAREST_N = Math.max(0, Math.round(nearestN));

    const hearingGlobalMult = num(patch.hearingGlobalMult);
    const hearingUsePathDistance = bool(patch.hearingUsePathDistance);
    const hearingCorridorCostMult = num(patch.hearingCorridorCostMult);
    const hearingRoomCostMult = num(patch.hearingRoomCostMult);
    const hearingDoorCostMult = num(patch.hearingDoorCostMult);
    const hearingThroughWallEnabled = bool(patch.hearingThroughWallEnabled);
    const hearingMaxWallTiles = num(patch.hearingMaxWallTiles);
    const hearingWallPenalty = num(patch.hearingWallPenalty);
    const hearingBlockedDoorPenalty = num(patch.hearingBlockedDoorPenalty);

    if (hearingGlobalMult !== null) CONFIG.AI_HEARING_GLOBAL_MULT = Math.max(0, hearingGlobalMult);
    if (hearingUsePathDistance !== null) CONFIG.AI_HEARING_USE_PATH_DISTANCE = hearingUsePathDistance;
    if (hearingCorridorCostMult !== null) CONFIG.AI_HEARING_CORRIDOR_COST_MULT = Math.max(0, hearingCorridorCostMult);
    if (hearingRoomCostMult !== null) CONFIG.AI_HEARING_ROOM_COST_MULT = Math.max(0, hearingRoomCostMult);
    if (hearingDoorCostMult !== null) CONFIG.AI_HEARING_DOOR_COST_MULT = Math.max(0, hearingDoorCostMult);
    if (hearingThroughWallEnabled !== null) CONFIG.AI_HEARING_THROUGH_WALL_ENABLED = hearingThroughWallEnabled;
    if (hearingMaxWallTiles !== null) CONFIG.AI_HEARING_MAX_WALL_TILES = Math.max(0, Math.round(hearingMaxWallTiles));
    if (hearingWallPenalty !== null) CONFIG.AI_HEARING_WALL_PENALTY = Math.max(0, Math.round(hearingWallPenalty));
    if (hearingBlockedDoorPenalty !== null) CONFIG.AI_HEARING_BLOCKED_DOOR_PENALTY = Math.max(0, Math.round(hearingBlockedDoorPenalty));

    persistDebugPrefs();
    syncDebugPrefsToUi();

    // Re-render minimap overlays when debug flags change.
    try {
      minimap?.render?.(
        player?.getGridPosition?.() || null,
        monsterManager?.getMonsterPositions?.() || [],
        exitPoint?.getGridPosition?.() || null,
        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
        {
          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
          devicePositions: [
            ...(toolSystem?.getDeviceMarkers?.() || []),
            ...(deviceManager?.getDeviceMarkers?.() || [])
          ],
          navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
          navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
          aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
            ? monsterManager.getAIDebugMinimapMarkers({
              onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
              onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
              nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
            })
            : null
        }
      );
    } catch {
      // ignore
    }

    // 3D debug lines have explicit allocation; toggle the renderer.
    aiDebugRenderer?.setEnabled?.(CONFIG.DEBUG_AI_3D_LINES_ENABLED === true);
  };

  gameApi.actions.updateDebugPrefs = (patch) => applyDebugPrefsPatch(patch);
  syncDebugPrefsToUi();
  aiDebugRenderer?.setEnabled?.(debugUiEnabled && CONFIG.DEBUG_AI_3D_LINES_ENABLED === true);

  noiseBridgeSystem = new NoiseBridgeSystem({ eventBus, monsterManager });
  void noiseBridgeSystem;
  const noiseDebugSystem = new NoiseDebugSystem({ eventBus, diagnostics });
  noiseDebugSystem.start();
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

  // Autopilot placeholder（會在 loadLevel 時重新建立）
  autopilot = new AutoPilot(
    worldState,
    monsterManager,
    () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
    exitPoint,
    player,
    levelConfig,
    () => (pickupManager?.getPickupMarkers?.() || []),
    { interactableSystem, toolSystem, gameState }
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

    deviceManager = new DeviceManager({
      eventBus,
      scene: sceneManager.getScene(),
      worldState,
      audioManager
    });
    deviceManager.startLevel(levelConfig);
    projectileManager.setExtraHittablesProvider?.(() => (deviceManager?.getHittables?.() || []));

    bossSystem = new BossSystem({
      eventBus,
      worldState,
      monsterManager,
      deviceManager,
      gameState,
      audioManager
    });
    missionDirector?.setRefs?.({ bossSystem });

  const weaponView = new WeaponView(
    sceneManager.getScene(),
    camera,
    player
  );
  gameApi.setRefs({ weaponView });

  // React Settings (via GameAPI): persist → apply to CONFIG → apply runtime side-effects.
  const applySettingsRuntimeEffects = (partial = {}) => {
    // Camera / fog apply immediately.
    if (camera?.getCamera && Number.isFinite(CONFIG.FOV)) {
      camera.getCamera().fov = CONFIG.FOV;
      camera.getCamera().updateProjectionMatrix();
    }
    const fog = sceneManager?.getScene?.()?.fog;
    if (fog && Number.isFinite(CONFIG.FOG_DENSITY)) {
      fog.density = CONFIG.FOG_DENSITY;
    }

    // Weapon view is a runtime toggle.
    weaponView?.setEnabled?.(CONFIG.PLAYER_WEAPON_VIEW_ENABLED !== false);

    // Autopilot needs a runtime sync (it is used every frame).
    if (Object.prototype.hasOwnProperty.call(partial || {}, 'autopilotEnabled')) {
      if (gameLoop) gameLoop.autopilotActive = CONFIG.AUTOPILOT_ENABLED === true;
    }

    // Changes that require rebuilding the scene.
    const rebuildKeys = new Set(['lowPerf', 'poolFx', 'hdri', 'safeMode', 'worldShowObstacleOverlay']);
    const shouldRebuild = Object.keys(partial || {}).some((k) => rebuildKeys.has(k));
    if (shouldRebuild) {
      if (sceneManager?.refreshEnvironmentMap) {
        sceneManager.refreshEnvironmentMap();
      }
      sceneManager?.buildWorldFromGrid?.(worldState);
    }

    // Minimap obstacle overlay is drawn by Minimap renderer.
    if (Object.prototype.hasOwnProperty.call(partial || {}, 'minimapShowObstacles')) {
      minimap?.setShowObstacles?.(CONFIG.MINIMAP_SHOW_OBSTACLES === true);
    }
  };

  gameApi.actions.updateSettings = (partial) => {
    const next = saveSettingsV2(partial);
    applySettingsToConfig(next, CONFIG);
    applySafeModeOverrides();
    applySettingsRuntimeEffects(partial);
    gameApi.emitSnapshot?.();
    return next;
  };
  gameApi.actions.updateDevSettings = (partial) => {
    if (!debugUiEnabled) return null;
    return gameApi.actions.updateSettings(partial);
  };
  gameApi.actions.resetSettings = () => {
    resetSettingsV2();
    const next = loadSettings();
    applySettingsToConfig(next, CONFIG);
    applySafeModeOverrides();
    applySettingsRuntimeEffects({ lowPerf: true, poolFx: true, hdri: true, safeMode: true });
    gameApi.emitSnapshot?.();
    return next;
  };

  const gun = new Gun(
    sceneManager.getScene(),
    camera,
    input,
    projectileManager,
    audioManager,
    weaponView,
    eventBus
  );
  gameApi.setRefs({ gun });

  encounterDirector = new EncounterDirector({
    eventBus,
    worldState,
    scene: sceneManager.getScene(),
    player,
    gun,
    gameState,
    monsterManager,
    interactableSystem,
    pickupManager,
    lights,
    audioManager
  });
  encounterDirector.startLevel(levelConfig);

  featureDirector = new FeatureDirector({
    eventBus,
    worldState,
    scene: sceneManager.getScene(),
    player,
    gameState,
    interactableSystem,
    audioManager
  });
  featureDirector.startLevel(levelConfig);

		  autopilot?.setGun?.(gun);
		  applyRogueliteRuntimeEffects(sceneManager, player, gun, levelConfig);
		  // Minimap forced state depends on minimap UI wiring; applied after minimap functions are defined.

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
  missionDirector?.syncStatus?.(true);

		  pickupManager = new PickupManager(sceneManager.getScene(), player, gameState, gun, audioManager, eventBus);
		  encounterDirector?.setRefs?.({ pickupManager });
		  spawnDirector = new SpawnDirector(monsterManager, player, pickupManager, eventBus);
		  spawnDirector.setGameState(gameState);
		  spawnDirector.setGun(gun);
		  spawnDirector.setProjectileManager?.(projectileManager);
		  levelLoading = spawnDirector.startLevel(levelConfig)
        .then(async () => {
          try {
            await bossSystem?.startLevel?.(levelConfig);
          } catch (err) {
            console.warn('⚠️ BossSystem start failed:', err?.message || err);
          }
        })
        .catch((err) => {
          console.warn('⚠️ SpawnDirector start failed:', err?.message || err);
        });

	  worldMarkerSystem = new WorldMarkerSystem({
	    eventBus,
	    scene: sceneManager.getScene(),
	    camera,
	    player,
	    worldState,
	    pickupManager,
	    toolSystem,
	    missionDirector,
	    exitPoint,
      monsterManager
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
		  gameLoop = new GameLoop(
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
    deviceManager,
    null,
	    interactableSystem,
	    missionDirector
			  );
			  gameLoop.worldMarkerSystem = worldMarkerSystem;
			  gameLoop.currentLevelIndex = currentLevelIndex;
			  gameLoop.levelConfig = levelConfig;
			  gameApi.setRefs({ gameLoop, levelConfig });

			  // UI snapshot ticker (React migration): emit every 200ms (not per-frame).
			  uiSnapshotBridge.start({ intervalMs: 200 });

	      // Watchdog auto-downgrade: when perf cliffs persist, force safe mode for the session.
	      gameLoop.onWatchdogTrip = ({ reason, fpsEma, dt } = {}) => {
	        if (CONFIG.SAFE_MODE_ENABLED === true) return;
	        CONFIG.SAFE_MODE_ENABLED = true;
	        applySafeModeOverrides();
	        sceneManager?.buildWorldFromGrid?.(worldState);
	        console.warn('🛟 WATCHDOG: entering safe mode', { reason, fpsEma, dt });
	      };

	      // Debug handle for field diagnostics (so "frozen" states can be inspected quickly).
	      window.__p3dm = {
	        get gameLoop() { return gameLoop; },
	        get gameState() { return gameState; },
        get worldState() { return worldState; },
        get player() { return player; },
        get monsterManager() { return monsterManager; },
        get gun() { return gun; },
        get spawnDirector() { return spawnDirector; }
      };

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
	      devicePositions: [
	        ...(toolSystem?.getDeviceMarkers?.() || []),
	        ...(deviceManager?.getDeviceMarkers?.() || [])
	      ],
		      navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
		      navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
		      aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
		        ? monsterManager.getAIDebugMinimapMarkers({
		          onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	          onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
          nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
        })
        : null
    }
  );
  console.log('✅ Initial minimap rendered');
  renderCampaignInfo();

  bootReady = true;
  homeMenu.setCanRestart(false, 'No active run yet');
  homeMenu.setCanAbandon(false, 'No active run yet');
  homeMenu.setCanSave(false, 'Start a run first');
  homeMenu.setStatus('Configure settings, then start.');

	  // Minimap controls
	  // NOTE: must be hoisted because minimap forced state can be applied earlier in initGame().
	  function syncMinimapUiState() {
	    gameApi?.setUiState?.({
	      minimap: {
	        hidden: minimapHidden === true,
	        forcedHidden: CONFIG.MINIMAP_FORCE_HIDDEN === true,
	        size: minimapDisplaySize ?? null,
	        zoom: Number(minimap?.zoom) || null
	      }
	    });
	  }

	  function applyMinimapForcedState() {
	    const forced = CONFIG.MINIMAP_FORCE_HIDDEN === true;
	    const viewport = minimapViewport || minimapCanvas;
	    if (!viewport) return;
	    if (forced) {
	      minimapHidden = true;
	      viewport.style.display = 'none';
	      syncMinimapUiState();
	      return;
	    }
	    // Not forced: keep current user state.
	    viewport.style.display = minimapHidden ? 'none' : 'block';
	    syncMinimapUiState();
	  }

	  function applyMinimapZoom(zoom) {
    const clamped = clampMinimapZoom(zoom) ?? minimap.zoom ?? DEFAULT_MINIMAP_ZOOM;
    const viewport = minimapViewport || minimapCanvas;
    if (viewport && CONFIG.MINIMAP_FORCE_HIDDEN !== true && minimapHidden) {
      minimapHidden = false;
      viewport.style.display = 'block';
    }
    minimap.setZoom(clamped);
    safeStorageSet(MINIMAP_STORAGE_ZOOM, clamped);
	    minimap.render(
	      player.getGridPosition(),
	      monsterManager.getMonsterPositions(),
	      exitPoint?.getGridPosition?.() || null,
	      missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
	      {
	        pickupPositions: pickupManager?.getPickupMarkers?.() || [],
	        devicePositions: [
	          ...(toolSystem?.getDeviceMarkers?.() || []),
	          ...(deviceManager?.getDeviceMarkers?.() || [])
	        ],
	        navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
	        navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
	        aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
	          ? monsterManager.getAIDebugMinimapMarkers({
	            onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	            onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
            nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
          })
          : null
      }
    );
    syncMinimapUiState();
    return clamped;
  }

	  // React UI actions for minimap controls
	  gameApi.actions.setMinimapHidden = (hidden) => {
	    if (CONFIG.MINIMAP_FORCE_HIDDEN === true) {
	      applyMinimapForcedState();
	      return;
	    }
	    minimapHidden = hidden === true;
	    const viewport = minimapViewport || minimapCanvas;
	    if (viewport) viewport.style.display = minimapHidden ? 'none' : 'block';
	    syncMinimapUiState();
	  };
	  gameApi.actions.setMinimapSize = (size) => applyMinimapSize(Number(size));
	  gameApi.actions.setMinimapZoom = (zoom) => applyMinimapZoom(Number(zoom));
	  gameApi.actions.resetMinimap = () => {
	    safeStorageRemove(MINIMAP_STORAGE_SIZE);
	    safeStorageRemove(MINIMAP_STORAGE_ZOOM);
	    applyMinimapSize(DEFAULT_MINIMAP_SIZE);
	    applyMinimapZoom(DEFAULT_MINIMAP_ZOOM);
	    syncMinimapUiState();
	  };

	  // Initial minimap snapshot values
	  applyMinimapForcedState();
	  syncMinimapUiState();

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
      levelConfig = applySettingsOverridesToLevelConfig(applyRogueliteToLevelConfig(
        levelDirector.getLevelConfig(currentLevelIndex, lastRunStats, lastOutcome),
        currentLevelIndex
      ));
      gameApi.setRefs({ levelConfig });
      gameLoop.currentLevelIndex = currentLevelIndex;
      gameLoop.levelConfig = levelConfig;
      diagnostics?.setContext?.({ levelIndex: currentLevelIndex, levelId: levelConfig?.id ?? levelConfig?.name ?? null, seed: levelConfig?.maze?.seed ?? null });
      console.log(`🔄 Loading level: ${levelConfig.name}`);
      lastOutcome = null;
      renderCampaignInfo();

      // 停止當前遊戲迴圈
      gameLoop.stop('loadLevel');
      gameLoop.resetRoundState();

      // Clear previous level objectives/interactables before rebuilding the scene
      missionDirector?.clear?.();
      encounterDirector?.clear?.();
      featureDirector?.clear?.();
      hidingSpotSystem?.clear?.();
      interactableSystem?.clear?.();
      toolSystem?.clear?.();
      deviceManager?.clear?.();
      bossSystem?.clear?.();

      // 更新血量上限
      if (resetGameState && gameState) {
        const maxHp = Math.round(100 * (levelConfig.player?.maxHealthMultiplier ?? 1));
        gameState.maxHealth = maxHp;
      }

      // 重建世界
      worldState.initialize(levelConfig);
      sceneManager.buildWorldFromGrid(worldState);
      // Re-apply user settings that depend on the rebuilt scene/world.
      sceneManager?.setObstacleOverlayEnabled?.(CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY ?? false, worldState);
      minimap?.setShowObstacles?.(CONFIG.MINIMAP_SHOW_OBSTACLES ?? false);
      if (sceneManager?.getScene?.()?.fog && Number.isFinite(CONFIG.FOG_DENSITY)) {
        sceneManager.getScene().fog.density = CONFIG.FOG_DENSITY;
      }
      if (camera?.getCamera && Number.isFinite(CONFIG.FOV)) {
        camera.getCamera().fov = CONFIG.FOV;
        camera.getCamera().updateProjectionMatrix();
      }
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
      deviceManager?.setRefs?.({
        eventBus,
        scene: sceneManager.getScene(),
        worldState,
        audioManager
      });
      deviceManager?.startLevel?.(levelConfig);

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
	          eventBus,
            bossSystem
	        });
	        missionDirector.startLevel(levelConfig);
	      }
        if (encounterDirector) {
          encounterDirector.setRefs({
            worldState,
            scene: sceneManager.getScene(),
            player,
            gun,
            gameState,
            monsterManager,
            interactableSystem,
            pickupManager,
            lights,
            audioManager,
            eventBus
          });
          encounterDirector.startLevel(levelConfig);
        }
        if (featureDirector) {
          featureDirector.setRefs({
            worldState,
            scene: sceneManager.getScene(),
            player,
            gameState,
            interactableSystem,
            audioManager,
            eventBus
          });
          featureDirector.startLevel(levelConfig);
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

      if (startLoop) {
        homeMenu?.setVisible?.(false);
        hasRunStarted = true;
        homeMenu?.setCanContinue?.(true);
        homeMenu?.setCanRestart?.(true);
      }

      // 重建怪物
      monsterManager.clear();
      const spawnPromise = spawnDirector
        ? spawnDirector.startLevel(levelConfig)
        : monsterManager.initializeForLevel(levelConfig);
      if (spawnPromise?.catch) {
        spawnPromise.catch((err) => console.warn('⚠️ Monster spawn failed:', err?.message || err));
      }
      monsterManager.setProjectileManager(projectileManager);

      bossSystem?.setRefs?.({
        eventBus,
        worldState,
        monsterManager,
        deviceManager,
        gameState,
        audioManager
      });
      const bossPromise = bossSystem?.startLevel?.(levelConfig);
      if (bossPromise?.catch) {
        bossPromise.catch((err) => console.warn('⚠️ BossSystem start failed:', err?.message || err));
      }

      // 重建自動駕駛
      autopilot = new AutoPilot(
        worldState,
        monsterManager,
        () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
        exitPoint,
        player,
        levelConfig,
        () => (pickupManager?.getPickupMarkers?.() || []),
        { interactableSystem, toolSystem, gameState }
      );
      autopilot?.setGun?.(gun);
      gameLoop.autopilot = autopilot;
      gameLoop.autopilotActive = CONFIG.AUTOPILOT_ENABLED;
      projectileManager.worldState = worldState;
      projectileManager.monsterManager = monsterManager;
      projectileManager.setPlayerRef?.(player);
      projectileManager.setExtraHittablesProvider?.(() => (deviceManager?.getHittables?.() || []));
      projectileManager.reset?.();
      gameLoop.projectileManager = projectileManager;
	      gameLoop.gun = gun;
	      gameLoop.spawnDirector = spawnDirector;
	      gun.reset?.();
	      applyRogueliteRuntimeEffects(sceneManager, player, gun, levelConfig);
	      applyMinimapForcedState();

      // 更新 minimap
      minimap.updateScale();
	      minimap.render(
	        player.getGridPosition(),
	        monsterManager.getMonsterPositions(),
	        newExitPos,
	        missionDirector?.getAutopilotTargets ? missionDirector.getAutopilotTargets().map(t => t.gridPos) : [],
	        {
	          pickupPositions: pickupManager?.getPickupMarkers?.() || [],
	          devicePositions: [
	            ...(toolSystem?.getDeviceMarkers?.() || []),
	            ...(deviceManager?.getDeviceMarkers?.() || [])
	          ],
	          navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
	          navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
	          aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
	            ? monsterManager.getAIDebugMinimapMarkers({
	              onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	              onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
              nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
            })
            : null
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

  // 通關後等待使用者確認
  gameLoop.onWin = () => {
    lastOutcome = 'win';
    lastRunStats = gameState.getStats();
    campaignState = campaignManager.recordWin(campaignState, currentLevelIndex, levelConfig, lastRunStats);
    {
      const { next, changed } = grantProgressionUnlocks(campaignState?.permanent, currentLevelIndex);
      if (changed) {
        campaignState = { ...campaignState, permanent: next };
        campaignManager.save(campaignState);
      }
    }
    renderCampaignInfo();
    input.exitPointerLock();
    gameState?.pauseTimer?.();

    const levelCount = getCampaignLevelCount();
    const completedAll = campaignState?.run?.currentLevelIndex >= levelCount;
    if (completedAll) {
      clearAutoGameOverTimer();
      gameLoop.stop('campaignComplete');
      showCampaignVictory();
      return;
    }
  };
  gameLoop.onLose = () => {
    lastOutcome = 'lose';
    lastRunStats = gameState.getStats();
    const prevFailures = campaignState?.run?.failures ?? 0;
    campaignState = campaignManager.recordLoss(campaignState, currentLevelIndex, levelConfig, lastRunStats);
    renderCampaignInfo();
    input.exitPointerLock();
    gameState?.pauseTimer?.();

    const resetTriggered =
      (prevFailures + 1 >= (campaignState?.lastRunSummary?.failureLimit ?? 2)) &&
      (campaignState?.run?.failures ?? 0) === 0 &&
      campaignState?.lastRunSummary?.endReason === 'failureLimit';

    if (resetTriggered) {
      clearAutoGameOverTimer();
      input.exitPointerLock();
      gameLoop.stop('campaignFailureLimit');
      hasRunStarted = false;

	      currentLevelIndex = 0;
	      levelConfig = applySettingsOverridesToLevelConfig(levelDirector.getLevelConfig(0));
	      renderCampaignInfo();

    homeMenu?.setActiveTab?.('play');
    homeMenu?.setCanContinue?.(false, 'No active run');
    homeMenu?.setCanRestart?.(false, 'No active run');
    homeMenu?.setCanAbandon?.(false, 'No active run');
    homeMenu?.setStatus?.('Reached the failure limit → campaign reset to Level 1.');
    homeMenu?.setVisible?.(true);

    // Always show the final report when a run ends (failure limit).
    if (campaignState?.lastRunSummary) {
      showCampaignSummary(campaignState.lastRunSummary, 'Run Report');
    } else {
      homeMenu?.setVisible?.(true);
    }
    return;
  }
  };

	  // Setup minimap click to teleport
	  minimapCanvas.addEventListener('click', (e) => {
	    if (!debugUiEnabled || !minimapClickTeleportEnabled) return;
	    if (!document.body.classList.contains('mode-game')) return;
	    if (gameState?.gameOver) return;
	    if (gameLoop?.running !== true) return;

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

    if (campaignManager.isComplete(campaignState)) {
      showCampaignVictory();
      return;
    }

    markTutorialSeen();
    homeMenu.setStatus('Starting…');
    homeMenu.setVisible(false);
    try {
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
    } catch (err) {
      console.warn('⚠️ StartNewRun failed:', err?.message || err);
      homeMenu.setVisible(true);
      homeMenu.setActiveTab('play');
      homeMenu.setStatus(`Start failed: ${String(err?.message || err)}`);
    }
  }

  async function continueRun() {
    if (!hasRunStarted || gameState?.gameOver) return;
    console.log('▶️ Home: continue');
    markTutorialSeen();
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
    gameLoop.stop('resetCampaign');
    gameLoop.resetRoundState?.();

    // Keep gameState intact for debugging if it exists.
    gameState?.reset?.();
    hasRunStarted = false;

	    currentLevelIndex = 0;
	    levelConfig = applySettingsOverridesToLevelConfig(levelDirector.getLevelConfig(0));
	    renderCampaignInfo();

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

    markTutorialSeen();
    homeMenu?.setStatus?.('Loading save…');
    homeMenu?.setVisible?.(false);
    clearAutoGameOverTimer();

    // Campaign metadata
    if (save.campaignState && typeof save.campaignState === 'object') {
      campaignState = save.campaignState;
      campaignManager.save(campaignState);
      renderCampaignInfo();
    }

    // Stop the current loop and clear round state
    gameLoop.stop('menu:escape');
    gameLoop.resetRoundState();

    // Clear previous level objectives/interactables before rebuilding the scene
    missionDirector?.clear?.();
    encounterDirector?.clear?.();
    featureDirector?.clear?.();
    hidingSpotSystem?.clear?.();
    interactableSystem?.clear?.();
    toolSystem?.clear?.();

    currentLevelIndex = clampLevelIndex(save.currentLevelIndex ?? 0);
    levelConfig = levelDirector.getLevelConfig(currentLevelIndex, lastRunStats, lastOutcome);
    gameApi.setRefs({ levelConfig });
    renderCampaignInfo();

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
        eventBus,
        bossSystem
      });
      missionDirector.startLevel(levelConfig);
    }
    if (encounterDirector) {
      encounterDirector.setRefs({
        worldState,
        scene: sceneManager.getScene(),
        player,
        gun,
        gameState,
        monsterManager,
        interactableSystem,
        pickupManager,
        lights,
        audioManager,
        eventBus
      });
      encounterDirector.startLevel(levelConfig);
    }
    if (featureDirector) {
      featureDirector.setRefs({
        worldState,
        scene: sceneManager.getScene(),
        player,
        gameState,
        interactableSystem,
        audioManager,
        eventBus
      });
      featureDirector.startLevel(levelConfig);
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
    const spawnPromise = spawnDirector
      ? spawnDirector.startLevel(levelConfig)
      : monsterManager.initializeForLevel(levelConfig);
    if (spawnPromise?.catch) {
      spawnPromise.catch((err) => console.warn('⚠️ Monster spawn failed:', err?.message || err));
    }
    monsterManager.setProjectileManager(projectileManager);

    bossSystem?.setRefs?.({
      eventBus,
      worldState,
      monsterManager,
      deviceManager,
      gameState,
      audioManager
    });
    const bossPromise = bossSystem?.startLevel?.(levelConfig);
    if (bossPromise?.catch) {
      bossPromise.catch((err) => console.warn('⚠️ BossSystem start failed:', err?.message || err));
    }

    // Rebuild autopilot + projectile system
    autopilot = new AutoPilot(
      worldState,
      monsterManager,
      () => (missionDirector?.getAutopilotState ? missionDirector.getAutopilotState() : []),
      exitPoint,
      player,
      levelConfig,
      () => (pickupManager?.getPickupMarkers?.() || []),
      { interactableSystem, toolSystem, gameState }
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
	        devicePositions: [
	          ...(toolSystem?.getDeviceMarkers?.() || []),
	          ...(deviceManager?.getDeviceMarkers?.() || [])
	        ],
	        navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (worldState?.getNavHeat?.() || null) : null,
	        navHeatAlpha: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55) : null,
	        aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && monsterManager?.getAIDebugMinimapMarkers)
	          ? monsterManager.getAIDebugMinimapMarkers({
	            onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
	            onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
            nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
          })
          : null
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

    homeMenu.setStatus('Restarting…');
    homeMenu.setVisible(false);
    try {
      input.resetState?.();
      input.requestPointerLock(container);
      audioManager.playAmbient();
      await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
      homeMenu.setCanContinue(true);
      homeMenu.setCanRestart(true);
      homeMenu.setCanAbandon(true);
      homeMenu.setStatus('');
      input.requestPointerLock(container);
    } catch (err) {
      console.warn('⚠️ RestartRun failed:', err?.message || err);
      homeMenu.setVisible(true);
      homeMenu.setActiveTab('play');
      homeMenu.setStatus(`Restart failed: ${String(err?.message || err)}`);
    }
  }

  async function abandonRun() {
    if (!hasRunStarted) return;
    console.log('🏳️ Home: abandon run');

    clearAutoGameOverTimer();

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
    gameLoop.stop('run:abandon');
    gameState.reset();
    hasRunStarted = false;

    // Show the "celebration" summary screen using cleared levels only.
    showCampaignSummary(summary, 'Run Report');
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

  // F1 opens the Guide panel (and pauses game)
  window.addEventListener('keydown', (e) => {
    const tag = String(e.target?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
    if (isTyping) return;

    if (e.code !== 'F1') return;
    e.preventDefault();

    if (!instructionsOverlay?.classList.contains('hidden')) {
      homeMenu?.setActiveTab?.('guide');
      return;
    }

    input.exitPointerLock();
    input.resetState?.();
    gameState?.pauseTimer?.();
    gameLoop.stop('menu:f1');
    homeMenu.setVisible(true);
    homeMenu.setActiveTab('guide');

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
    homeMenu.setStatus('Guide opened (paused). Press ESC to resume.');
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

  function returnToMenuFromGameOver() {
    console.log('📋 Returning to menu...');
    clearAutoGameOverTimer();
    if (gameState?.gameOver) {
      const currentStats = gameState?.getStats ? gameState.getStats() : null;
      const reason = gameState?.hasWon ? 'victory' : gameState?.hasLost ? 'defeat' : 'abandon';
      const { next, summary } = campaignManager.endRun(campaignState, {
        reason,
        atLevelIndex: currentLevelIndex,
        levelConfig,
        stats: currentStats
      });
      campaignState = next;
      renderCampaignInfo();
      hasRunStarted = false;
      showCampaignSummary(summary, 'Run Report');
    }

    gameLoop.stop('menu:gameOverMenu');
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
  }

  // Legacy UI panels removed; React UI uses GameAPI + EventBus only.

  // Wire remaining GameAPI actions that depend on late-bound functions/refs.
  gameApi.actions.regenerateMap = async () => loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
  gameApi.actions.respawnEnemies = async () => {
    const sd = spawnDirector || gameLoop?.spawnDirector || null;
    const mm = gameLoop?.monsterManager || null;
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
  };
  gameApi.actions.setMonsterModelPath = async (modelPath) => {
    const nextPath = String(modelPath || '').trim();
    if (!nextPath) return false;
    const next = gameApi.actions.updateSettings({ monsterModelPath: nextPath });
    CONFIG.MONSTER_MODEL = nextPath;
    try {
      const mm = gameLoop?.monsterManager || null;
      await mm?.changeMonsterModel?.(nextPath);
    } catch (err) {
      console.warn('⚠️ Failed to change monster model:', err);
      return false;
    }
    return !!next;
  };
  gameApi.actions.setWeaponModelPath = async (modelPath) => {
    const nextPath = String(modelPath || '').trim();
    if (!nextPath) return false;
    const next = gameApi.actions.updateSettings({ weaponModelPath: nextPath });
    CONFIG.PLAYER_WEAPON_MODEL_PATH = nextPath;
    try {
      await weaponView?.setModelPath?.(nextPath);
    } catch (err) {
      console.warn('⚠️ Failed to change weapon model:', err);
      return false;
    }
    return !!next;
  };
  gameApi.actions.setSeed = (seed) => {
    const value = (seed === null || seed === undefined) ? null : String(seed);
    CONFIG.MAZE_SEED = value;
    saveSettingsV2({ mazeSeed: value });
  };
  gameApi.actions.getAutopilotEnabled = () => CONFIG.AUTOPILOT_ENABLED === true;
  gameApi.actions.setAutopilotEnabled = (enabled) => {
    CONFIG.AUTOPILOT_ENABLED = enabled === true;
    if (gameLoop) gameLoop.autopilotActive = CONFIG.AUTOPILOT_ENABLED;
  };
  gameApi.actions.restartLevel = async () => {
    await loadLevel(currentLevelIndex, { startLoop: true, resetGameState: true });
  };
  gameApi.actions.nextLevel = async () => {
    await loadLevel(currentLevelIndex + 1, { startLoop: true, resetGameState: true });
  };
  gameApi.actions.prevLevel = async () => {
    await loadLevel(currentLevelIndex - 1, { startLoop: true, resetGameState: true });
  };
  gameApi.actions.jumpToLevel = async (levelNumber) => {
    const raw = Math.round(Number(levelNumber) || 1);
    const maxJump = levelDirector?.getMaxJump?.();
    const max = Number.isFinite(maxJump) ? maxJump : Infinity;
    const target = Math.max(1, Math.min(max, raw));
    await loadLevel(target - 1, { startLoop: true, resetGameState: true });
  };
  gameApi.actions.returnToMenu = () => {
    returnToMenuFromGameOver();
  };

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


// Legacy (pre-React) settings/debug panels removed.


// Start the game when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initGame().catch((err) => {
      const msg = String(err?.message || err || 'Unknown init error');
      console.error('💥 initGame failed:', msg, err);
      setBootStatus(`Boot error: ${msg}`);
    });
  });
} else {
  initGame().catch((err) => {
    const msg = String(err?.message || err || 'Unknown init error');
    console.error('💥 initGame failed:', msg, err);
    setBootStatus(`Boot error: ${msg}`);
  });
}
