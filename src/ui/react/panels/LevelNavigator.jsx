import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

export function LevelNavigator({ snapshot }) {
  const gameApi = useGameApi();
  const [jump, setJump] = React.useState(() => String((snapshot?.levelIndex ?? 0) + 1));
  const current = Number.isFinite(snapshot?.levelIndex) ? snapshot.levelIndex + 1 : null;
  const total = Number.isFinite(snapshot?.campaign?.levelCount) ? snapshot.campaign.levelCount : null;

  React.useEffect(() => {
    if (current !== null) setJump(String(current));
  }, [current]);

  const onJump = async () => {
    const raw = Math.round(Number(jump) || 1);
    await gameApi?.actions?.jumpToLevel?.(raw);
  };

  return (
    <div style={{ color: 'rgba(255,255,255,0.92)' }}>
      <div style={{ fontSize: 12, opacity: 0.9 }}>
        Current: <span style={{ color: '#ffd700', fontWeight: 900 }}>{current ?? '—'}</span>{total ? ` / ${total}` : ''}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          onClick={() => gameApi?.actions?.prevLevel?.()}
          style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontWeight: 900 }}
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => gameApi?.actions?.nextLevel?.()}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#ffd700', color: '#1a1a1a', cursor: 'pointer', fontWeight: 900 }}
        >
          Next →
        </button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          type="number"
          min={1}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.92)' }}
        />
        <button
          type="button"
          onClick={onJump}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#2196f3', color: '#fff', cursor: 'pointer', fontWeight: 900 }}
        >
          Jump
        </button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          onClick={() => gameApi?.actions?.restartLevel?.()}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#ff9800', color: '#1a1a1a', cursor: 'pointer', fontWeight: 900 }}
        >
          Restart Level
        </button>
        <button
          type="button"
          onClick={() => gameApi?.actions?.restartCampaign?.()}
          style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#9c27b0', color: '#fff', cursor: 'pointer', fontWeight: 900 }}
        >
          Go to L1
        </button>
      </div>
    </div>
  );
}

