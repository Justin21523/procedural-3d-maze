import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

export function InteractPromptOverlay() {
  const gameApi = useGameApi();
  const [hoverText, setHoverText] = React.useState('');
  const [flash, setFlash] = React.useState({ text: '', untilMs: 0 });

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const offHover = gameApi.subscribe(EVENTS.INTERACTABLE_HOVER, (payload) => {
      setHoverText(String(payload?.text || ''));
    });
    const offExitLocked = gameApi.subscribe(EVENTS.EXIT_LOCKED, (payload) => {
      const text = String(payload?.message || 'Exit locked');
      const seconds = Number.isFinite(payload?.seconds) ? payload.seconds : 1.2;
      setFlash({ text, untilMs: Date.now() + Math.max(0.2, seconds) * 1000 });
    });
    return () => {
      offHover?.();
      offExitLocked?.();
    };
  }, [gameApi]);

  React.useEffect(() => {
    if (!flash.untilMs) return;
    const t = setInterval(() => {
      if (Date.now() >= flash.untilMs) {
        setFlash({ text: '', untilMs: 0 });
      }
    }, 80);
    return () => clearInterval(t);
  }, [flash.untilMs]);

  const text = flash.text || hoverText || '';
  if (!text) return null;

  return (
    <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, calc(-50% + 44px))', padding: '6px 10px', background: 'rgba(0, 0, 0, 0.55)', border: '1px solid rgba(255, 215, 0, 0.7)', borderRadius: 6, color: '#ffffff', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 250, textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
      {text}
    </div>
  );
}
