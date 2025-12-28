const PAGES = [
  { key: 'game', label: 'Game', href: '/' },
  { key: 'hub', label: 'Debug Hub', href: '/debug-hub.html' },
  { key: 'levels', label: 'Level Lab', href: '/level-lab.html' },
  { key: 'lab', label: 'Enemy Lab', href: '/enemy-lab.html' },
  { key: 'ai', label: 'AI Test', href: '/test-ai.html' },
  { key: 'meta', label: 'Meta Preview', href: '/test-enemy-meta.html' },
  { key: 'diag', label: 'Diagnostics', href: '/diagnostic.html' }
];

function getPathname() {
  const p = String(window.location?.pathname || '/');
  if (p === '') return '/';
  return p;
}

function isActiveHref(href) {
  const path = getPathname();
  if (href === '/') {
    return path === '/' || path.endsWith('/index.html');
  }
  return path === href || path.endsWith(href);
}

function computeTopOffset() {
  const uiOverlay = document.getElementById('ui-overlay');
  if (!uiOverlay) return 12;
  const rect = uiOverlay.getBoundingClientRect();
  const next = rect.top + rect.height + 10;
  return Number.isFinite(next) ? Math.max(12, Math.round(next)) : 12;
}

function installStyles() {
  if (document.getElementById('tool-nav-styles')) return;
  const style = document.createElement('style');
  style.id = 'tool-nav-styles';
  style.textContent = `
    #tool-nav {
      position: fixed;
      left: 12px;
      top: 12px;
      z-index: 1400;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.92);
      pointer-events: auto;
      user-select: none;
    }

    #tool-nav .tool-nav-title {
      font-weight: 650;
      opacity: 0.9;
      margin-right: 4px;
    }

    #tool-nav a, #tool-nav button {
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.92);
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    #tool-nav a:hover, #tool-nav button:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    #tool-nav a.active {
      border-color: rgba(122, 162, 255, 0.55);
      background: rgba(122, 162, 255, 0.22);
    }

    #tool-nav button {
      appearance: none;
    }
  `;
  document.head.appendChild(style);
}

export function installToolNav() {
  if (document.getElementById('tool-nav')) return;
  installStyles();

  const nav = document.createElement('div');
  nav.id = 'tool-nav';
  nav.style.top = `${computeTopOffset()}px`;

  const title = document.createElement('span');
  title.className = 'tool-nav-title';
  title.textContent = 'Tools';
  nav.appendChild(title);

  const backToGameBtn = document.createElement('button');
  backToGameBtn.type = 'button';
  backToGameBtn.textContent = 'Back to Game';
  backToGameBtn.title = 'Return to the main game (/)';
  backToGameBtn.addEventListener('click', () => {
    try {
      window.location.assign('/');
    } catch {
      // ignore
    }
  });
  nav.appendChild(backToGameBtn);

  for (const page of PAGES) {
    const a = document.createElement('a');
    a.href = page.href;
    a.textContent = page.label;
    if (isActiveHref(page.href)) a.classList.add('active');
    nav.appendChild(a);
  }

  document.body.appendChild(nav);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => installToolNav(), { once: true });
} else {
  installToolNav();
}
