import { TASK_STATUS } from './taskStatus.js';
import { MoveToTask } from './moveToTask.js';

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export class EscortTask {
  constructor(options = {}) {
    this.name = 'escort';
    this.keepDistance = Number.isFinite(options.keepDistance) ? Math.max(0, options.keepDistance) : 1;
    this.maxDistance = Number.isFinite(options.maxDistance) ? Math.max(0, options.maxDistance) : 0;
    this.completeWhen = typeof options.completeWhen === 'function' ? options.completeWhen : null;
    this.abortWhen = typeof options.abortWhen === 'function' ? options.abortWhen : null;
    this.getTargetGrid =
      typeof options.getTargetGrid === 'function'
        ? options.getTargetGrid
        : (ctx) => (typeof ctx?.getEscortTargetGrid === 'function' ? ctx.getEscortTargetGrid() : ctx?.escortTargetGrid);

    this.started = false;
    this.moveTask = null;
    this.lastTarget = null;
  }

  start(ctx = null) {
    this.started = true;
    const target = this.getTargetGrid ? this.getTargetGrid(ctx) : null;
    if (target) {
      this.lastTarget = { x: target.x, y: target.y };
      this.moveTask = new MoveToTask(this.lastTarget, { threshold: this.keepDistance });
      this.moveTask.start(ctx);
    }
  }

  tick(dt, ctx = null) {
    void dt;

    if (this.abortWhen) {
      try {
        if (this.abortWhen(ctx)) return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      } catch {
        return { status: TASK_STATUS.FAILED, intent: { type: 'abort' } };
      }
    }

    if (this.completeWhen) {
      try {
        if (this.completeWhen(ctx)) return { status: TASK_STATUS.SUCCESS, intent: { type: 'complete' } };
      } catch {
        // ignore
      }
    }

    const agentGrid = typeof ctx?.getGridPos === 'function' ? ctx.getGridPos() : ctx?.gridPos;
    const target = this.getTargetGrid ? this.getTargetGrid(ctx) : null;
    if (!agentGrid || !target) return { status: TASK_STATUS.FAILED, intent: null };

    const targetGrid = { x: target.x, y: target.y };
    this.lastTarget = targetGrid;

    const dist = manhattan(agentGrid, targetGrid);
    if (this.maxDistance > 0 && dist > this.maxDistance) {
      return { status: TASK_STATUS.FAILED, intent: { type: 'escort', message: 'Too far' } };
    }

    if (dist <= this.keepDistance) {
      return { status: TASK_STATUS.RUNNING, intent: { type: 'escort', target: targetGrid } };
    }

    if (!this.moveTask || manhattan(this.moveTask.targetGrid, targetGrid) > 0) {
      this.moveTask = new MoveToTask(targetGrid, { threshold: this.keepDistance });
      this.moveTask.start(ctx);
    }

    const res = this.moveTask.tick(dt, ctx);
    if (res?.status === TASK_STATUS.RUNNING) {
      return { ...res, intent: { ...(res.intent || {}), task: 'escort' } };
    }
    if (res?.status === TASK_STATUS.FAILED) return res;

    return { status: TASK_STATUS.RUNNING, intent: { type: 'escort', target: targetGrid } };
  }
}

