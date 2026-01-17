import { CONFIG } from '../../../core/config.js';

export class InvestigateModule {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.defaultDurationSeconds =
      Number.isFinite(options.durationSeconds) ? Math.max(0.25, options.durationSeconds) : (CONFIG.AI_INVESTIGATE_TIME ?? 4.8);
    this.pauseSeconds =
      Number.isFinite(options.pauseSeconds) ? Math.max(0, options.pauseSeconds) : (CONFIG.AI_INVESTIGATE_PAUSE_SECONDS ?? 0.45);
    this.state = null;
  }

  reset() {
    this.state = null;
  }

  begin(targetGrid, now, options = {}) {
    if (!this.enabled) return false;
    if (!targetGrid || !Number.isFinite(targetGrid.x) || !Number.isFinite(targetGrid.y)) return false;
    const t = Number.isFinite(now) ? now : performance.now() / 1000;
    const dur = Number.isFinite(options.durationSeconds) ? Math.max(0.25, options.durationSeconds) : this.defaultDurationSeconds;
    this.state = {
      targetGrid: { x: targetGrid.x, y: targetGrid.y },
      until: t + dur,
      pauseUntil: 0
    };
    return true;
  }

  tick({ now, monsterGrid } = {}) {
    if (!this.enabled) return { status: 'disabled', targetGrid: null };
    if (!this.state?.targetGrid) return { status: 'idle', targetGrid: null };
    if (!monsterGrid) return { status: 'idle', targetGrid: null };
    const t = Number.isFinite(now) ? now : performance.now() / 1000;
    if (t > (this.state.until || 0)) return { status: 'done', targetGrid: this.state.targetGrid };

    const dist = Math.abs(monsterGrid.x - this.state.targetGrid.x) + Math.abs(monsterGrid.y - this.state.targetGrid.y);
    if (dist <= 1) {
      if (!((this.state.pauseUntil || 0) > t)) {
        this.state.pauseUntil = t + this.pauseSeconds;
      }
      if ((this.state.pauseUntil || 0) > t) return { status: 'pause', targetGrid: this.state.targetGrid };
      return { status: 'done', targetGrid: this.state.targetGrid };
    }

    return { status: 'investigate', targetGrid: this.state.targetGrid };
  }
}

