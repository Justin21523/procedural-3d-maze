function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getPoolKey(models) {
  if (!Array.isArray(models) || models.length === 0) return '0';
  const head = models.slice(0, 3).join('|');
  const tail = models.slice(-3).join('|');
  return `${models.length}|${head}|${tail}`;
}

export class EnemyModelSelector {
  constructor(options = {}) {
    this.manifestUrl = options.manifestUrl || '/models/manifest.json';
    this.manifest = null;
    this.manifestPromise = null;

    this.bag = [];
    this.bagKey = null;
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    if (this.manifestPromise) return this.manifestPromise;

    this.manifestPromise = (async () => {
      try {
        const res = await fetch(this.manifestUrl, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const models = Array.isArray(json) ? json : json?.models;
        const list = Array.isArray(models) ? models.filter(p => typeof p === 'string') : [];
        this.manifest = list;
        return list;
      } catch (err) {
        console.warn('⚠️ Could not load /models/manifest.json, falling back to sprites:', err?.message || err);
        this.manifest = [];
        return [];
      } finally {
        this.manifestPromise = null;
      }
    })();

    return this.manifestPromise;
  }

  pickModelPool(allModels) {
    if (!Array.isArray(allModels) || allModels.length === 0) return [];

    // Prefer models inside subfolders: /models/<Folder>/<file>
    const inSubfolders = allModels.filter((p) => {
      if (typeof p !== 'string') return false;
      return p.split('/').length >= 4;
    });

    // Prioritize .dae in subfolders (common for enemy characters)
    const daeInSubfolders = inSubfolders.filter((p) => p.toLowerCase().endsWith('.dae'));
    if (daeInSubfolders.length > 0) {
      return daeInSubfolders;
    }

    const preferred = inSubfolders.length > 0 ? inSubfolders : allModels;

    // Basic safety filter to avoid obvious non-enemy assets in the pool.
    const denyKeywords = [
      'pool',
      'rifle',
      'gun',
      'pistol',
      'weapon',
      'bullet',
      'projectile',
      'ammo',
      'effect',
      'vfx',
      'fx',
    ];

    const filtered = preferred.filter((p) => {
      const lower = p.toLowerCase();
      return !denyKeywords.some((k) => lower.includes(k));
    });

    return filtered.length > 0 ? filtered : preferred;
  }

  pickRandom(models) {
    if (!Array.isArray(models) || models.length === 0) return null;
    return models[Math.floor(Math.random() * models.length)];
  }

  pickFromBag(models) {
    if (!Array.isArray(models) || models.length === 0) return null;

    const key = getPoolKey(models);
    if (this.bagKey !== key) {
      this.bagKey = key;
      this.bag = [];
    }

    if (!this.bag || this.bag.length === 0) {
      this.bag = shuffleInPlace([...models]);
    }

    return this.bag.pop() || null;
  }

  clear() {
    this.manifest = null;
    this.manifestPromise = null;
    this.bag = [];
    this.bagKey = null;
  }
}

