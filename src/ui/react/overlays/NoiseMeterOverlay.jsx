import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

export function NoiseMeterOverlay() {
  const gameApi = useGameApi();
  const [state, setState] = React.useState(() => ({ lastAtMs: 0, lastStrength: 0 }));

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const off = gameApi.subscribe(EVENTS.NOISE_EMITTED, (payload) => {
      if (payload?.source !== 'player') return;
      const strengthRaw = Number(payload?.strength);
      if (!Number.isFinite(strengthRaw)) return;
      const strength = Math.max(0, Math.min(1, strengthRaw));
      setState((prev) => ({
        lastAtMs: performance.now(),
        lastStrength: Math.max(prev.lastStrength || 0, strength)
      }));
    });
    return () => off?.();
  }, [gameApi]);

  const decaySeconds = 1.35;
  const [now, setNow] = React.useState(() => performance.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 80);
    return () => clearInterval(t);
  }, []);

  const ageSec = Math.max(0, (now - (state.lastAtMs || 0)) / 1000);
  const t = 1 - (ageSec / decaySeconds);
  const level = Math.max(0, Math.min(1, (state.lastStrength || 0) * t));
  const pct = Math.round(level * 100);
  if (pct <= 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ margin: '6px 0 4px 0', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Noise</div>
      <div style={{ width: 200, height: 8, background: '#222', border: '1px solid #444' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #66aaff, #ff4444)', transition: 'width 0.08s' }} />
      </div>
    </div>
  );
}

