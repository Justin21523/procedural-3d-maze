import React from 'react';
import { InventorySummary } from './InventorySummary.jsx';
import { NoiseMeterOverlay } from '../overlays/NoiseMeterOverlay.jsx';

function formatMs(ms) {
  const t = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.floor(t / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function Hud({ snapshot }) {
  const hp = Number.isFinite(snapshot?.health) ? snapshot.health : null;
  const maxHp = Number.isFinite(snapshot?.maxHealth) ? snapshot.maxHealth : null;
  const ammo = snapshot?.weaponHud
    ? `${snapshot.weaponHud.ammoInMag ?? '-'}${Number.isFinite(snapshot.weaponHud.magSize) ? `/${snapshot.weaponHud.magSize}` : ''} (${snapshot.weaponHud.ammoReserve ?? '-'})`
    : (snapshot?.ammo ?? null);
  const levelId = snapshot?.levelId ?? null;
  const time = snapshot?.t ?? null;
  const campaignText = snapshot?.campaign?.hudText || '';
  const objective = snapshot?.hud?.missionObjective || '';
  const exitUnlocked = snapshot?.hud?.exitUnlocked;
  const exitReason = snapshot?.hud?.exitLockedReason || '';
  const missions = snapshot?.runStats?.missions || null;
  const inv = snapshot?.inventory || {};
  const debugUi = snapshot?.debugUiEnabled === true;
  const grid = snapshot?.playerGrid || null;
  const roomType = snapshot?.roomType ?? null;
  const pointerLocked = snapshot?.pointerLocked;
  const keysDown = Array.isArray(snapshot?.keysDown) ? snapshot.keysDown : [];

  return (
    <div style={{ position: 'fixed', top: 20, left: 20, zIndex: 100, pointerEvents: 'none', minWidth: 240, padding: 15, borderRadius: 8, background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.92)', fontSize: 13 }}>
      <div style={{ marginBottom: 10, color: '#ffd700', fontWeight: 900 }}>Status</div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div><span style={{ opacity: 0.7 }}>Level:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{String(levelId ?? '-')}</span></div>
        {campaignText ? <div><span style={{ opacity: 0.7 }}>Campaign:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{campaignText}</span></div> : null}
        <div><span style={{ opacity: 0.7 }}>Time:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{formatMs(time)}</span></div>
        {debugUi ? (
          <div style={{ opacity: 0.95 }}>
            <span style={{ opacity: 0.7 }}>Pos:</span>{' '}
            <span style={{ color: '#ffd700', fontWeight: 800 }}>{grid ? `${grid.x},${grid.y}` : '-'}</span>
            {roomType ? <span style={{ opacity: 0.85 }}>{` • ${String(roomType)}`}</span> : null}
          </div>
        ) : null}
        {debugUi ? (
          <div style={{ opacity: 0.95 }}>
            <span style={{ opacity: 0.7 }}>Pointer:</span>{' '}
            <span style={{ color: '#ffd700', fontWeight: 800 }}>{pointerLocked ? 'locked' : 'unlocked'}</span>
            {keysDown.length ? <span style={{ opacity: 0.85 }}>{` • keys: ${keysDown.join(' ')}`}</span> : null}
          </div>
        ) : null}
        <div><span style={{ opacity: 0.7 }}>Health:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{hp !== null ? `${hp}${maxHp !== null ? `/${maxHp}` : ''}` : '-'}</span></div>
        <div><span style={{ opacity: 0.7 }}>Ammo:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{ammo ?? '-'}</span></div>
        {missions ? (
          <div><span style={{ opacity: 0.7 }}>Objectives:</span> <span style={{ color: '#ffd700', fontWeight: 800 }}>{`${missions.collected ?? 0}/${missions.total ?? 0}`}</span></div>
        ) : null}
        {objective ? (
          <div style={{ marginTop: 6, lineHeight: 1.35 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Objective</div>
            <div style={{ fontWeight: 700 }}>{String(objective)}</div>
          </div>
        ) : null}
        {exitUnlocked === false ? (
          <div style={{ marginTop: 6, lineHeight: 1.35 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Exit</div>
            <div style={{ fontWeight: 800, color: '#ff7043' }}>{exitReason || 'Locked'}</div>
          </div>
        ) : null}
      </div>

      <InventorySummary inventory={inv} />
      <NoiseMeterOverlay />
    </div>
  );
}
