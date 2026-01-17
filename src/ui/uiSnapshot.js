import { EVENTS } from '../core/events.js';

export function createUiSnapshotBridge({
  gameApi,
  eventBus,
  diagnostics,
  getGameLoop,
  getWorldState,
  getLevelConfig,
} = {}) {
  const subs = [];
  let timer = null;

  function on(eventName, fn) {
    if (!eventBus?.on) return;
    subs.push(eventBus.on(eventName, fn));
  }

  function attach() {
    on(EVENTS.MISSION_UPDATED, (payload) => {
      const objective = payload?.objectiveText ?? payload?.summary ?? '';
      gameApi?.setUiState?.({ hud: { missionObjective: objective ? String(objective) : '' } });
    });
    on(EVENTS.EXIT_LOCKED, (payload) => {
      const msg = String(payload?.message || 'Exit locked');
      gameApi?.setUiState?.({ hud: { exitUnlocked: false, exitLockedReason: msg } });
    });
    on(EVENTS.EXIT_UNLOCKED, () => {
      gameApi?.setUiState?.({ hud: { exitUnlocked: true, exitLockedReason: '' } });
    });
    on(EVENTS.GAME_WON, (payload) => {
      gameApi?.setUiState?.({ hud: { gameOverReason: String(payload?.reason || 'You found the exit!') } });
    });
    on(EVENTS.GAME_LOST, (payload) => {
      gameApi?.setUiState?.({ hud: { gameOverReason: String(payload?.reason || 'Game over') } });
    });
  }

  function start({ intervalMs = 200 } = {}) {
    stop();
    const ms = Math.max(50, Math.round(Number(intervalMs) || 200));
    timer = setInterval(() => {
      const gl = typeof getGameLoop === 'function' ? getGameLoop() : null;
      const ws = typeof getWorldState === 'function' ? getWorldState() : null;
      const cfg = typeof getLevelConfig === 'function' ? getLevelConfig() : (gl?.levelConfig ?? null);
      const perf = gl?._perf || {};
      diagnostics?.setPerfSample?.({ fpsEma: perf.fpsEma, dt: gl?.frameContext?.dt, guardTier: perf.guardTier });
      diagnostics?.setContext?.({
        levelIndex: gl?.currentLevelIndex ?? null,
        levelId: cfg?.id ?? cfg?.name ?? null,
        seed: cfg?.maze?.seed ?? ws?.seed ?? null
      });
      gameApi?.emitSnapshot?.();
    }, ms);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function dispose() {
    stop();
    for (const off of subs.splice(0)) off?.();
  }

  return { attach, start, stop, dispose };
}

