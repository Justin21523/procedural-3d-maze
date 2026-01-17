import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { GameApiProvider } from './GameApiContext.jsx';

let root = null;

export function mountUI({ gameApi } = {}) {
  const el = document.getElementById('ui-root');
  if (!el) return;
  if (!root) {
    root = createRoot(el);
  }
  root.render(
    <React.StrictMode>
      <GameApiProvider gameApi={gameApi}>
        <App />
      </GameApiProvider>
    </React.StrictMode>
  );
}

