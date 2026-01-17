import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

export function GameOverOverlay({ snapshot }) {
  const gameApi = useGameApi();
  const show = snapshot?.gameOver === true;
  const victory = snapshot?.victory === true;
  const defeat = snapshot?.defeat === true;
  const stats = snapshot?.runStats || null;
  const reason = String(snapshot?.hud?.gameOverReason || (victory ? 'You escaped the maze!' : 'Game over'));

  if (!show) return null;

  const title = victory ? '🎉 Victory!' : defeat ? '💀 Defeat' : 'Game Over';
  const titleColor = victory ? '#ffd700' : '#ff4444';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ backgroundColor: 'rgba(0, 0, 0, 0.95)', padding: 40, borderRadius: 10, textAlign: 'center', minWidth: 400, width: 'min(560px, calc(100vw - 40px))', border: '3px solid #ffd700' }}>
        <h1 style={{ color: titleColor, marginBottom: 20, fontSize: 48 }}>{title}</h1>
        <div style={{ color: '#fff', fontSize: 18, marginBottom: 22 }}>
          {reason}
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: 20, borderRadius: 6, marginBottom: 20, textAlign: 'left' }}>
          <div style={{ color: '#ffd700', fontWeight: 900, marginBottom: 12 }}>📊 Run Stats</div>
          <div style={{ display: 'grid', gap: 8, color: 'rgba(255,255,255,0.92)', fontSize: 14 }}>
            <div><strong>Time:</strong> {stats?.timeFormatted ?? '—'}</div>
            <div><strong>Health:</strong> {Number.isFinite(stats?.health) ? `${stats.health}/${stats.maxHealth ?? ''}` : '—'}</div>
            <div><strong>Rooms Visited:</strong> {stats?.roomsVisited ?? '—'}</div>
            <div><strong>Steps:</strong> {stats?.steps ?? '—'}</div>
            <div><strong>Score:</strong> {stats?.score ?? '—'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {victory ? (
            <button
              type="button"
              onClick={() => gameApi?.actions?.nextLevel?.()}
              style={{ backgroundColor: '#00d084', color: '#0c1b0c', border: 'none', padding: '15px 32px', fontSize: 18, fontWeight: 'bold', borderRadius: 6, cursor: 'pointer' }}
            >
              Next Level
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => gameApi?.actions?.restartLevel?.()}
            style={{ backgroundColor: '#ffd700', color: '#1a1a1a', border: 'none', padding: '15px 32px', fontSize: 18, fontWeight: 'bold', borderRadius: 6, cursor: 'pointer' }}
          >
            Restart
          </button>
          <button
            type="button"
            onClick={() => gameApi?.actions?.returnToMenu?.()}
            style={{ backgroundColor: '#666', color: '#fff', border: 'none', padding: '15px 32px', fontSize: 18, fontWeight: 'bold', borderRadius: 6, cursor: 'pointer' }}
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

