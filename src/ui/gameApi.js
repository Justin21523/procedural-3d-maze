import { EVENTS } from '../core/events.js';
import { CONFIG } from '../core/config.js';
import { computeLevelScore } from '../core/campaignManager.js';

function noop() {}

export function createGameApi() {
  const refs = {
    eventBus: null,
    diagnostics: null,
    worldState: null,
    gameState: null,
    gameLoop: null,
    levelConfig: null,
    player: null,
    gun: null,
    input: null,
    camera: null,
    sceneManager: null,
    minimap: null,
    weaponView: null,
    uiState: {
      home: {
        visible: true,
        activeTab: 'play',
        status: '',
        saveInfo: '',
        canContinue: false,
        continueReason: '',
        canRestart: false,
        restartReason: '',
        canAbandon: false,
        abandonReason: '',
        canRestartCampaign: true,
        canSave: false,
        saveReason: '',
        canLoadSave: false,
        loadSaveReason: '',
        canClearSave: false,
        clearSaveReason: ''
      },
      campaign: {
        infoText: '',
        hudText: '',
        levelCount: null,
        completedLevels: null,
        failures: null,
        failureLimit: null,
        nextLevelIndex: null,
        nextLevelName: null,
        isComplete: false,
        lastRunText: ''
      },
      victory: {
        visible: false,
        title: 'Campaign Report',
        summaryText: '',
        rows: []
      },
      hud: {
        missionObjective: '',
        exitUnlocked: null,
        exitLockedReason: '',
        gameOverReason: ''
      },
      minimap: {
        hidden: false,
        forcedHidden: false,
        size: null,
        zoom: null
      },
      debug: {
        overlay: false,
        markers: false,
        navHeatmap: false,
        minimapShowObstacles: false,
        worldShowObstacleOverlay: false,
        minimapTeleportEnabled: false,
        lines3d: false,
        chaseOnly: false,
        leaderOnly: false,
        nearestN: 0,
        hearingGlobalMult: null,
        hearingUsePathDistance: null,
        hearingCorridorCostMult: null,
        hearingRoomCostMult: null,
        hearingDoorCostMult: null,
        hearingThroughWallEnabled: null,
        hearingMaxWallTiles: null,
        hearingWallPenalty: null,
        hearingBlockedDoorPenalty: null
      }
    }
  };

  const api = {
    setRefs(next = {}) {
      Object.assign(refs, next || {});
    },
    getRefs() {
      return refs;
    },
    getUiState() {
      return refs.uiState;
    },
    setUiState(partial = {}) {
      if (!partial || typeof partial !== 'object') return;
      if (!refs.uiState || typeof refs.uiState !== 'object') refs.uiState = {};
      for (const [key, value] of Object.entries(partial)) {
        if (!value || typeof value !== 'object') {
          refs.uiState[key] = value;
          continue;
        }
        if (!refs.uiState[key] || typeof refs.uiState[key] !== 'object') {
          refs.uiState[key] = {};
        }
        Object.assign(refs.uiState[key], value);
      }
      // React UI expects immediate updates for menu tabs/prompts (not only the 200ms ticker).
      this.emitSnapshot?.();
    },
    getSnapshot() {
      const gs = refs.gameState;
      const gl = refs.gameLoop;
      const cfg = refs.levelConfig || gl?.levelConfig || null;
      const perf = gl?._perf || {};
      const t = gs?.currentTime ?? null;
      const debugUiEnabled = (() => {
        try {
          return document.body?.classList?.contains?.('show-debug') === true;
        } catch {
          return false;
        }
      })();
      const home = refs.uiState?.home || {};
      const campaign = refs.uiState?.campaign || {};
      const victory = refs.uiState?.victory || {};
      const hud = refs.uiState?.hud || {};
      const minimapState = refs.uiState?.minimap || {};
      const debug = refs.uiState?.debug || {};
      const diag = refs.diagnostics || null;
      const errors = diag?.getRecentErrors?.() || [];
      const lastErr = errors.length ? errors[errors.length - 1] : null;
      const noise = diag?.getRecentNoise?.() || [];
      const stats = typeof gs?.getStats === 'function' ? gs.getStats() : null;
      const score = stats ? computeLevelScore(stats) : null;
      const inventory = typeof gs?.getInventorySnapshot === 'function' ? (gs.getInventorySnapshot() || {}) : {};
      const weaponHud = refs.gun?.getHudState ? refs.gun.getHudState() : null;
      const playerGrid = refs.player?.getGridPosition ? refs.player.getGridPosition() : null;
      const playerPos = refs.player?.getPosition ? refs.player.getPosition() : null;
      const roomType = (refs.worldState?.getRoomType && playerGrid)
        ? refs.worldState.getRoomType(playerGrid.x, playerGrid.y)
        : null;
      const spawnGridRaw = refs.worldState?.spawnPoint || refs.worldState?.getSpawnPoint?.() || null;
      const exitGridRaw = refs.worldState?.getExitPoint?.() || refs.worldState?.exitPoint || null;
      const spawnGrid = (spawnGridRaw && Number.isFinite(spawnGridRaw.x) && Number.isFinite(spawnGridRaw.y))
        ? { x: spawnGridRaw.x, y: spawnGridRaw.y }
        : null;
      const exitGrid = (exitGridRaw && Number.isFinite(exitGridRaw.x) && Number.isFinite(exitGridRaw.y))
        ? { x: exitGridRaw.x, y: exitGridRaw.y }
        : null;
      const pointerLocked = refs.input?.isPointerLocked
        ? refs.input.isPointerLocked()
        : (typeof document !== 'undefined' ? document.pointerLockElement !== null : false);
      const keysDown = (() => {
        const keys = refs.input?.keys;
        if (!keys || typeof keys !== 'object') return [];
        const down = [];
        for (const [code, pressed] of Object.entries(keys)) {
          if (pressed) down.push(code);
        }
        down.sort();
        return down.slice(0, 10);
      })();
      const rendererInfo = (() => {
        const r = refs.sceneManager?.renderer || null;
        const info = r?.info || null;
        const mem = info?.memory || null;
        const ren = info?.render || null;
        const fs = refs.sceneManager?.frameStats || null;
        return {
          calls: ren?.calls ?? null,
          triangles: ren?.triangles ?? null,
          lines: ren?.lines ?? null,
          points: ren?.points ?? null,
          geometries: mem?.geometries ?? null,
          textures: mem?.textures ?? null,
          frameMs: fs?.frameMs ?? null,
          updateMs: fs?.updateMs ?? null,
          renderMs: fs?.renderMs ?? null,
          pixelRatio: fs?.pixelRatio ?? null
        };
      })();
      const ai = refs.monsterManager?.getAIDebugSnapshotFiltered
        ? refs.monsterManager.getAIDebugSnapshotFiltered({
          onlyChasing: debug.chaseOnly === true,
          onlyLeader: debug.leaderOnly === true,
          nearestN: Number(debug.nearestN) || 0
        })
        : null;
      return {
        debugUiEnabled,
        uiFlags: {
          crosshairEnabled: CONFIG.PLAYER_CROSSHAIR_ENABLED !== false
        },
        t: Number.isFinite(t) ? t : null,
        levelIndex: gl?.currentLevelIndex ?? null,
        levelId: cfg?.id ?? cfg?.name ?? null,
        seed: cfg?.maze?.seed ?? refs.worldState?.seed ?? null,
        health: gs?.currentHealth ?? null,
        maxHealth: gs?.maxHealth ?? null,
        ammo: refs.gun?.ammo ?? refs.gun?.state?.ammo ?? null,
        fpsEma: perf?.fpsEma ?? null,
        dt: gl?.frameContext?.dt ?? null,
        playerGrid,
        spawnGrid,
        exitGrid,
        playerPos: playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : null,
        roomType,
        pointerLocked,
        keysDown,
        rendererInfo,
        gameOver: gs?.gameOver ?? false,
        victory: gs?.hasWon ?? false,
        defeat: gs?.hasLost ?? false,
        mutators: cfg?.roguelite?.mutators ?? [],
        home: { ...home },
        campaign: { ...campaign },
        victoryReport: {
          visible: !!victory.visible,
          title: String(victory.title || 'Campaign Report'),
          summaryText: String(victory.summaryText || ''),
          rows: Array.isArray(victory.rows) ? victory.rows.slice() : []
        },
        hud: { ...hud },
        minimap: { ...minimapState },
        debugPrefs: { ...debug },
        aiDebug: ai,
        inventory,
        weaponHud: weaponHud ? {
          weaponName: weaponHud.weaponName ?? null,
          ammoInMag: weaponHud.ammoInMag ?? null,
          magSize: weaponHud.magSize ?? null,
          ammoReserve: weaponHud.ammoReserve ?? null,
          isReloading: weaponHud.isReloading ?? null,
          reloadProgress: weaponHud.reloadProgress ?? null,
          skills: weaponHud.skills ?? null,
          weaponMods: weaponHud.weaponMods ?? null,
          modeLabel: weaponHud.modeLabel ?? null
        } : null,
        runStats: stats ? { ...stats, score } : null,
        diagnostics: {
          showCrashOverlay: !!diag?.shouldShowCrashOverlay?.(),
          errorCount: errors.length,
          lastError: lastErr ? {
            tMs: lastErr.tMs,
            source: lastErr.source,
            message: lastErr.message,
            stack: lastErr.stack
          } : null,
          recentErrors: errors.slice(-5),
          recentNoise: noise.slice(-20)
        }
      };
    },
    getSettings: () => null,
    actions: {
      setSetting: noop,
      updateSettings: noop,
      resetSettings: noop,
      setHomeTab: noop,
      applySafeMode: noop,
      regenerateMap: noop,
      respawnEnemies: noop,
      setSeed: noop,
      toggleDebug: noop,
      copyCrashReport: async () => false,
      startNewRun: noop,
      continueRun: noop,
      restartRun: noop,
      abandonRun: noop,
      restartCampaign: noop,
      saveGame: noop,
      loadSavedGame: noop,
      clearSavedGame: noop,
      dismissCampaignReport: noop,
      updateDebugPrefs: noop,
      getAutopilotEnabled: () => null,
      setAutopilotEnabled: noop,
      restartLevel: noop,
      nextLevel: noop,
      returnToMenu: noop,
      setMinimapHidden: noop,
      setMinimapSize: noop,
      setMinimapZoom: noop,
      resetMinimap: noop,
      prevLevel: noop,
      jumpToLevel: noop,
      openDebugHub: noop,
      openEnemyLab: noop,
      openAiTest: noop,
      openDiagnostics: noop,
      updateDevSettings: noop,
      setMonsterModelPath: noop,
      setWeaponModelPath: noop,

      // Debug/cheats (React Debug panel)
      debugTeleportSpawn: noop,
      debugTeleportExit: noop,
      debugTeleportRandom: noop,
      debugTeleportMonster: noop,
      debugTeleportGrid: noop,
      debugSetGodMode: noop,
      debugSetHealthPercent: noop,
      debugAdjustHealth: noop,
      debugTimeReset: noop,
      debugTimeToggle: noop,
      debugTimePlus: noop,
      debugTimeMinus: noop,
      debugForceWin: noop,
      debugForceLose: noop,
      debugSpeedPreset: noop
    },
    subscribe(eventName, cb) {
      const bus = refs.eventBus;
      if (!bus?.on) return () => {};
      return bus.on(eventName, cb);
    },
    emit(eventName, payload) {
      const bus = refs.eventBus;
      if (!bus?.emit) return;
      bus.emit(eventName, payload);
    },
    emitSnapshot() {
      const bus = refs.eventBus;
      if (!bus?.emit) return;
      bus.emit(EVENTS.UI_SNAPSHOT, this.getSnapshot());
    }
  };

  return api;
}
