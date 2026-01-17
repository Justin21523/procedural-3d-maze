import React from 'react';
import { useGameApi } from '../GameApiContext.jsx';

export function MinimapToggleOverlay({ snapshot }) {
  const gameApi = useGameApi();
  const mm = snapshot?.minimap || {};
  const forced = mm.forcedHidden === true;
  const hidden = mm.hidden === true;

  // Replaced by MinimapChrome (portal into minimap container).
  void gameApi;
  void forced;
  void hidden;
  return null;

  return (
    <div style={{ position: 'fixed', top: 22, right: 22, zIndex: 1200, pointerEvents: 'auto' }}>
      <button
        type="button"
        disabled={forced}
        onClick={() => gameApi?.actions?.setMinimapHidden?.(!hidden)}
        style={{
          padding: '6px 10px',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.55)',
          color: forced ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)',
          cursor: forced ? 'not-allowed' : 'pointer',
          fontWeight: 800,
          fontSize: 12
        }}
        title={forced ? 'Minimap is forced off by the current mode' : ''}
      >
        {forced ? 'Minimap: Forced Off' : hidden ? 'Minimap: Show' : 'Minimap: Hide'}
      </button>
    </div>
  );
}
