import { TASK_STATUS } from './taskStatus.js';
import { MoveToTask } from './moveToTask.js';

export class GuardTask {
  constructor(guardGrid, options = {}) {
    this.name = 'guard';
    this.guardGrid = guardGrid ? { x: guardGrid.x, y: guardGrid.y } : null;
    this.threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0;
    this.durationSec = Number.isFinite(options.durationSec) ? Math.max(0, options.durationSec) : 0;
    this.completeWhen = typeof options.completeWhen === 'function' ? options.completeWhen : null;
    this.abortWhen = typeof options.abortWhen === 'function' ? options.abortWhen : null;

    this.started = false;
    this.elapsed = 0;
    this.moveTask = this.guardGrid ? new MoveToTask(this.guardGrid, { threshold: this.threshold }) : null;
    this.atPost = false;
  }

  start(ctx = null) {
    this.started = true;
    this.moveTask?.start?.(ctx);
  }

  tick(dt, ctx = null) {
    if (!this.guardGrid || !this.moveTask) return { status: TASK_STATUS.FAILED, intent: null };

    if (this.abortWhen) {
      try {
        if (this.abortWhen(ctx)) return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      } catch {
        return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      }
    }

    if (!this.atPost) {
      const res = this.moveTask.tick(dt, ctx);
      if (res?.status !== TASK_STATUS.SUCCESS) return res;
      this.atPost = true;
    }

    if (this.completeWhen) {
      try {
        if (this.completeWhen(ctx)) return { status: TASK_STATUS.SUCCESS, intent: { type: 'complete' } };
      } catch {
        // ignore
      }
    }

    if (this.durationSec > 0) {
      this.elapsed += Math.max(0, dt || 0);
      if (this.elapsed >= this.durationSec) {
        return { status: TASK_STATUS.SUCCESS, intent: { type: 'guard', target: this.guardGrid } };
      }
    }

    return { status: TASK_STATUS.RUNNING, intent: { type: 'guard', target: this.guardGrid } };
  }
}

