const STORAGE_KEY = 'p3dm_save_v1';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class SaveManager {
  constructor(options = {}) {
    this.storageKey = String(options.storageKey || STORAGE_KEY);
  }

  load() {
    const raw = safeJsonParse(localStorage.getItem(this.storageKey) || '');
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version !== 1) return null;
    return raw;
  }

  hasSave() {
    return !!this.load();
  }

  save(payload) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch {
      return false;
    }
  }
}

