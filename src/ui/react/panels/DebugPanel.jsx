import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';
import { LevelNavigator } from './LevelNavigator.jsx';

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '8px 0' }}>
      <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {children}
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

export function DebugPanel({ snapshot }) {
  const gameApi = useGameApi();
  const prefs = snapshot?.debugPrefs || {};
  const diag = snapshot?.diagnostics || {};
  const ai = Array.isArray(snapshot?.aiDebug) ? snapshot.aiDebug : [];
  const noise = Array.isArray(diag?.recentNoise) ? diag.recentNoise : [];
  const [settings, setSettings] = React.useState(() => gameApi?.getSettings?.() || {});
  const [tpX, setTpX] = React.useState('');
  const [tpY, setTpY] = React.useState('');
  const [godMode, setGodMode] = React.useState(false);
  const [enemyModels, setEnemyModels] = React.useState([]);
  const [weaponModels, setWeaponModels] = React.useState([]);
  const [monsterModelPath, setMonsterModelPath] = React.useState('');
  const [weaponModelPath, setWeaponModelPath] = React.useState('');
  const [applyingModel, setApplyingModel] = React.useState(null);

  React.useEffect(() => {
    setSettings(gameApi?.getSettings?.() || {});
  }, [gameApi]);

  React.useEffect(() => {
    let alive = true;
    const loadList = async (url, prefix) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json?.models) ? json.models : [];
        const models = list.filter((p) => typeof p === 'string' && (!prefix || p.startsWith(prefix)));
        return models;
      } catch {
        return [];
      }
    };
    (async () => {
      const enemies = await loadList('/models/enemy/manifest.json', '/models/enemy/');
      const weapons = await loadList('/models/weapon/manifest.json', '/models/weapon/');
      if (!alive) return;
      setEnemyModels(enemies);
      setWeaponModels(weapons);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const update = (patch) => gameApi?.actions?.updateDebugPrefs?.(patch);
  const updateDev = (partial) => {
    const next = gameApi?.actions?.updateDevSettings?.(partial);
    if (next) setSettings(next);
  };
  const s = settings || {};

  React.useEffect(() => {
    const fromSettings = String(s.monsterModelPath || '');
    if (fromSettings) setMonsterModelPath(fromSettings);
  }, [s.monsterModelPath]);
  React.useEffect(() => {
    const fromSettings = String(s.weaponModelPath || '');
    if (fromSettings) setWeaponModelPath(fromSettings);
  }, [s.weaponModelPath]);
  React.useEffect(() => {
    if (!enemyModels.length) return;
    if (monsterModelPath) return;
    const preferred = String(s.monsterModelPath || '/models/enemy/CityLicker/CityLicker.dae');
    setMonsterModelPath(enemyModels.includes(preferred) ? preferred : enemyModels[0]);
  }, [enemyModels, monsterModelPath, s.monsterModelPath]);
  React.useEffect(() => {
    if (!weaponModels.length) return;
    if (weaponModelPath) return;
    const preferred = String(s.weaponModelPath || '/models/weapon/assault_rifle_pbr.glb');
    setWeaponModelPath(weaponModels.includes(preferred) ? preferred : weaponModels[0]);
  }, [weaponModels, weaponModelPath, s.weaponModelPath]);

  return (
    <div style={{ color: 'rgba(255,255,255,0.92)' }}>
      <Section title="Navigation">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => gameApi?.actions?.setHomeTab?.('settings')} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Open Settings
          </button>
          <button type="button" onClick={() => gameApi?.actions?.setHomeTab?.('tools')} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Open Tools
          </button>
          <button type="button" onClick={() => gameApi?.actions?.openDiagnostics?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Diagnostics
          </button>
          <button type="button" onClick={() => gameApi?.actions?.openAiTest?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            AI Test
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
          Enable Debug Mode from the Home → Debug tab to unlock cheats; visualization prefs persist in <code>maze:ai:debug:prefs</code>.
        </div>
      </Section>

      <Section title="Perf">
        <div style={{ fontSize: 12, opacity: 0.92, display: 'grid', gap: 6, marginTop: 8 }}>
          <div>fpsEma: <span style={{ color: '#ffd700', fontWeight: 900 }}>{Number.isFinite(snapshot?.fpsEma) ? snapshot.fpsEma.toFixed(1) : '—'}</span></div>
          <div>dt: <span style={{ color: '#ffd700', fontWeight: 900 }}>{Number.isFinite(snapshot?.dt) ? `${(snapshot.dt * 1000).toFixed(1)}ms` : '—'}</span></div>
          {snapshot?.rendererInfo ? (
            <div style={{ opacity: 0.92 }}>
              render.calls={snapshot.rendererInfo.calls ?? '—'} • tris={snapshot.rendererInfo.triangles ?? '—'} • tex={snapshot.rendererInfo.textures ?? '—'} • geo={snapshot.rendererInfo.geometries ?? '—'}
            </div>
          ) : null}
          {snapshot?.rendererInfo ? (
            <div style={{ opacity: 0.85 }}>
              frame={Number.isFinite(snapshot.rendererInfo.frameMs) ? `${snapshot.rendererInfo.frameMs.toFixed(1)}ms` : '—'} • update={Number.isFinite(snapshot.rendererInfo.updateMs) ? `${snapshot.rendererInfo.updateMs.toFixed(1)}ms` : '—'} • render={Number.isFinite(snapshot.rendererInfo.renderMs) ? `${snapshot.rendererInfo.renderMs.toFixed(1)}ms` : '—'} • pixelRatio={snapshot.rendererInfo.pixelRatio ?? '—'}
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Level">
        <LevelNavigator snapshot={snapshot} />
      </Section>

      <Section title="Cheats">
        <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
          Debug-only helpers (teleport/health/time). Use with care.
        </div>

        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: '#ffd700' }}>Teleport</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={() => gameApi?.actions?.debugTeleportSpawn?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Spawn
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTeleportExit?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Exit
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTeleportRandom?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Random
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTeleportMonster?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Monster
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <input
            value={tpX}
            onChange={(e) => setTpX(e.target.value)}
            placeholder="X"
            style={{ width: 110, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
          <input
            value={tpY}
            onChange={(e) => setTpY(e.target.value)}
            placeholder="Y"
            style={{ width: 110, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
          <button
            type="button"
            onClick={() => gameApi?.actions?.debugTeleportGrid?.(tpX, tpY)}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#2196f3', color: '#fff', fontWeight: 900 }}
          >
            Teleport (X,Y)
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: '#ffd700' }}>Health</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={() => gameApi?.actions?.debugSetHealthPercent?.(100)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Full
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugSetHealthPercent?.(50)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            50%
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugSetHealthPercent?.(10)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            10%
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugAdjustHealth?.(20)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            +20
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugAdjustHealth?.(-20)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            -20
          </button>
        </div>
        <Field label="God Mode (invincible)">
          <input
            type="checkbox"
            checked={godMode === true}
            onChange={(e) => {
              const v = !!e.target.checked;
              setGodMode(v);
              gameApi?.actions?.debugSetGodMode?.(v);
            }}
          />
        </Field>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: '#ffd700' }}>Time</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={() => gameApi?.actions?.debugTimeReset?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Reset
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTimeToggle?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            Toggle Run
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTimePlus?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            +30s
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugTimeMinus?.()} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}>
            -30s
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: '#ffd700' }}>Outcome</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={() => gameApi?.actions?.debugForceWin?.()} style={{ padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#4caf50', color: '#fff', fontWeight: 900 }}>
            Force Win
          </button>
          <button type="button" onClick={() => gameApi?.actions?.debugForceLose?.()} style={{ padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#f44336', color: '#fff', fontWeight: 900 }}>
            Force Lose
          </button>
        </div>
      </Section>

      <Section title="AI Visualization">
        <Field label="AI Overlay">
          <input type="checkbox" checked={prefs.overlay === true} onChange={(e) => update({ overlay: !!e.target.checked })} />
        </Field>
        <Field label="AI Markers (Minimap)">
          <input type="checkbox" checked={prefs.markers === true} onChange={(e) => update({ markers: !!e.target.checked })} />
        </Field>
        <Field label="Nav Heatmap (Minimap)">
          <input type="checkbox" checked={prefs.navHeatmap === true} onChange={(e) => update({ navHeatmap: !!e.target.checked })} />
        </Field>
        <Field label="Obstacle Map (Minimap)">
          <input type="checkbox" checked={prefs.minimapShowObstacles === true} onChange={(e) => update({ minimapShowObstacles: !!e.target.checked })} />
        </Field>
        <Field label="Obstacle Overlay (World)">
          <input type="checkbox" checked={prefs.worldShowObstacleOverlay === true} onChange={(e) => update({ worldShowObstacleOverlay: !!e.target.checked })} />
        </Field>
        <Field label="Minimap Click Teleport (Debug)">
          <input type="checkbox" checked={prefs.minimapTeleportEnabled === true} onChange={(e) => update({ minimapTeleportEnabled: !!e.target.checked })} />
        </Field>
        <Field label="AI 3D Lines">
          <input type="checkbox" checked={prefs.lines3d === true} onChange={(e) => update({ lines3d: !!e.target.checked })} />
        </Field>
      </Section>

      <Section title="AI Filters">
        <Field label="Chase Only">
          <input type="checkbox" checked={prefs.chaseOnly === true} onChange={(e) => update({ chaseOnly: !!e.target.checked })} />
        </Field>
        <Field label="Leader Only">
          <input type="checkbox" checked={prefs.leaderOnly === true} onChange={(e) => update({ leaderOnly: !!e.target.checked })} />
        </Field>
        <Field label="Nearest N (0=all)">
          <input
            type="number"
            min={0}
            max={12}
            step={1}
            value={Number(prefs.nearestN) || 0}
            onChange={(e) => update({ nearestN: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
      </Section>

      <Section title="AI Hearing">
        <Field label="Global Mult">
          <input
            type="number"
            min={0}
            max={5}
            step={0.05}
            value={Number(prefs.hearingGlobalMult ?? 1.0)}
            onChange={(e) => update({ hearingGlobalMult: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Use Path Distance">
          <input type="checkbox" checked={prefs.hearingUsePathDistance !== false} onChange={(e) => update({ hearingUsePathDistance: !!e.target.checked })} />
        </Field>
        <Field label="Corridor Cost Mult">
          <input
            type="number"
            min={0.1}
            max={3}
            step={0.05}
            value={Number(prefs.hearingCorridorCostMult ?? 0.9)}
            onChange={(e) => update({ hearingCorridorCostMult: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Room Cost Mult">
          <input
            type="number"
            min={0.1}
            max={3}
            step={0.05}
            value={Number(prefs.hearingRoomCostMult ?? 1.15)}
            onChange={(e) => update({ hearingRoomCostMult: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Door Cost Mult">
          <input
            type="number"
            min={0.1}
            max={3}
            step={0.05}
            value={Number(prefs.hearingDoorCostMult ?? 0.95)}
            onChange={(e) => update({ hearingDoorCostMult: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Through Wall Enabled">
          <input type="checkbox" checked={prefs.hearingThroughWallEnabled !== false} onChange={(e) => update({ hearingThroughWallEnabled: !!e.target.checked })} />
        </Field>
        <Field label="Max Wall Tiles">
          <input
            type="number"
            min={0}
            max={8}
            step={1}
            value={Number(prefs.hearingMaxWallTiles ?? 2)}
            onChange={(e) => update({ hearingMaxWallTiles: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Wall Penalty">
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={Number(prefs.hearingWallPenalty ?? 6)}
            onChange={(e) => update({ hearingWallPenalty: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
        <Field label="Blocked Door Penalty">
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={Number(prefs.hearingBlockedDoorPenalty ?? 3)}
            onChange={(e) => update({ hearingBlockedDoorPenalty: Number(e.target.value) })}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          />
        </Field>
      </Section>

      <Section title="Legend">
        <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
          <div><span style={{ color: '#00dcff', fontWeight: 900 }}>Cyan</span> = target / path</div>
          <div><span style={{ color: '#ffeb3b', fontWeight: 900 }}>Yellow</span> = last seen</div>
          <div><span style={{ color: '#ff7043', fontWeight: 900 }}>Orange</span> = noise</div>
          <div><span style={{ color: '#9c27b0', fontWeight: 900 }}>Purple</span> = scent</div>
          <div style={{ marginTop: 8 }}><span style={{ color: '#32cd32', fontWeight: 900 }}>Green</span> = player • <span style={{ color: '#00ff00', fontWeight: 900 }}>★</span> = exit • <span style={{ color: '#ff1493', fontWeight: 900 }}>Pink</span> = monster</div>
          <div><span style={{ color: '#ff7043', fontWeight: 900 }}>◆</span> = pickups • <span style={{ color: '#ffffff', fontWeight: 900 }}>●</span> = devices</div>
        </div>
      </Section>

      <Section title="Dev Gameplay">
        <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
          These settings persist (maze:settings:v2) but are meant for debugging/tuning.
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9, fontWeight: 900, color: '#ffd700' }}>Autopilot</div>
        <Field label="Enabled">
          <input type="checkbox" checked={s.autopilotEnabled === true} onChange={(e) => updateDev({ autopilotEnabled: !!e.target.checked })} />
        </Field>
        <Field label="Delay (s)">
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={Number(s.autopilotDelay ?? 0)}
            onChange={(e) => updateDev({ autopilotDelay: Number(e.target.value) })}
          />
        </Field>
        <Field label="Combat Enabled">
          <input type="checkbox" checked={s.autopilotCombatEnabled !== false} onChange={(e) => updateDev({ autopilotCombatEnabled: !!e.target.checked })} />
        </Field>
        <Field label="Fire Range (tiles)">
          <input
            type="range"
            min={4}
            max={20}
            step={1}
            value={Number(s.autopilotFireRange ?? 12)}
            onChange={(e) => updateDev({ autopilotFireRange: Number(e.target.value) })}
          />
        </Field>
        <Field label="Fire FOV (deg)">
          <input
            type="range"
            min={30}
            max={180}
            step={10}
            value={Number(s.autopilotFireFov ?? 110)}
            onChange={(e) => updateDev({ autopilotFireFov: Number(e.target.value) })}
          />
        </Field>
        <Field label="Turn Speed">
          <input
            type="range"
            min={1}
            max={8}
            step={0.25}
            value={Number(s.autopilotTurnSpeed ?? 3.0)}
            onChange={(e) => updateDev({ autopilotTurnSpeed: Number(e.target.value) })}
          />
        </Field>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.9, fontWeight: 900, color: '#ffd700' }}>AI / Squads</div>
        <Field label="Difficulty">
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={Number(s.aiDifficulty ?? 1.0)}
            onChange={(e) => updateDev({ aiDifficulty: Number(e.target.value) })}
          />
        </Field>
        <Field label="Ranged Attacks">
          <input type="checkbox" checked={s.monsterRanged !== false} onChange={(e) => updateDev({ monsterRanged: !!e.target.checked })} />
        </Field>
        <Field label="Use Asset Models">
          <input type="checkbox" checked={s.monsterModels !== false} onChange={(e) => updateDev({ monsterModels: !!e.target.checked })} />
        </Field>
        <Field label="Max Ranged Shooters">
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={Number(s.squadMaxShooters ?? 2)}
            onChange={(e) => updateDev({ squadMaxShooters: Number(e.target.value) })}
          />
        </Field>
        <Field label="Fire Grant (s)">
          <input
            type="range"
            min={0.2}
            max={2.0}
            step={0.05}
            value={Number(s.squadFireGrant ?? 0.9)}
            onChange={(e) => updateDev({ squadFireGrant: Number(e.target.value) })}
          />
        </Field>
        <Field label="Flank Hold (s)">
          <input
            type="range"
            min={2}
            max={14}
            step={1}
            value={Number(s.squadFlankHold ?? 8)}
            onChange={(e) => updateDev({ squadFlankHold: Number(e.target.value) })}
          />
        </Field>
        <Field label="Memory (s)">
          <input
            type="range"
            min={2}
            max={15}
            step={0.5}
            value={Number(s.squadMemory ?? 6.5)}
            onChange={(e) => updateDev({ squadMemory: Number(e.target.value) })}
          />
        </Field>
        <Field label="Noise Share (s)">
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={Number(s.squadNoiseShare ?? 2.0)}
            onChange={(e) => updateDev({ squadNoiseShare: Number(e.target.value) })}
          />
        </Field>
        <Field label="Cover Radius">
          <input
            type="range"
            min={5}
            max={14}
            step={1}
            value={Number(s.squadCoverRadius ?? 9)}
            onChange={(e) => updateDev({ squadCoverRadius: Number(e.target.value) })}
          />
        </Field>

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => gameApi?.actions?.respawnEnemies?.()}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#2196f3', color: '#fff', fontWeight: 900 }}
          >
            Respawn Enemies (Apply Spawn/Model Changes)
          </button>
        </div>
      </Section>

      <Section title="Models">
        <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
          Applies immediately; some changes may need “Respawn Enemies”.
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9, fontWeight: 900, color: '#ffd700' }}>Monster Model</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <select
            value={monsterModelPath}
            onChange={(e) => setMonsterModelPath(String(e.target.value || ''))}
            style={{ flex: '1 1 320px', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          >
            {enemyModels.length ? enemyModels.map((p) => (
              <option key={p} value={p}>{p}</option>
            )) : <option value="">(manifest load failed)</option>}
          </select>
          <button
            type="button"
            disabled={!monsterModelPath || applyingModel === 'monster'}
            onClick={async () => {
              setApplyingModel('monster');
              try {
                await gameApi?.actions?.setMonsterModelPath?.(monsterModelPath);
              } finally {
                setApplyingModel(null);
              }
            }}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffd700', color: '#1a1a1a', fontWeight: 900, opacity: (!monsterModelPath || applyingModel === 'monster') ? 0.6 : 1 }}
          >
            {applyingModel === 'monster' ? 'Applying…' : 'Apply'}
          </button>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.9, fontWeight: 900, color: '#ffd700' }}>Weapon Model</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <select
            value={weaponModelPath}
            onChange={(e) => setWeaponModelPath(String(e.target.value || ''))}
            style={{ flex: '1 1 320px', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
          >
            {weaponModels.length ? weaponModels.map((p) => (
              <option key={p} value={p}>{p}</option>
            )) : <option value="">(manifest load failed)</option>}
          </select>
          <button
            type="button"
            disabled={!weaponModelPath || applyingModel === 'weapon'}
            onClick={async () => {
              setApplyingModel('weapon');
              try {
                await gameApi?.actions?.setWeaponModelPath?.(weaponModelPath);
              } finally {
                setApplyingModel(null);
              }
            }}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffd700', color: '#1a1a1a', fontWeight: 900, opacity: (!weaponModelPath || applyingModel === 'weapon') ? 0.6 : 1 }}
          >
            {applyingModel === 'weapon' ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </Section>

      <Section title="AI Snapshot">
        <div style={{ fontSize: 12, opacity: 0.9 }}>
          Showing: <span style={{ color: '#ffd700', fontWeight: 900 }}>{ai.length}</span>
        </div>
        {ai.length ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {ai.map((r) => {
              const grid = r?.grid ? `${r.grid.x},${r.grid.y}` : '—';
              const target = r?.currentTarget ? `${r.currentTarget.x},${r.currentTarget.y}` : '—';
              const lastKnown = r?.lastKnown ? `${r.lastKnown.x},${r.lastKnown.y}` : '—';
              const lastNoise = r?.lastNoise?.grid ? `${r.lastNoise.grid.x},${r.lastNoise.grid.y}` : '—';
              const st = String(r?.state ?? '—');
              const role = r?.squadRole ? String(r.squadRole) : '';
              const conf = Number.isFinite(r?.confidence) ? r.confidence.toFixed(2) : '';
              return (
                <div key={r.id} style={{ padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.10)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 900, color: '#ffd700' }}>#{r.id} {role ? `(${role})` : ''}</div>
                    <div style={{ fontSize: 11, opacity: 0.85 }}>{r?.type ? String(r.type) : ''} {conf ? `conf=${conf}` : ''}</div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.95, display: 'grid', gap: 4 }}>
                    <div>state: <span style={{ color: '#00dcff', fontWeight: 900 }}>{st}</span></div>
                    <div>grid: {grid} • target: {target} • pathLen: {r?.pathLen ?? '—'}</div>
                    <div>lastKnown: {lastKnown} • lastNoise: {lastNoise}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>(none)</div>
        )}
      </Section>

      <Section title="Recent Noise">
        <div style={{ fontSize: 12, opacity: 0.9 }}>
          Count: <span style={{ color: '#ffd700', fontWeight: 900 }}>{noise.length}</span>
        </div>
        {noise.length ? (
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {noise.slice().reverse().slice(0, 8).map((n, i) => {
              const t = n?.tMs ? new Date(n.tMs).toLocaleTimeString() : '';
              const pos = n?.grid ? `${n.grid.x},${n.grid.y}` : (n?.position ? `${n.position.x?.toFixed?.(1) ?? n.position.x},${n.position.z?.toFixed?.(1) ?? n.position.z}` : '—');
              return (
                <div key={`${n?.tMs ?? i}`} style={{ padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.10)', fontSize: 12, opacity: 0.95 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ color: '#ff7043', fontWeight: 900 }}>{String(n?.kind || 'noise')}</div>
                    <div style={{ opacity: 0.8 }}>{t}</div>
                  </div>
                  <div style={{ marginTop: 6, opacity: 0.9 }}>
                    pos={pos} radius={n?.radius ?? '—'} strength={n?.strength ?? '—'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>(none)</div>
        )}
      </Section>

      <Section title="Diagnostics">
        <div style={{ fontSize: 12, opacity: 0.9 }}>
          Errors: <span style={{ color: '#ffd700', fontWeight: 900 }}>{Number(diag.errorCount) || 0}</span>
        </div>
        {diag.lastError ? (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.10)', whiteSpace: 'pre-wrap', fontSize: 11 }}>
            [{String(diag.lastError.source)}] {String(diag.lastError.message || '')}
          </div>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => gameApi?.actions?.copyCrashReport?.()}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffd700', color: '#1a1a1a', fontWeight: 900 }}
          >
            Copy Crash Report
          </button>
        </div>
      </Section>
    </div>
  );
}
