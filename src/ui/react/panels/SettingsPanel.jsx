import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function Field({ label, hint, value, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '8px 0' }}>
      <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>
        <div>{label}</div>
        {hint ? <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{hint}</div> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
        {children}
        {value !== undefined ? (
          <div style={{ minWidth: 52, textAlign: 'right', color: '#ffd700', fontWeight: 800, fontSize: 12 }}>
            {value}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

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

export function SettingsPanel() {
  const gameApi = useGameApi();
  const [settings, setSettings] = React.useState(() => gameApi?.getSettings?.() || {});
  const [snapshot, setSnapshot] = React.useState(() => gameApi?.getSnapshot?.() || {});
  const [debugUi, setDebugUi] = React.useState(() => document.body.classList.contains('show-debug'));
  const [tab, setTab] = React.useState('gameplay');
  const [monsterModelPath, setMonsterModelPath] = React.useState(() => String(gameApi?.getSettings?.()?.monsterModelPath ?? ''));
  const [weaponModelPath, setWeaponModelPath] = React.useState(() => String(gameApi?.getSettings?.()?.weaponModelPath ?? ''));

  React.useEffect(() => {
    setSettings(gameApi?.getSettings?.() || {});
    setSnapshot(gameApi?.getSnapshot?.() || {});
    setMonsterModelPath(String(gameApi?.getSettings?.()?.monsterModelPath ?? ''));
    setWeaponModelPath(String(gameApi?.getSettings?.()?.weaponModelPath ?? ''));
  }, [gameApi]);

  React.useEffect(() => {
    const obs = new MutationObserver(() => {
      setDebugUi(document.body.classList.contains('show-debug'));
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const off = gameApi.subscribe('ui:snapshot', (s) => setSnapshot(s || {}));
    return () => off?.();
  }, [gameApi]);

  const update = React.useCallback((partial) => {
    if (!gameApi?.actions?.updateSettings) return;
    const next = gameApi.actions.updateSettings(partial);
    if (next) setSettings(next);
  }, [gameApi]);

  const s = settings || {};
  const minimapState = snapshot?.minimap || {};
  const boolEffective = (key, fallback) => (typeof s[key] === 'boolean' ? s[key] : fallback);
  const numEffective = (key, fallback) => {
    const raw = s[key];
    if (raw === null || raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const sourceOf = (key) => (s[key] === null || s[key] === undefined ? 'Default' : 'Saved');
  const needsNewMap = (key) => (
    key === 'mazeSize' ||
    key === 'roomDensity' ||
    key === 'missionCount' ||
    key === 'mazeSeed' ||
    key === 'propObstacleChance' ||
    key === 'propObstacleMargin' ||
    key === 'monsterCountMult'
  );
  const hintFor = (key, applies = 'Immediate') => {
    const src = sourceOf(key);
    const restart = needsNewMap(key) ? 'Needs new map' : applies;
    return `${src} • ${restart}`;
  };

  return (
    <div style={{ width: '100%', color: 'rgba(255,255,255,0.92)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 16 }}>⚙️ Settings</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <TabButton active={tab === 'gameplay'} onClick={() => setTab('gameplay')}>Gameplay</TabButton>
        <TabButton active={tab === 'graphics'} onClick={() => setTab('graphics')}>Graphics</TabButton>
        <TabButton active={tab === 'ui'} onClick={() => setTab('ui')}>UI</TabButton>
        <TabButton active={tab === 'autopilot'} onClick={() => setTab('autopilot')}>Autopilot</TabButton>
        <TabButton active={tab === 'ai'} onClick={() => setTab('ai')}>AI</TabButton>
        <TabButton active={tab === 'squad'} onClick={() => setTab('squad')}>Squad</TabButton>
        <TabButton active={tab === 'obstacles'} onClick={() => setTab('obstacles')}>Obstacles</TabButton>
      </div>

      {tab === 'gameplay' ? (
        <>
          <Section title="Player">
            <Field label="Move Speed" hint={hintFor('playerSpeed')} value={numEffective('playerSpeed', 4).toFixed(1)}>
              <input type="range" min={1} max={10} step={0.5} value={numEffective('playerSpeed', 4)} onChange={(e) => update({ playerSpeed: Number(e.target.value) })} />
            </Field>
            <Field label="Mouse Sens" hint={hintFor('mouseSensitivity')} value={numEffective('mouseSensitivity', 0.002).toFixed(4)}>
              <input type="range" min={0.0005} max={0.005} step={0.0005} value={numEffective('mouseSensitivity', 0.002)} onChange={(e) => update({ mouseSensitivity: Number(e.target.value) })} />
            </Field>
            <Field label="FOV" hint={hintFor('fov')} value={String(Math.round(numEffective('fov', 75)))}>
              <input type="range" min={60} max={90} step={5} value={Math.round(numEffective('fov', 75))} onChange={(e) => update({ fov: Number(e.target.value) })} />
            </Field>
            <Field label="Fog Density" hint={hintFor('fogDensity')} value={numEffective('fogDensity', 0.08).toFixed(2)}>
              <input type="range" min={0} max={0.15} step={0.01} value={numEffective('fogDensity', 0.08)} onChange={(e) => update({ fogDensity: Number(e.target.value) })} />
            </Field>
          </Section>

          <Section title="World">
            <Field label="Maze Size" hint={hintFor('mazeSize')} value={String(Math.round(numEffective('mazeSize', 31)))}>
              <input type="range" min={21} max={61} step={2} value={Math.round(numEffective('mazeSize', 31))} onChange={(e) => update({ mazeSize: Number(e.target.value) })} />
            </Field>
            <Field label="Room Density" hint={hintFor('roomDensity')} value={numEffective('roomDensity', 3.0).toFixed(1)}>
              <input type="range" min={0.5} max={4.0} step={0.1} value={numEffective('roomDensity', 3.0)} onChange={(e) => update({ roomDensity: Number(e.target.value) })} />
            </Field>
            <Field label="Missions" hint={hintFor('missionCount')} value={String(clamp(Math.round(numEffective('missionCount', 5)), 1, 10))}>
              <input type="range" min={1} max={10} step={1} value={clamp(Math.round(numEffective('missionCount', 5)), 1, 10)} onChange={(e) => update({ missionCount: Number(e.target.value) })} />
            </Field>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" onClick={() => gameApi?.actions?.regenerateMap?.()} style={{ padding: '10px 12px', fontWeight: 900, borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffd700', color: '#1a1a1a' }}>
                🔄 New Map
              </button>
            </div>
          </Section>

          <Section title="Minimap">
            <Field label="Visible" hint={minimapState?.forcedHidden ? 'Forced by mode' : 'Immediate'} value={minimapState?.forcedHidden ? 'Forced Off' : (minimapState?.hidden ? 'No' : 'Yes')}>
              <input type="checkbox" disabled={minimapState?.forcedHidden === true} checked={minimapState?.hidden !== true} onChange={(e) => gameApi?.actions?.setMinimapHidden?.(!e.target.checked)} />
            </Field>
            <Field label="Size" hint="Immediate • Saved (local)" value={minimapState?.size ? `${minimapState.size}px` : undefined}>
              <input type="range" min={140} max={320} step={10} value={Number(minimapState?.size) || 240} onChange={(e) => gameApi?.actions?.setMinimapSize?.(Number(e.target.value))} />
            </Field>
            <Field label="Zoom" hint="Immediate • Saved (local)" value={Number.isFinite(Number(minimapState?.zoom)) ? `${Number(minimapState.zoom).toFixed(1)}x` : undefined}>
              <input type="range" min={1} max={3} step={0.1} value={Number(minimapState?.zoom) || 1.1} onChange={(e) => gameApi?.actions?.setMinimapZoom?.(Number(e.target.value))} />
            </Field>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" onClick={() => gameApi?.actions?.resetMinimap?.()} style={{ padding: '8px 10px', fontWeight: 800, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)' }}>
                Reset Minimap
              </button>
            </div>
          </Section>

          <Section title="Content">
            <Field label="Asset Models" hint={hintFor('monsterModels', 'Next map')} value={s.monsterModels === false ? 'Off' : 'On'}>
              <input type="checkbox" checked={s.monsterModels !== false} onChange={(e) => update({ monsterModels: !!e.target.checked })} />
            </Field>

            {debugUi ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ fontWeight: 900, color: '#ffd700', fontSize: 12, marginBottom: 8 }}>Model Overrides (Debug)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>Monster Model</div>
                  <input value={monsterModelPath} onChange={(e) => setMonsterModelPath(e.target.value)} placeholder="e.g. /models/enemy/..." style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }} />
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>Weapon Model</div>
                  <input value={weaponModelPath} onChange={(e) => setWeaponModelPath(e.target.value)} placeholder="e.g. /models/weapon/..." style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }} />
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <button type="button" onClick={() => gameApi?.actions?.setMonsterModelPath?.(monsterModelPath ? String(monsterModelPath) : null)} style={{ padding: '8px 10px', fontWeight: 800, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)' }}>
                    Apply Monster Model
                  </button>
                  <button type="button" onClick={() => gameApi?.actions?.setWeaponModelPath?.(weaponModelPath ? String(weaponModelPath) : null)} style={{ padding: '8px 10px', fontWeight: 800, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)' }}>
                    Apply Weapon Model
                  </button>
                </div>
              </div>
            ) : null}
          </Section>
        </>
      ) : null}

      {tab === 'graphics' ? (
        <Section title="Graphics">
          <Field label="Low GPU Mode" hint={hintFor('lowPerf', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('lowPerf', false) === true} onChange={(e) => update({ lowPerf: !!e.target.checked })} />
          </Field>
          <Field label="HDRI Env" hint={hintFor('hdri', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('hdri', true) !== false} onChange={(e) => update({ hdri: !!e.target.checked })} />
          </Field>
          <Field label="Pool FX" hint={hintFor('poolFx', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('poolFx', true) !== false} onChange={(e) => update({ poolFx: !!e.target.checked })} />
          </Field>
          <Field label="Safe Mode" hint={hintFor('safeMode', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('safeMode', false) === true} onChange={(e) => update({ safeMode: !!e.target.checked })} />
          </Field>
        </Section>
      ) : null}

      {tab === 'ui' ? (
        <Section title="UI">
          <Field label="Show Weapon" hint={hintFor('weaponView', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('weaponView', true) !== false} onChange={(e) => update({ weaponView: !!e.target.checked })} />
          </Field>
          <Field label="Crosshair" hint={hintFor('crosshair', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('crosshair', true) !== false} onChange={(e) => update({ crosshair: !!e.target.checked })} />
          </Field>
          <Field label="Recoil" hint={hintFor('recoil', 'Immediate')} value={numEffective('recoil', 1.0).toFixed(1)}>
            <input type="range" min={0} max={2} step={0.1} value={numEffective('recoil', 1.0)} onChange={(e) => update({ recoil: Number(e.target.value) })} />
          </Field>
        </Section>
      ) : null}

      {tab === 'autopilot' ? (
        <Section title="Autopilot">
          <Field label="Enabled" hint={hintFor('autopilotEnabled', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('autopilotEnabled', true) === true} onChange={(e) => update({ autopilotEnabled: !!e.target.checked })} />
          </Field>
          <Field label="Delay (sec)" hint={hintFor('autopilotDelay', 'Immediate')} value={numEffective('autopilotDelay', 0).toFixed(1)}>
            <input type="range" min={0} max={5} step={0.1} value={numEffective('autopilotDelay', 0)} onChange={(e) => update({ autopilotDelay: Number(e.target.value) })} />
          </Field>
          <Field label="Tool AI (devices/items)" hint={hintFor('autopilotToolAiEnabled', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('autopilotToolAiEnabled', true) === true} onChange={(e) => update({ autopilotToolAiEnabled: !!e.target.checked })} />
          </Field>
          <Field label="Replan Interval (sec)" hint={hintFor('autopilotReplanInterval', 'Immediate')} value={numEffective('autopilotReplanInterval', 0.5).toFixed(2)}>
            <input type="range" min={0.1} max={1.5} step={0.05} value={numEffective('autopilotReplanInterval', 0.5)} onChange={(e) => update({ autopilotReplanInterval: Number(e.target.value) })} />
          </Field>
          <Field label="Combat Enabled" hint={hintFor('autopilotCombatEnabled', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('autopilotCombatEnabled', true) === true} onChange={(e) => update({ autopilotCombatEnabled: !!e.target.checked })} />
          </Field>
          <Field label="Combat Require LOS" hint={hintFor('autopilotCombatRequireLos', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('autopilotCombatRequireLos', true) === true} onChange={(e) => update({ autopilotCombatRequireLos: !!e.target.checked })} />
          </Field>
          <Field label="Combat Max Range (tiles)" hint={hintFor('autopilotCombatMaxRange', 'Immediate')} value={String(Math.round(numEffective('autopilotCombatMaxRange', 16)))}>
            <input type="range" min={6} max={30} step={1} value={Math.round(numEffective('autopilotCombatMaxRange', 16))} onChange={(e) => update({ autopilotCombatMaxRange: Number(e.target.value) })} />
          </Field>
          <Field label="Fire Range (tiles)" hint={hintFor('autopilotFireRange', 'Immediate')} value={String(Math.round(numEffective('autopilotFireRange', 12)))}>
            <input type="range" min={4} max={20} step={1} value={Math.round(numEffective('autopilotFireRange', 12))} onChange={(e) => update({ autopilotFireRange: Number(e.target.value) })} />
          </Field>
          <Field label="Fire FOV (deg)" hint={hintFor('autopilotFireFov', 'Immediate')} value={String(Math.round(numEffective('autopilotFireFov', 110)))}>
            <input type="range" min={30} max={180} step={10} value={Math.round(numEffective('autopilotFireFov', 110))} onChange={(e) => update({ autopilotFireFov: Number(e.target.value) })} />
          </Field>
          <Field label="Damage Mult (autopilot)" hint={hintFor('autopilotCombatDamageMult', 'Immediate')} value={numEffective('autopilotCombatDamageMult', 2.0).toFixed(2)}>
            <input type="range" min={0.5} max={3.5} step={0.05} value={numEffective('autopilotCombatDamageMult', 2.0)} onChange={(e) => update({ autopilotCombatDamageMult: Number(e.target.value) })} />
          </Field>
          <Field label="Turn Speed" hint={hintFor('autopilotTurnSpeed', 'Immediate')} value={numEffective('autopilotTurnSpeed', 3.0).toFixed(1)}>
            <input type="range" min={1} max={8} step={0.5} value={numEffective('autopilotTurnSpeed', 3.0)} onChange={(e) => update({ autopilotTurnSpeed: Number(e.target.value) })} />
          </Field>
        </Section>
      ) : null}

      {tab === 'ai' ? (
        <Section title="AI">
          <Field label="Difficulty" hint={hintFor('aiDifficulty', 'Immediate')} value={numEffective('aiDifficulty', 0.75).toFixed(2)}>
            <input type="range" min={0.5} max={2.0} step={0.05} value={numEffective('aiDifficulty', 0.75)} onChange={(e) => update({ aiDifficulty: Number(e.target.value) })} />
          </Field>
          <Field label="Enable Ranged Monsters" hint={hintFor('monsterRanged', 'Immediate')}>
            <input type="checkbox" checked={boolEffective('monsterRanged', true) !== false} onChange={(e) => update({ monsterRanged: !!e.target.checked })} />
          </Field>
          <Field label="Monster Count Mult" hint={hintFor('monsterCountMult', 'Immediate')} value={numEffective('monsterCountMult', 0.7).toFixed(2)}>
            <input type="range" min={0} max={2.0} step={0.05} value={numEffective('monsterCountMult', 0.7)} onChange={(e) => update({ monsterCountMult: Number(e.target.value) })} />
          </Field>
        </Section>
      ) : null}

      {tab === 'squad' ? (
        <Section title="Squad">
          <Field label="Max Shooters" hint={hintFor('squadMaxShooters', 'Immediate')} value={String(Math.round(numEffective('squadMaxShooters', 1)))}>
            <input type="range" min={1} max={4} step={1} value={Math.round(numEffective('squadMaxShooters', 1))} onChange={(e) => update({ squadMaxShooters: Number(e.target.value) })} />
          </Field>
          <Field label="Fire Grant (sec)" hint={hintFor('squadFireGrant', 'Immediate')} value={numEffective('squadFireGrant', 0.9).toFixed(2)}>
            <input type="range" min={0.2} max={2.0} step={0.05} value={numEffective('squadFireGrant', 0.9)} onChange={(e) => update({ squadFireGrant: Number(e.target.value) })} />
          </Field>
          <Field label="Flank Hold (sec)" hint={hintFor('squadFlankHold', 'Immediate')} value={String(Math.round(numEffective('squadFlankHold', 8.0)))}>
            <input type="range" min={2} max={14} step={1} value={Math.round(numEffective('squadFlankHold', 8.0))} onChange={(e) => update({ squadFlankHold: Number(e.target.value) })} />
          </Field>
          <Field label="Memory (sec)" hint={hintFor('squadMemory', 'Immediate')} value={String(Math.round(numEffective('squadMemory', 6.5)))}>
            <input type="range" min={2} max={15} step={1} value={Math.round(numEffective('squadMemory', 6.5))} onChange={(e) => update({ squadMemory: Number(e.target.value) })} />
          </Field>
          <Field label="Noise Share (sec)" hint={hintFor('squadNoiseShare', 'Immediate')} value={numEffective('squadNoiseShare', 2.0).toFixed(1)}>
            <input type="range" min={0} max={5} step={0.2} value={numEffective('squadNoiseShare', 2.0)} onChange={(e) => update({ squadNoiseShare: Number(e.target.value) })} />
          </Field>
          <Field label="Cover Radius (tiles)" hint={hintFor('squadCoverRadius', 'Immediate')} value={String(Math.round(numEffective('squadCoverRadius', 9)))}>
            <input type="range" min={5} max={14} step={1} value={Math.round(numEffective('squadCoverRadius', 9))} onChange={(e) => update({ squadCoverRadius: Number(e.target.value) })} />
          </Field>
        </Section>
      ) : null}

      {tab === 'obstacles' ? (
        <Section title="Obstacles">
          <Field label="Minimap Obstacles" hint={hintFor('minimapShowObstacles', 'Immediate')}>
            <input type="checkbox" checked={s.minimapShowObstacles === true} onChange={(e) => update({ minimapShowObstacles: !!e.target.checked })} />
          </Field>
          <Field label="3D Obstacle Overlay" hint={hintFor('worldShowObstacleOverlay', 'Immediate')}>
            <input type="checkbox" checked={s.worldShowObstacleOverlay === true} onChange={(e) => update({ worldShowObstacleOverlay: !!e.target.checked })} />
          </Field>
          <Field label="Prop Obstacle Chance" hint={hintFor('propObstacleChance')} value={numEffective('propObstacleChance', 0.12).toFixed(2)}>
            <input type="range" min={0} max={0.35} step={0.01} value={numEffective('propObstacleChance', 0.12)} onChange={(e) => update({ propObstacleChance: Number(e.target.value) })} />
          </Field>
          <Field label="Prop Obstacle Margin (tiles)" hint={hintFor('propObstacleMargin')} value={String(Math.round(numEffective('propObstacleMargin', 1)))}>
            <input type="range" min={0} max={2} step={1} value={Math.round(numEffective('propObstacleMargin', 1))} onChange={(e) => update({ propObstacleMargin: Number(e.target.value) })} />
          </Field>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              type="button"
              onClick={() => gameApi?.actions?.rebuildObstacles?.()}
              style={{ padding: '10px 12px', fontWeight: 900, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.92)' }}
            >
              🧱 Rebuild Obstacles
            </button>
          </div>
        </Section>
      ) : null}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <button
          type="button"
          onClick={() => {
            gameApi?.actions?.resetSettings?.();
            setSettings(gameApi?.getSettings?.() || {});
          }}
          style={{ padding: '8px 10px', fontWeight: 800, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)' }}
        >
          Reset Settings
        </button>
      </div>
    </div>
  );
}
