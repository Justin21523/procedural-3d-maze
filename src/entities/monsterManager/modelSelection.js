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
    this.manifestUrl = options.manifestUrl || '/models/enemy/manifest.json';
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
        console.warn(`⚠️ Could not load ${this.manifestUrl}, falling back to sprites:`, err?.message || err);
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

    // Prefer enemy models: /models/enemy/<Enemy>/<file>
    const enemyModels = allModels.filter((p) => {
      if (typeof p !== 'string') return false;
      return p.includes('/models/enemy/');
    });

    const candidates = enemyModels.length > 0 ? enemyModels : allModels;

    // Prefer models inside subfolders: /models/.../<file>
    const inSubfolders = candidates.filter((p) => {
      if (typeof p !== 'string') return false;
      return p.split('/').length >= 4;
    });

    const preferred = inSubfolders.length > 0 ? inSubfolders : candidates;

    // Prefer common model extensions (manifest can include other asset paths)
    const allowedExt = ['.glb', '.gltf', '.dae'];
    const modelFiles = preferred.filter((p) => {
      const lower = String(p).toLowerCase();
      return allowedExt.some((ext) => lower.endsWith(ext));
    });
    const pool = modelFiles.length > 0 ? modelFiles : preferred;

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

    const filtered = pool.filter((p) => {
      const lower = p.toLowerCase();
      return !denyKeywords.some((k) => lower.includes(k));
    });

    return filtered.length > 0 ? filtered : pool;
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
