import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function CrosshairOverlay({ snapshot }) {
  const gameApi = useGameApi();
  const enabled = snapshot?.uiFlags?.crosshairEnabled !== false;
  const inGame = (() => {
    try {
      return document.body.classList.contains('mode-game');
    } catch {
      return true;
    }
  })();
  const [pulse, setPulse] = React.useState({ untilMs: 0, kind: 'normal' }); // normal | hit | kill
  const [now, setNow] = React.useState(() => performance.now());

  React.useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const offFired = gameApi.subscribe(EVENTS.WEAPON_FIRED, () => {
      setPulse({ untilMs: performance.now() + 80, kind: 'normal' });
    });
    const offHit = gameApi.subscribe(EVENTS.PLAYER_HIT_MONSTER, () => {
      setPulse({ untilMs: performance.now() + 120, kind: 'hit' });
    });
    const offKill = gameApi.subscribe(EVENTS.MONSTER_KILLED, (payload) => {
      if (payload?.cause !== 'player') return;
      setPulse({ untilMs: performance.now() + 140, kind: 'kill' });
    });
    return () => {
      offFired?.();
      offHit?.();
      offKill?.();
    };
  }, [gameApi]);

  if (!enabled || !inGame) return null;

  const remaining = pulse.untilMs - now;
  if (remaining <= 0) {
    // Still render the base crosshair lightly.
  }

  const t = remaining > 0 ? clamp(remaining / 160, 0, 1) : 0;
  const scale =
    pulse.kind === 'kill' ? (1 + 0.45 * t) :
    pulse.kind === 'hit' ? (1 + 0.35 * t) :
    (1 + 0.25 * t);

  const color =
    pulse.kind === 'kill' ? 'rgba(255, 120, 120, 0.95)' :
    pulse.kind === 'hit' ? 'rgba(120, 255, 175, 0.95)' :
    'rgba(255, 255, 255, 0.85)';

  const shadow =
    pulse.kind === 'kill' ? '0 0 10px rgba(255, 120, 120, 0.6)' :
    pulse.kind === 'hit' ? '0 0 10px rgba(120, 255, 175, 0.55)' :
    '0 0 6px rgba(255, 255, 255, 0.4)';

  return (
    <div style={{ position: 'fixed', left: '50%', top: '50%', width: 14, height: 14, transform: `translate(-50%, -50%) scale(${scale.toFixed(3)})`, pointerEvents: 'none', zIndex: 150, opacity: 0.9, mixBlendMode: 'screen' }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, width: 2, height: 14, transform: 'translateX(-50%)', background: color, boxShadow: shadow }} />
      <div style={{ position: 'absolute', left: 0, top: '50%', width: 14, height: 2, transform: 'translateY(-50%)', background: color, boxShadow: shadow }} />
    </div>
  );
}
