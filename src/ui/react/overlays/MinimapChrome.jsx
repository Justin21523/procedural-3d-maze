import React from 'react';
import { createPortal } from 'react-dom';
import { useGameApi } from '../GameApiContext.jsx';

export function MinimapChrome({ snapshot }) {
  const gameApi = useGameApi();
  const target = React.useMemo(() => document.getElementById('minimap-container'), []);
  const mm = snapshot?.minimap || {};
  const dbg = snapshot?.debugPrefs || {};
  const forced = mm.forcedHidden === true;
  const hidden = mm.hidden === true;

  if (!target) return null;

  React.useEffect(() => {
    // Ensure minimap-container stays visible and anchored top-right (even if other styles change).
    target.style.position = 'fixed';
    target.style.top = '12px';
    target.style.right = '12px';
    target.style.zIndex = '2500';
    target.style.pointerEvents = 'auto';
    target.style.display = 'block';

    const viewport = document.getElementById('minimap-viewport');
    if (viewport) {
      viewport.style.marginTop = '56px';
      viewport.style.display = (forced || hidden) ? 'none' : 'block';
    }
  }, [target, forced, hidden]);

  const legend = (
    <div style={{ fontSize: 10, lineHeight: 1.35, opacity: 0.95 }}>
      <div><span style={{ color: '#32cd32' }}>●</span> Player <span style={{ color: '#00ff00', fontSize: 12 }}>★</span> Exit <span style={{ color: '#ff1493' }}>●</span> Monster</div>
      <div><span style={{ color: '#ff7043' }}>◆</span> Pickups <span style={{ color: '#ffffff' }}>●</span> Devices</div>
      {dbg.markers ? <div><span style={{ color: '#00dcff' }}>●</span> AI target <span style={{ color: '#ffeb3b' }}>●</span> last seen <span style={{ color: '#ff7043' }}>●</span> noise</div> : null}
      {dbg.navHeatmap ? <div><span style={{ color: '#66aaff' }}>■</span> Nav heatmap enabled</div> : null}
      {dbg.minimapShowObstacles ? <div><span style={{ color: '#9e9e9e' }}>■</span> Obstacles enabled</div> : null}
    </div>
  );

  const content = (
    <div style={{ position: 'absolute', top: 6, left: 8, right: 8, pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13 }}>🗺️ Minimap</div>
        <button
          type="button"
          disabled={forced}
          onClick={() => gameApi?.actions?.setMinimapHidden?.(!hidden)}
          style={{
            padding: '6px 10px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(0,0,0,0.35)',
            color: forced ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)',
            cursor: forced ? 'not-allowed' : 'pointer',
            fontWeight: 800,
            fontSize: 11
          }}
          title={forced ? 'Minimap is forced off by the current mode' : ''}
        >
          {forced ? 'Disabled' : hidden ? 'Show' : 'Hide'}
        </button>
      </div>
      <div style={{ marginTop: 6, pointerEvents: 'none' }}>
        {legend}
      </div>
    </div>
  );

  return createPortal(content, target);
}
