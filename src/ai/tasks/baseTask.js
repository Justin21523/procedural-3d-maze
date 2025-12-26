import { TASK_STATUS } from './taskStatus.js';

export class BaseTask {
  constructor(name = 'task') {
    this.name = String(name || 'task');
    this.started = false;
    this.finished = false;
    this.result = null;
  }

  start(ctx = null) {
    void ctx;
    this.started = true;
  }

  tick(dt, ctx = null) {
    void dt;
    void ctx;
    this.finished = true;
    this.result = { status: TASK_STATUS.SUCCESS };
    return this.result;
  }
}

