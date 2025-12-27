import { EVENTS } from './events.js';

function normalizeItemId(itemId) {
  const id = String(itemId || '').trim();
  return id ? id : null;
}

function toCount(value, fallback = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

export class InventorySystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.gameState = options.gameState || null;

    this.unsubs = [];
    this.bindEvents();
  }

  setRefs({ eventBus, gameState } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (gameState) this.gameState = gameState;
    this.bindEvents();
  }

  dispose() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
  }

  emitUpdated(actorKind = 'player') {
    const snapshot = this.gameState?.getInventorySnapshot?.() || {};
    this.eventBus?.emit?.(EVENTS.INVENTORY_UPDATED, {
      actorKind,
      items: snapshot
    });
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];

    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(
      bus.on(EVENTS.INVENTORY_GIVE_ITEM, (payload) => {
        const itemId = normalizeItemId(payload?.itemId);
        if (!itemId) return;
        const count = toCount(payload?.count, 1);
        if (count <= 0) return;

        const actorKind = payload?.actorKind || 'player';
        const next = this.gameState?.giveItem?.(itemId, count) ?? null;
        payload.result = { ok: true, itemId, count, next };
        this.emitUpdated(actorKind);
      })
    );

    this.unsubs.push(
      bus.on(EVENTS.INVENTORY_CONSUME_ITEM, (payload) => {
        const itemId = normalizeItemId(payload?.itemId);
        if (!itemId) return;
        const count = toCount(payload?.count, 1);
        if (count <= 0) return;

        const actorKind = payload?.actorKind || 'player';
        const res = this.gameState?.consumeItem?.(itemId, count) || { ok: false, itemId, consumed: 0 };
        payload.result = res;
        if (res.ok) {
          this.emitUpdated(actorKind);
        }
      })
    );

    this.unsubs.push(
      bus.on(EVENTS.INVENTORY_QUERY_ITEM, (payload) => {
        const itemId = normalizeItemId(payload?.itemId);
        if (!itemId) return;

        const count = this.gameState?.getItemCount?.(itemId) ?? 0;
        payload.result = { ok: true, itemId, count };
      })
    );
  }
}

