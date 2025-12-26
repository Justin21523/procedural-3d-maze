import { TASK_STATUS } from './taskStatus.js';
import { MoveToTask } from './moveToTask.js';

export class InteractTask {
  constructor(interactableId, targetGrid, options = {}) {
    this.name = 'interact';
    this.interactableId = String(interactableId || '').trim();
    this.moveTask = new MoveToTask(targetGrid, { threshold: options.threshold ?? 0 });
    this.started = false;
    this.done = false;
  }

  start(ctx = null) {
    this.started = true;
    this.moveTask.start(ctx);
  }

  tick(dt, ctx = null) {
    if (this.done) return { status: TASK_STATUS.SUCCESS, intent: { type: 'done' } };
    const moveRes = this.moveTask.tick(dt, ctx);
    if (moveRes.status === TASK_STATUS.FAILED) return moveRes;
    if (moveRes.status === TASK_STATUS.RUNNING) return moveRes;

    // Arrived: request an interaction. Movement engine decides how to aim; InteractableSystem can
    // consume a generic "interact" flag.
    this.done = true;
    return {
      status: TASK_STATUS.SUCCESS,
      intent: { type: 'interact', id: this.interactableId }
    };
  }
}

