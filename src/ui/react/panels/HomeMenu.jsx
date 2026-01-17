import React from 'react';
import { createPortal } from 'react-dom';
import { useGameApi } from '../GameApiContext.jsx';
import { SettingsPanel } from './SettingsPanel.jsx';
import { DebugPanel } from './DebugPanel.jsx';
import { GuidePanel } from './GuidePanel.jsx';

function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`home-tab-btn ${active ? 'active' : ''}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ActionButton({ variant = 'secondary', size = 'md', disabled = false, title = '', onClick, children }) {
  const cls =
    `btn ` +
    (variant === 'primary' ? 'btn--primary ' :
      variant === 'accent' ? 'btn--accent ' :
        variant === 'danger' ? 'btn--danger ' :
          'btn--secondary ') +
    (size === 'sm' ? 'btn--sm' : '');
  return (
    <button
      type="button"
      className={cls.trim()}
      disabled={disabled}
      title={disabled ? title : ''}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Panel({ active, children }) {
  return (
    <div className={`home-panel ${active ? '' : 'hidden'}`}>
      {children}
    </div>
  );
}

function SubtleNote({ children }) {
  return (
    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.86, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

export function HomeMenu({ snapshot, debugUi }) {
  const gameApi = useGameApi();
  const target = React.useMemo(() => document.getElementById('home-react-root'), []);
  const home = snapshot?.home || {};
  const campaign = snapshot?.campaign || {};
  const activeTab = String(home.activeTab || 'play');

  const [seed, setSeed] = React.useState(() => String(gameApi?.getSettings?.()?.mazeSeed ?? ''));
  React.useEffect(() => {
    setSeed(String(gameApi?.getSettings?.()?.mazeSeed ?? ''));
  }, [gameApi]);

  const tabs = React.useMemo(() => {
    return [
      { key: 'play', label: 'Play' },
      { key: 'guide', label: 'Guide' },
      { key: 'settings', label: 'Settings' },
      { key: 'tools', label: 'Tools' },
      { key: 'debug', label: 'Debug' }
    ];
  }, [debugUi]);

  const setTab = React.useCallback((key) => {
    gameApi?.actions?.setHomeTab?.(key);
  }, [gameApi]);

  const content = (
    <div>
      <div className="home-header" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div className="home-title" style={{ color: '#ffd700', fontSize: 26, fontWeight: 800, letterSpacing: 0.2 }}>
          Procedural 3D Maze
        </div>
        <div className="home-status" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, textAlign: 'right', lineHeight: 1.35, whiteSpace: 'pre-line' }}>
          {String(home.status || '')}
        </div>
      </div>

      <div className="home-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 14px 0', padding: 0, listStyle: 'none' }}>
        {tabs.map((t) => (
          <TabButton key={t.key} active={t.key === activeTab} onClick={() => setTab(t.key)}>
            {t.label}
          </TabButton>
        ))}
      </div>

      <Panel active={activeTab === 'play'}>
        <h2>Play</h2>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.5 }}>
          Configure settings, then start. Press ESC to return here. Press F1 to open Guide.
        </div>
        <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 1.6 }}>
          <div><span style={{ color: '#ffd700', fontWeight: 900 }}>WASD</span> move • <span style={{ color: '#ffd700', fontWeight: 900 }}>Mouse</span> look • <span style={{ color: '#ffd700', fontWeight: 900 }}>Shift</span> run</div>
          <div><span style={{ color: '#ffd700', fontWeight: 900 }}>E</span> interact • <span style={{ color: '#ffd700', fontWeight: 900 }}>Click</span> shoot</div>
          <div><span style={{ color: '#ffd700', fontWeight: 900 }}>ESC</span> menu/pause • <span style={{ color: '#ffd700', fontWeight: 900 }}>F5/F9</span> quick save/load</div>
        </div>

        {campaign.infoText ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
            {String(campaign.infoText || '')}
          </div>
        ) : null}

        <div className="home-actions" style={{ marginTop: 12 }}>
          <ActionButton variant="primary" onClick={() => gameApi?.actions?.startNewRun?.()}>
            Start New Run
          </ActionButton>
          <ActionButton
            disabled={!home.canContinue}
            title={home.continueReason}
            onClick={() => gameApi?.actions?.continueRun?.()}
          >
            Continue
          </ActionButton>
          <ActionButton
            disabled={!home.canRestart}
            title={home.restartReason}
            onClick={() => gameApi?.actions?.restartRun?.()}
          >
            Restart Current Run
          </ActionButton>
          <ActionButton
            disabled={!home.canAbandon}
            title={home.abandonReason}
            onClick={() => gameApi?.actions?.abandonRun?.()}
          >
            Abandon Run
          </ActionButton>
          <ActionButton onClick={() => gameApi?.actions?.restartCampaign?.()}>
            Restart Campaign
          </ActionButton>
        </div>

        <div className="home-actions" style={{ marginTop: 10 }}>
          <ActionButton
            disabled={!home.canSave}
            title={home.saveReason}
            onClick={() => gameApi?.actions?.saveGame?.()}
          >
            Save Game
          </ActionButton>
          <ActionButton
            disabled={!home.canLoadSave}
            title={home.loadSaveReason}
            onClick={() => gameApi?.actions?.loadSavedGame?.()}
          >
            Load Save
          </ActionButton>
          <ActionButton
            disabled={!home.canClearSave}
            title={home.clearSaveReason}
            onClick={() => gameApi?.actions?.clearSavedGame?.()}
          >
            Delete Save
          </ActionButton>
        </div>

        {home.saveInfo ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
            {String(home.saveInfo || '')}
          </div>
        ) : null}
      </Panel>

      <Panel active={activeTab === 'guide'}>
        <h2>Guide</h2>
        <GuidePanel />
      </Panel>

      <Panel active={activeTab === 'settings'}>
        <h2>Settings</h2>
        <SettingsPanel />
      </Panel>

      <Panel active={activeTab === 'tools'}>
        <h2>Tools</h2>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.5 }}>
          Test helpers and quick actions. These are safe for normal play, but can change the run state.
        </div>

        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13 }}>Run Snapshot</div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, opacity: 0.92 }}>
            <div>Level: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.levelId ?? snapshot?.levelIndex ?? '-'}</span> • Seed: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.seed ?? '-'}</span></div>
            <div>Player Grid: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.playerGrid ? `${snapshot.playerGrid.x},${snapshot.playerGrid.y}` : '-'}</span> • Room: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.roomType ?? '-'}</span></div>
            <div>Spawn: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.spawnGrid ? `${snapshot.spawnGrid.x},${snapshot.spawnGrid.y}` : '-'}</span> • Exit: <span style={{ color: '#ffd700', fontWeight: 900 }}>{snapshot?.exitGrid ? `${snapshot.exitGrid.x},${snapshot.exitGrid.y}` : '-'}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.copySettingsJson?.()}>Copy Settings JSON</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.copySnapshotJson?.()}>Copy Snapshot JSON</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.copyCrashReport?.()}>Copy Crash Report</ActionButton>
          </div>
          <SubtleNote>Use these when reporting bugs; they’re designed to be pasted into an issue/DM.</SubtleNote>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 120, color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>Maze Seed</div>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="(random)"
            style={{ flex: '1 1 240px', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
          <button
            type="button"
            onClick={() => {
              gameApi?.actions?.setSeed?.(seed ? String(seed) : null);
              gameApi?.actions?.regenerateMap?.();
            }}
            className="btn btn--accent"
          >
            Apply + New Map
          </button>
          <button
            type="button"
            onClick={() => gameApi?.actions?.regenerateMap?.()}
            className="btn btn--secondary"
          >
            New Map
          </button>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Quick Actions</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.respawnEnemies?.()}>Respawn Enemies</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.rebuildObstacles?.()}>Rebuild Obstacles</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.reloadLevels?.()}>Reload Level JSON</ActionButton>
            <ActionButton size="sm" variant="accent" onClick={() => gameApi?.actions?.runAssetSanityCheck?.()}>Asset Sanity Check (Copy)</ActionButton>
            <ActionButton size="sm" variant="danger" onClick={() => gameApi?.actions?.setDebugUiEnabled?.(true)}>Enable Debug Mode (Reload)</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.setDebugUiEnabled?.(false)}>Disable Debug Mode (Reload)</ActionButton>
          </div>
          <SubtleNote>“Reload Level JSON” re-fetches `public/levels/manifest.json`. Use it while iterating on authored levels.</SubtleNote>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Dev Pages</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.openDebugHub?.()}>Open Debug Hub</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.openEnemyLab?.()}>Open Enemy Lab</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.openAiTest?.()}>Open AI Test</ActionButton>
            <ActionButton size="sm" onClick={() => gameApi?.actions?.openDiagnostics?.()}>Open Diagnostics</ActionButton>
          </div>
          <SubtleNote>These open separate pages in a new tab (useful for manual checks and balancing).</SubtleNote>
        </div>
      </Panel>

      <Panel active={activeTab === 'debug'}>
        <h2>Debug</h2>
        {!debugUi ? (
          <div style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 1.5 }}>
            Debug Mode is currently off. Turn it on to enable AI overlays/cheats and extra panels.
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => gameApi?.actions?.setDebugUiEnabled?.(true)}
                style={{ padding: '10px 12px', fontWeight: 900, borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffd700', color: '#1a1a1a' }}
              >
                Enable Debug Mode (Reload)
              </button>
            </div>
          </div>
        ) : null}
        <DebugPanel snapshot={snapshot} />
      </Panel>
    </div>
  );

  if (!target) return null;
  return createPortal(content, target);
}
