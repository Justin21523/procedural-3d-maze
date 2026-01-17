import React from 'react';
import { EVENTS } from '../../../core/events.js';
import { useGameApi } from '../GameApiContext.jsx';

function codeToDigit(code) {
  const c = String(code || '');
  if (c.length === 6 && c.startsWith('Digit')) {
    const d = c.slice(5);
    if (d >= '0' && d <= '9') return d;
  }
  if (c.length === 7 && c.startsWith('Numpad')) {
    const d = c.slice(6);
    if (d >= '0' && d <= '9') return d;
  }
  return null;
}

export function KeypadOverlay() {
  const gameApi = useGameApi();
  const [mode, setMode] = React.useState(null); // { keypadId, codeLength }
  const [buf, setBuf] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const prevAutopilotRef = React.useRef(null);

  const close = React.useCallback(() => {
    setMode(null);
    setBuf('');
    setSubmitting(false);
    if (prevAutopilotRef.current !== null) {
      gameApi?.actions?.setAutopilotEnabled?.(prevAutopilotRef.current);
      prevAutopilotRef.current = null;
    }
  }, [gameApi]);

  React.useEffect(() => {
    if (!gameApi?.subscribe) return;
    const offMission = gameApi.subscribe(EVENTS.MISSION_STARTED, () => close());
    const offInteract = gameApi.subscribe(EVENTS.INTERACT, (payload) => {
      if (payload?.actorKind !== 'player') return;
      if (payload?.kind !== 'keypad') return;
      if (!payload?.result?.openKeypad) return;
      const keypadId = String(payload?.id || '').trim();
      if (!keypadId) return;
      const lenRaw = Number(payload?.result?.codeLength);
      const codeLength = Number.isFinite(lenRaw) ? Math.max(1, Math.floor(lenRaw)) : 3;
      if (prevAutopilotRef.current === null) {
        const getter = gameApi?.actions?.getAutopilotEnabled;
        const setter = gameApi?.actions?.setAutopilotEnabled;
        if (typeof getter === 'function' && typeof setter === 'function') {
          const currentEnabled = getter();
          if (typeof currentEnabled === 'boolean') {
            prevAutopilotRef.current = currentEnabled;
            setter(false);
          }
        }
      }
      setMode({ keypadId, codeLength });
      setBuf('');
      setSubmitting(false);
    });
    const offResult = gameApi.subscribe(EVENTS.KEYPAD_CODE_RESULT, (payload) => {
      if (payload?.actorKind !== 'player') return;
      const keypadId = String(payload?.keypadId || '').trim();
      if (!keypadId) return;
      if (mode?.keypadId !== keypadId) return;
      setSubmitting(false);
      if (payload?.ok) close();
      else setBuf('');
    });
    return () => {
      offMission?.();
      offInteract?.();
      offResult?.();
    };
  }, [gameApi, close, mode?.keypadId]);

  React.useEffect(() => {
    if (!mode?.keypadId) return;
    const onKey = (e) => {
      if (!mode?.keypadId) return;
      if (!e?.code) return;
      const digit = codeToDigit(e.code);
      const len = Number(mode.codeLength) || 0;

      if (digit !== null) {
        if (!submitting && (buf.length < len || len <= 0)) {
          const next = (buf + digit).slice(0, len > 0 ? len : undefined);
          setBuf(next);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (e.code === 'Backspace') {
        if (!submitting) {
          if (buf.length > 0) setBuf(buf.slice(0, -1));
          else close();
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (submitting) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (len > 0 && buf.length !== len) {
          gameApi?.emit?.(EVENTS.UI_TOAST, { text: `Enter ${len} digits.`, seconds: 1.4 });
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        setSubmitting(true);
        gameApi?.emit?.(EVENTS.KEYPAD_CODE_SUBMITTED, {
          actorKind: 'player',
          keypadId: mode.keypadId,
          code: String(buf || ''),
          nowMs: performance.now()
        });
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyE') {
        close();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, buf, submitting, close, gameApi]);

  if (!mode?.keypadId) return null;

  const len = Number(mode.codeLength) || 0;
  const padded = len > 0 ? (buf + '_'.repeat(Math.max(0, len - buf.length))).slice(0, len) : buf;
  const status = submitting ? 'Submitting…' : 'Enter=OK Backspace=Del E=Exit';

  return (
    <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, calc(-50% + 96px))', zIndex: 2600, pointerEvents: 'none' }}>
      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.94)', fontSize: 13, fontWeight: 800, textAlign: 'center', whiteSpace: 'pre-line' }}>
        {`Keypad: ${padded}\n(${status})`}
      </div>
    </div>
  );
}
