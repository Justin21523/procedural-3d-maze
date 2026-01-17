import React from 'react';

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ color: '#ffd700', fontWeight: 900, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Key({ children }) {
  return <span style={{ color: '#ffd700', fontWeight: 900 }}>{children}</span>;
}

export function GuidePanel() {
  return (
    <div style={{ color: 'rgba(255,255,255,0.92)' }}>
      <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.55 }}>
        This is the in-game guide for controls, objectives, stealth, and troubleshooting. It’s designed to be readable in a desktop build (Tauri) too.
      </div>

      <Section title="Controls (Default)">
        <div><Key>WASD</Key> move • <Key>Mouse</Key> look • <Key>Shift</Key> run/sprint</div>
        <div><Key>E</Key> interact • <Key>Left Click</Key> shoot • <Key>R</Key> reload</div>
        <div><Key>ESC</Key> menu/pause • <Key>F5/F9</Key> quick save/load</div>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>Pointer lock tips</summary>
          <div style={{ marginTop: 8 }}>
            The game uses pointer lock (mouse capture). If your mouse stops controlling the camera:
            <div style={{ marginTop: 6 }}>- Click inside the game view to re-lock the pointer.</div>
            <div>- Press <Key>ESC</Key> to open menu, then press Continue.</div>
          </div>
        </details>
      </Section>

      <Section title="Objective / Win Condition">
        <div>Complete mission objectives, then reach the exit.</div>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>How the campaign works</summary>
          <div style={{ marginTop: 8 }}>
            Each level has a mission list (some required). When the required set is complete, the exit becomes available.
            Failures contribute to the campaign failure limit; after the limit, the campaign resets to Level 1.
          </div>
        </details>
      </Section>

      <Section title="Stealth (Sound Matters)">
        <div>Sound is a core mechanic. Running is louder than walking; interacting with objects can generate noise.</div>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>Practical stealth tips</summary>
          <div style={{ marginTop: 8 }}>
            <div>- If you hear monsters nearby, prefer walking and avoid unnecessary interactions.</div>
            <div>- Use corners and rooms to break line-of-sight.</div>
            <div>- If chased, change direction at junctions; don’t run a straight corridor forever.</div>
          </div>
        </details>
      </Section>

      <Section title="Combat Basics">
        <div>Combat is intentionally risky. The safest strategy is to disengage, reposition, and only fight when you have space.</div>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>If you feel “soft locked”</summary>
          <div style={{ marginTop: 8 }}>
            If you can’t progress (e.g. no path / missing objective / stuck state), open menu (<Key>ESC</Key>) and use Tools:
            <div style={{ marginTop: 6 }}>- “New Map” to regenerate</div>
            <div>- “Reload Level JSON” if you are actively editing `public/levels/*.json`</div>
            <div>- “Copy Crash Report” and share it with the seed + settings</div>
          </div>
        </details>
      </Section>

      <Section title="Troubleshooting">
        <details style={{ marginTop: 4, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>Minimap not visible</summary>
          <div style={{ marginTop: 8 }}>
            Minimap only shows during gameplay. If it is hidden, open Settings → Minimap and enable it.
          </div>
        </details>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>Audio is missing / 404</summary>
          <div style={{ marginTop: 8 }}>
            Some audio assets are optional. If a sound file is missing, the game should still run; you may see a console warning.
          </div>
        </details>
        <details style={{ marginTop: 8, opacity: 0.95 }}>
          <summary style={{ cursor: 'pointer' }}>How to report a bug</summary>
          <div style={{ marginTop: 8 }}>
            Open Tools → “Copy Crash Report” and include:
            <div style={{ marginTop: 6 }}>- Seed / level</div>
            <div>- Your Settings export</div>
            <div>- Steps to reproduce</div>
          </div>
        </details>
      </Section>
    </div>
  );
}

