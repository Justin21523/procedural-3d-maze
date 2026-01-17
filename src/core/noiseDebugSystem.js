import { EVENTS } from './events.js';

export class NoiseDebugSystem {
  constructor({ eventBus, diagnostics }) {
    this.eventBus = eventBus;
    this.diagnostics = diagnostics;
    this._unsub = null;
  }

  start() {
    if (!this.eventBus?.on || this._unsub) return;
    const handler = (payload) => {
      this.diagnostics?.recordNoise?.(payload || null);
    };
    const unsub = this.eventBus.on(EVENTS.NOISE_REQUESTED, handler);
    this._unsub = typeof unsub === 'function' ? unsub : null;
  }

  stop() {
    if (this._unsub) this._unsub();
    this._unsub = null;
  }
}

