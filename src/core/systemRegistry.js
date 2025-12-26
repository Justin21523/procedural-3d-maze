function normalizeOrder(order) {
  return Number.isFinite(order) ? order : 0;
}

export class SystemRegistry {
  constructor() {
    this.systems = []; // [{ name, order, enabled, system }]
  }

  add(name, system, options = {}) {
    const entry = {
      name: String(name || ''),
      order: normalizeOrder(options.order),
      enabled: options.enabled !== false,
      system
    };

    this.systems.push(entry);
    this.systems.sort((a, b) => a.order - b.order);

    return () => this.remove(entry);
  }

  remove(nameOrEntryOrSystem) {
    const target = nameOrEntryOrSystem;
    const before = this.systems.length;

    this.systems = this.systems.filter((entry) => {
      if (!target) return true;
      if (target === entry) return false;
      if (target === entry.system) return false;
      if (typeof target === 'string' && entry.name === target) return false;
      return true;
    });

    return this.systems.length !== before;
  }

  setEnabled(name, enabled) {
    const key = String(name || '');
    for (const entry of this.systems) {
      if (entry.name === key) {
        entry.enabled = !!enabled;
      }
    }
  }

  update(dt, context = null) {
    for (const entry of this.systems) {
      if (!entry.enabled) continue;
      const system = entry.system;
      try {
        if (typeof system === 'function') {
          system(dt, context);
        } else if (system && typeof system.update === 'function') {
          system.update(dt, context);
        }
      } catch (err) {
        console.warn(`⚠️ System "${entry.name}" failed:`, err?.message || err);
      }
    }
  }

  reset(context = null) {
    for (const entry of this.systems) {
      const system = entry.system;
      if (!system) continue;
      if (typeof system.reset === 'function') {
        try {
          system.reset(context);
        } catch (err) {
          console.warn(`⚠️ System reset "${entry.name}" failed:`, err?.message || err);
        }
      }
    }
  }

  dispose() {
    for (const entry of this.systems) {
      const system = entry.system;
      if (!system) continue;
      if (typeof system.dispose === 'function') {
        try {
          system.dispose();
        } catch (err) {
          console.warn(`⚠️ System dispose "${entry.name}" failed:`, err?.message || err);
        }
      }
    }
    this.systems = [];
  }
}

