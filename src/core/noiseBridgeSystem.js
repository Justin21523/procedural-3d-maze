import { EVENTS } from './events.js';

function isVec3(v) {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

function normalizeKind(kind) {
  const k = String(kind || '').trim();
  return k ? k : 'noise';
}

export class NoiseBridgeSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.monsterManager = options.monsterManager || null;
    this.unsubscribers = [];
    this.bindEvents();
  }

  setRefs({ eventBus, monsterManager } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (monsterManager) this.monsterManager = monsterManager;
    this.bindEvents();
  }

  bindEvents() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.NOISE_REQUESTED, (payload) => {
        this.onNoiseRequested(payload);
      })
    );
  }

  onNoiseRequested(payload) {
    const mm = this.monsterManager;
    if (!mm?.registerNoise) return;

    const pos = payload?.position || payload?.worldPosition || payload?.pos || null;
    if (!pos) return;

    const position = isVec3(pos)
      ? pos
      : { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 };

    const entry = mm.registerNoise(position, {
      kind: normalizeKind(payload?.kind),
      radius: payload?.radius,
      ttl: payload?.ttl,
      strength: payload?.strength,
      source: payload?.source || null,
    });

    if (entry) {
      this.eventBus?.emit?.(EVENTS.NOISE_EMITTED, entry);
    }
  }

  dispose() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];
  }
}

