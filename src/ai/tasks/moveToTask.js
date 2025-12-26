import { TASK_STATUS } from './taskStatus.js';

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export class MoveToTask {
  constructor(targetGrid, options = {}) {
    this.name = 'moveTo';
    this.targetGrid = targetGrid ? { x: targetGrid.x, y: targetGrid.y } : null;
    this.threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0;
    this.started = false;
  }

  start() {
    this.started = true;
  }

  tick(dt, ctx = null) {
    void dt;
    const getGridPos = ctx?.getGridPos;
    const current = typeof getGridPos === 'function' ? getGridPos() : ctx?.gridPos;
    if (!this.targetGrid) return { status: TASK_STATUS.FAILED, intent: null };

    const dist = manhattan(current, this.targetGrid);
    if (dist <= this.threshold) {
      return { status: TASK_STATUS.SUCCESS, intent: { type: 'arrived', target: this.targetGrid } };
    }
    return { status: TASK_STATUS.RUNNING, intent: { type: 'moveTo', target: this.targetGrid } };
  }
}

