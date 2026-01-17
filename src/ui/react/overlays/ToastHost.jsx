import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

function nextId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastHost() {
  const gameApi = useGameApi();
  const [items, setItems] = React.useState([]);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const off = gameApi.subscribe(EVENTS.UI_TOAST, (payload) => {
      const text = String(payload?.text || '');
      if (!text) return;
      const seconds = Number.isFinite(payload?.seconds) ? payload.seconds : 1.8;
      const expiresAt = Date.now() + Math.max(0.4, seconds) * 1000;
      const item = { id: nextId(), text, expiresAt };
      setItems((prev) => [...prev, item].slice(-4));
    });
    return () => off?.();
  }, [gameApi]);

  React.useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setItems((prev) => prev.filter((x) => x.expiresAt > now));
    }, 120);
    return () => clearInterval(t);
  }, [items.length]);

  if (!items.length) return null;

  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2600, pointerEvents: 'none', display: 'grid', gap: 8, width: 'min(640px, calc(100vw - 24px))' }}>
      {items.map((t) => (
        <div key={t.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.94)', fontSize: 14, fontWeight: 700, textAlign: 'center', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

