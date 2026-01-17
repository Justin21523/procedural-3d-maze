import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

export function CrashOverlay({ snapshot }) {
  const gameApi = useGameApi();
  const diag = snapshot?.diagnostics || {};
  const show = diag.showCrashOverlay === true;
  const last = diag.lastError || null;
  const recent = Array.isArray(diag.recentErrors) ? diag.recentErrors : [];
  const [dismissedAt, setDismissedAt] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!show) return;
    // New crash: clear dismiss for this session.
    setDismissedAt(0);
    setExpanded(false);
  }, [show, last?.tMs]);

  if (!show) return null;
  if (dismissedAt && last?.tMs && dismissedAt >= last.tMs) return null;

  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, maxWidth: 'min(720px, calc(100vw - 24px))', background: 'rgba(80, 0, 0, 0.85)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, padding: '10px 12px', zIndex: 3200, color: 'rgba(255,255,255,0.95)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>💥 Crash Captured</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, cursor: 'pointer' }}
          >
            {expanded ? 'Hide Details' : 'Details'}
          </button>
          <button
            type="button"
            onClick={() => gameApi?.actions?.copyCrashReport?.()}
            style={{ padding: '4px 8px', background: '#ffd700', color: '#1a1a1a', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}
          >
            Copy Report
          </button>
          <button
            type="button"
            onClick={() => setDismissedAt(Date.now())}
            style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, cursor: 'pointer' }}
          >
            Hide
          </button>
        </div>
      </div>
      <div style={{ marginTop: 6, opacity: 0.95, whiteSpace: 'pre-wrap' }}>
        {last ? `[${String(last.source)}] ${String(last.message || '')}` : '(unknown)'}
      </div>

      {expanded ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.14)' }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Recent errors ({Number(diag.errorCount) || 0})</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.length ? recent.slice().reverse().map((e, i) => (
              <div key={`${e?.tMs ?? i}`} style={{ padding: 8, borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.10)' }}>
                <div style={{ opacity: 0.95 }}>
                  <span style={{ color: '#ffd700', fontWeight: 900 }}>{String(e?.source || 'error')}</span>{' '}
                  <span style={{ opacity: 0.85 }}>{e?.tMs ? new Date(e.tMs).toLocaleString() : ''}</span>
                </div>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(e?.message || '')}</div>
                {e?.stack ? (
                  <div style={{ marginTop: 6, opacity: 0.9, whiteSpace: 'pre-wrap', fontSize: 11 }}>{String(e.stack)}</div>
                ) : null}
              </div>
            )) : (
              <div style={{ opacity: 0.85 }}>(none)</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
