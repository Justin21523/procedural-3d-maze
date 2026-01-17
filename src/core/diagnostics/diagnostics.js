import { CONFIG } from '../config.js';

function safeString(v) {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pickMemorySnapshot() {
  try {
    const mem = performance?.memory;
    if (!mem) return null;
    const used = Number(mem.usedJSHeapSize);
    const total = Number(mem.totalJSHeapSize);
    const limit = Number(mem.jsHeapSizeLimit);
    if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isFinite(limit)) return null;
    return { used, total, limit };
  } catch {
    return null;
  }
}

export class Diagnostics {
  constructor(options = {}) {
    this.maxErrors = Math.max(5, Math.round(Number(options.maxErrors) || 20));
    this.maxNoise = Math.max(10, Math.round(Number(options.maxNoise) || 40));
    this.errors = [];
    this.noise = [];
    this.perf = { fpsEma: null, dt: null, guardTier: null };
    this.context = {
      version: options.version || null,
      levelId: null,
      levelIndex: null,
      seed: null
    };
    this._bound = false;
    this._lastCrashAtMs = 0;
  }

  setContext(patch = {}) {
    this.context = { ...this.context, ...(patch || {}) };
  }

  setPerfSample(sample = {}) {
    const fpsEma = Number(sample.fpsEma);
    const dt = Number(sample.dt);
    const guardTier = Number(sample.guardTier);
    this.perf = {
      fpsEma: Number.isFinite(fpsEma) ? fpsEma : this.perf.fpsEma,
      dt: Number.isFinite(dt) ? dt : this.perf.dt,
      guardTier: Number.isFinite(guardTier) ? guardTier : this.perf.guardTier
    };
  }

  recordNoise(payload, extra = {}) {
    if (!payload) return;
    const nowMs = Date.now();
    const entry = {
      tMs: nowMs,
      kind: payload.kind || payload.type || 'noise',
      radius: payload.radius ?? null,
      strength: payload.strength ?? null,
      grid: payload.grid ?? null,
      position: payload.position ? { x: payload.position.x, y: payload.position.y, z: payload.position.z } : null,
      source: payload.source?.id ?? payload.sourceMonster?.id ?? null,
      ...extra
    };
    this.noise.push(entry);
    while (this.noise.length > this.maxNoise) this.noise.shift();
  }

  captureError(source, err, extra = {}) {
    const nowMs = Date.now();
    const errorObj = err instanceof Error ? err : null;
    const message = errorObj?.message || (typeof err === 'string' ? err : safeString(err));
    const stack = errorObj?.stack || (extra?.stack ? safeString(extra.stack) : null);

    const entry = {
      tMs: nowMs,
      source: source || 'error',
      message,
      stack,
      href: (typeof location !== 'undefined' && location.href) ? location.href : null,
      context: { ...this.context },
      perf: { ...this.perf },
      memory: pickMemorySnapshot()
    };
    this.errors.push(entry);
    while (this.errors.length > this.maxErrors) this.errors.shift();

    // Avoid spam if something throws every frame.
    this._lastCrashAtMs = nowMs;
    return entry;
  }

  getRecentErrors() {
    return this.errors.slice();
  }

  getRecentNoise() {
    return this.noise.slice();
  }

  shouldShowCrashOverlay() {
    if (CONFIG.DEBUG_CRASH_OVERLAY_ENABLED === false) return false;
    const last = this.errors.length ? this.errors[this.errors.length - 1] : null;
    if (!last) return false;
    const nowMs = Date.now();
    return nowMs - (last.tMs || 0) <= 5 * 60_000;
  }

  buildReportString() {
    const last = this.errors.length ? this.errors[this.errors.length - 1] : null;
    const lines = [];
    lines.push('=== Procedural 3D Maze Diagnostics ===');
    lines.push(`time: ${new Date().toISOString()}`);
    lines.push(`version: ${this.context.version ?? '(unknown)'}`);
    lines.push(`levelIndex: ${this.context.levelIndex ?? '(unknown)'}`);
    lines.push(`levelId: ${this.context.levelId ?? '(unknown)'}`);
    lines.push(`seed: ${this.context.seed ?? '(unknown)'}`);
    lines.push(`perf: fpsEma=${this.perf.fpsEma ?? '(n/a)'} dt=${this.perf.dt ?? '(n/a)'} guardTier=${this.perf.guardTier ?? '(n/a)'}`);

    const mem = pickMemorySnapshot();
    if (mem) {
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      lines.push(`memory: used=${mb(mem.used)}MB total=${mb(mem.total)}MB limit=${mb(mem.limit)}MB`);
    }

    if (last) {
      lines.push('');
      lines.push('--- Last Error ---');
      lines.push(`source: ${last.source}`);
      lines.push(`message: ${last.message}`);
      if (last.stack) {
        lines.push('stack:');
        lines.push(last.stack);
      }
      if (last.href) lines.push(`href: ${last.href}`);
    }

    if (this.errors.length > 1) {
      lines.push('');
      lines.push('--- Recent Errors ---');
      for (const e of this.errors.slice(-5)) {
        lines.push(`${new Date(e.tMs).toISOString()} [${e.source}] ${e.message}`);
      }
    }

    return lines.join('\n');
  }

  async copyReportToClipboard() {
    const text = this.buildReportString();
    try {
      await navigator?.clipboard?.writeText?.(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch {
        return false;
      }
    }
  }

  attachWindowHandlers() {
    if (this._bound) return;
    this._bound = true;
    window.addEventListener('error', (e) => {
      this.captureError('window.error', e?.error || e?.message || e, { filename: e?.filename, lineno: e?.lineno, colno: e?.colno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.captureError('window.unhandledrejection', e?.reason || e, {});
    });
  }
}

