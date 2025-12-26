import { TASK_STATUS } from './taskStatus.js';

export class TaskRunner {
  constructor(tasks = []) {
    this.queue = Array.isArray(tasks) ? tasks.slice() : [];
    this.current = null;
  }

  setTasks(tasks = []) {
    this.queue = Array.isArray(tasks) ? tasks.slice() : [];
    this.current = null;
  }

  push(task) {
    if (!task) return;
    this.queue.push(task);
  }

  clear() {
    this.queue = [];
    this.current = null;
  }

  tick(dt, ctx = null) {
    while (true) {
      if (!this.current) {
        this.current = this.queue.shift() || null;
        if (!this.current) return { status: TASK_STATUS.SUCCESS, intent: null };
        if (typeof this.current.start === 'function') {
          this.current.start(ctx);
        }
      }

      const res = typeof this.current.tick === 'function'
        ? this.current.tick(dt, ctx)
        : { status: TASK_STATUS.FAILED, intent: null };

      if (res?.status === TASK_STATUS.SUCCESS) {
        this.current = null;
        if (res?.intent && res.intent.type === 'interact') {
          return res;
        }
        continue;
      }

      return res || { status: TASK_STATUS.FAILED, intent: null };
    }
  }
}

