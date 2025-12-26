export class EventBus {
  constructor() {
    this.listeners = new Map(); // eventName -> Set<fn>
  }

  on(eventName, handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const name = String(eventName || '');
    if (!name) return () => {};

    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(handler);
    return () => this.off(name, handler);
  }

  once(eventName, handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const name = String(eventName || '');
    if (!name) return () => {};

    const off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(eventName, handler) {
    const name = String(eventName || '');
    if (!name) return;
    const set = this.listeners.get(name);
    if (!set) return;

    set.delete(handler);
    if (set.size === 0) {
      this.listeners.delete(name);
    }
  }

  emit(eventName, payload) {
    const name = String(eventName || '');
    if (!name) return;
    const set = this.listeners.get(name);
    if (!set || set.size === 0) return;

    // Snapshot to avoid issues if listeners mutate subscriptions during emit.
    const handlers = Array.from(set);
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        console.warn(`⚠️ EventBus listener failed for "${name}":`, err?.message || err);
      }
    }
  }

  clear(eventName = null) {
    if (eventName === null || eventName === undefined) {
      this.listeners.clear();
      return;
    }
    const name = String(eventName || '');
    if (!name) return;
    this.listeners.delete(name);
  }
}

