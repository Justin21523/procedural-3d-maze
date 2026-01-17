import React from 'react';

function get(inv, id) {
  const n = Math.round(Number(inv?.[id] ?? 0));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function InventorySummary({ inventory }) {
  const inv = inventory || {};

  const keyParts = [];
  const keycard = get(inv, 'keycard');
  const fuse = get(inv, 'fuse');
  const evidence = get(inv, 'evidence');
  const powerOn = get(inv, 'power_on');
  if (keycard) keyParts.push(`Keycard:${keycard}`);
  if (fuse) keyParts.push(`Fuse:${fuse}`);
  if (evidence) keyParts.push(`Evidence:${evidence}`);
  if (powerOn) keyParts.push('Power:ON');

  const toolParts = [];
  const lure = get(inv, 'lure');
  const lureSticky = get(inv, 'lure_sticky');
  const trap = get(inv, 'trap');
  const jammer = get(inv, 'jammer');
  const sensor = get(inv, 'sensor');
  const mine = get(inv, 'mine');
  const wedge = get(inv, 'door_wedge');
  const spray = get(inv, 'scent_spray');
  const glow = get(inv, 'glowstick');
  const sonar = get(inv, 'sonar_pulse');
  const fake = get(inv, 'fake_hack');
  if (lure || lureSticky) toolParts.push(`Lure:${lure}${lureSticky ? `(+${lureSticky})` : ''}`);
  if (trap) toolParts.push(`Trap:${trap}`);
  if (jammer) toolParts.push(`Jammer:${jammer}`);
  if (sensor) toolParts.push(`Sensor:${sensor}`);
  if (mine) toolParts.push(`Mine:${mine}`);
  if (wedge) toolParts.push(`Wedge:${wedge}`);
  if (spray) toolParts.push(`Spray:${spray}`);
  if (glow) toolParts.push(`Glow:${glow}`);
  if (sonar) toolParts.push(`Sonar:${sonar}`);
  if (fake) toolParts.push(`Fake:${fake}`);

  const throwParts = [];
  const decoy = get(inv, 'decoy');
  const decoyDelay = get(inv, 'decoy_delay');
  const smoke = get(inv, 'smoke') + get(inv, 'smoke_weak') + get(inv, 'smoke_strong');
  const flash = get(inv, 'flash');
  if (decoy || decoyDelay) throwParts.push(`Decoy:${decoy}${decoyDelay ? `(+${decoyDelay})` : ''}`);
  if (smoke) throwParts.push(`Smoke:${smoke}`);
  if (flash) throwParts.push(`Flash:${flash}`);

  const muted = { opacity: 0.75, fontSize: 12 };
  const value = { color: '#ffd700', fontWeight: 800 };

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <div style={muted}>Key Items: <span style={value}>{keyParts.length ? keyParts.join(' | ') : '—'}</span></div>
      <div style={muted}>Tools: <span style={value}>{toolParts.length ? toolParts.join(' | ') : '—'}</span></div>
      <div style={muted}>Throw: <span style={value}>{throwParts.length ? throwParts.join(' | ') : '—'}</span></div>
    </div>
  );
}

