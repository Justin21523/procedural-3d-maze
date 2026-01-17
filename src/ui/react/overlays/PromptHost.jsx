import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

export function PromptHost() {
  const gameApi = useGameApi();
  const [prompt, setPrompt] = React.useState(null);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const off = gameApi.subscribe(EVENTS.UI_PROMPT, (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const id = String(payload.id || '').trim() || `${Date.now()}`;
      setPrompt({
        id,
        title: String(payload.title || 'Confirm'),
        text: String(payload.text || ''),
        okText: String(payload.okText || 'OK'),
        cancelText: String(payload.cancelText || 'Cancel')
      });
    });
    return () => off?.();
  }, [gameApi]);

  if (!prompt) return null;

  const respond = (accepted) => {
    gameApi?.emit?.(EVENTS.UI_PROMPT_RESULT, { id: prompt.id, accepted: !!accepted });
    setPrompt(null);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', zIndex: 3600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(520px, calc(100vw - 40px))', borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.92)', padding: 18, color: 'rgba(255,255,255,0.92)' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#ffd700' }}>{prompt.title}</div>
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{prompt.text}</div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={() => respond(false)}
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 800 }}
          >
            {prompt.cancelText}
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#ffd700', color: '#1a1a1a', cursor: 'pointer', fontWeight: 900 }}
          >
            {prompt.okText}
          </button>
        </div>
      </div>
    </div>
  );
}

