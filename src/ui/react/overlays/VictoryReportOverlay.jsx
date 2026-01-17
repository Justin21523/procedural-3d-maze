import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

function Row({ r }) {
  const idx = Number.isFinite(r?.levelIndex) ? (r.levelIndex + 1) : '-';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 90px 90px 90px', gap: 8, padding: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.92)', fontSize: 13 }}>
      <div>{idx}</div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r?.name ?? '')}</div>
      <div>{String(r?.timeFormatted ?? '')}</div>
      <div>{String(r?.steps ?? '')}</div>
      <div>{String(r?.roomsVisited ?? '')}</div>
      <div>{String(r?.score ?? '')}</div>
    </div>
  );
}

export function VictoryReportOverlay({ snapshot }) {
  const gameApi = useGameApi();
  const report = snapshot?.victoryReport || {};
  const visible = report.visible === true;

  if (!visible) return null;

  const rows = Array.isArray(report.rows) ? report.rows : [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'rgba(0, 0, 0, 0.96)', padding: 34, borderRadius: 10, textAlign: 'center', width: 'min(920px, calc(100vw - 40px))', border: '3px solid #ffd700', maxHeight: '85vh', overflow: 'auto' }}>
        <h1 style={{ color: '#ffd700', marginBottom: 10, fontSize: 44 }}>{String(report.title || 'Campaign Report')}</h1>
        <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, marginBottom: 14, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
          {String(report.summaryText || '')}
        </div>

        <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 90px 90px 90px', gap: 8, padding: 8, borderBottom: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>
            <div>#</div><div>Level</div><div>Time</div><div>Steps</div><div>Rooms</div><div>Score</div>
          </div>
          {rows.map((r, i) => <Row key={`${r?.levelIndex ?? i}`} r={r} />)}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button
            type="button"
            onClick={() => gameApi?.actions?.restartCampaign?.()}
            style={{ backgroundColor: '#ffd700', color: '#1a1a1a', border: 'none', padding: '12px 22px', fontSize: 16, fontWeight: 'bold', borderRadius: 8, cursor: 'pointer' }}
          >
            Start New Campaign
          </button>
          <button
            type="button"
            onClick={() => gameApi?.actions?.dismissCampaignReport?.()}
            style={{ backgroundColor: '#666', color: '#fff', border: 'none', padding: '12px 22px', fontSize: 16, fontWeight: 'bold', borderRadius: 8, cursor: 'pointer' }}
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

