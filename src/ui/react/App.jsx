import React from 'react';
import { useGameApi } from './GameApiContext.jsx';
import { HomeMenu } from './panels/HomeMenu.jsx';
import { Hud } from './panels/Hud.jsx';
import { ToastHost } from './overlays/ToastHost.jsx';
import { CrashOverlay } from './overlays/CrashOverlay.jsx';
import { VictoryReportOverlay } from './overlays/VictoryReportOverlay.jsx';
import { PromptHost } from './overlays/PromptHost.jsx';
import { InteractPromptOverlay } from './overlays/InteractPromptOverlay.jsx';
import { KeypadOverlay } from './overlays/KeypadOverlay.jsx';
import { GameOverOverlay } from './overlays/GameOverOverlay.jsx';
import { CrosshairOverlay } from './overlays/CrosshairOverlay.jsx';
import { MinimapChrome } from './overlays/MinimapChrome.jsx';

function useBodyDebugFlag() {
  const [enabled, setEnabled] = React.useState(() => document.body.classList.contains('show-debug'));

  React.useEffect(() => {
    const obs = new MutationObserver(() => {
      setEnabled(document.body.classList.contains('show-debug'));
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return enabled;
}

function useBodyFlag(className) {
  const [enabled, setEnabled] = React.useState(() => document.body.classList.contains(className));

  React.useEffect(() => {
    const obs = new MutationObserver(() => {
      setEnabled(document.body.classList.contains(className));
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [className]);

  return enabled;
}

export function App() {
  const gameApi = useGameApi();
  const debugUi = useBodyDebugFlag();
  const inHome = useBodyFlag('mode-home');
  const inGame = useBodyFlag('mode-game');
  const [snapshot, setSnapshot] = React.useState(() => gameApi?.getSnapshot?.() ?? null);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const off = gameApi.subscribe('ui:snapshot', (s) => setSnapshot(s || null));
    return () => off?.();
  }, [gameApi]);

  const s = snapshot || {};

  return (
    <div style={{ width: '100%', pointerEvents: 'auto' }}>
      <ToastHost />
      <PromptHost />
      <CrashOverlay snapshot={s} />
      <VictoryReportOverlay snapshot={s} />
      <GameOverOverlay snapshot={s} />
      <CrosshairOverlay snapshot={s} />
      <InteractPromptOverlay />
      <KeypadOverlay />
      {inHome ? <HomeMenu snapshot={s} debugUi={debugUi} /> : null}
      {inGame ? <Hud snapshot={s} /> : null}
      {inGame ? <MinimapChrome snapshot={s} /> : null}
      {debugUi && !inHome ? (
        <div style={{
          position: 'fixed',
          top: 8,
          left: 8,
          zIndex: 3000,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.92)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 11,
          whiteSpace: 'pre',
          pointerEvents: 'none'
        }}>
          {`React UI active\nlevel=${s.levelIndex ?? '-'} seed=${s.seed ?? '-'} fps=${s.fpsEma ? s.fpsEma.toFixed(1) : '-'}`}
        </div>
      ) : null}
    </div>
  );
}
