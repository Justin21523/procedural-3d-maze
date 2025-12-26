const DEG2RAD = Math.PI / 180;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return value;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

function normalizeRotationInput(meta) {
  if (!meta) return null;
  const rad = isObject(meta.correctionRotationRad) ? meta.correctionRotationRad : null;
  const deg = isObject(meta.correctionRotationDeg) ? meta.correctionRotationDeg : null;

  if (rad) {
    return {
      x: toNumber(rad.x),
      y: toNumber(rad.y),
      z: toNumber(rad.z)
    };
  }

  if (deg) {
    return {
      x: toNumber(deg.x) !== null ? toNumber(deg.x) * DEG2RAD : null,
      y: toNumber(deg.y) !== null ? toNumber(deg.y) * DEG2RAD : null,
      z: toNumber(deg.z) !== null ? toNumber(deg.z) * DEG2RAD : null
    };
  }

  return null;
}

function normalizeOffsetInput(meta) {
  if (!meta) return null;
  const off = isObject(meta.correctionOffset) ? meta.correctionOffset : null;
  if (!off) return null;
  return {
    x: toNumber(off.x),
    y: toNumber(off.y),
    z: toNumber(off.z)
  };
}

function mergeShallow(base, override) {
  if (!isObject(base)) base = {};
  if (!isObject(override)) return base;
  return { ...base, ...override };
}

function mergeMeta(base, override) {
  if (!isObject(base)) base = null;
  if (!isObject(override)) return base;

  const next = base ? { ...base } : {};

  if (typeof override.aiType === 'string') next.aiType = override.aiType;

  const scaleMultiplier = toNumber(override.scaleMultiplier);
  if (scaleMultiplier !== null) next.scaleMultiplier = scaleMultiplier;

  const groundOffset = toNumber(override.groundOffset);
  if (groundOffset !== null) next.groundOffset = groundOffset;

  const hitRadius = toNumber(override.hitRadius);
  if (hitRadius !== null) next.hitRadius = hitRadius;

  const rot = normalizeRotationInput(override);
  if (rot) next.correctionRotationRad = rot;

  const offset = normalizeOffsetInput(override);
  if (offset) next.correctionOffset = offset;

  next.stats = mergeShallow(next.stats, override.stats);
  next.behavior = mergeShallow(next.behavior, override.behavior);
  next.combat = mergeShallow(next.combat, override.combat);
  next.animations = mergeShallow(next.animations, override.animations);
  next.appearance = mergeShallow(next.appearance, override.appearance);
  next.brain = mergeShallow(next.brain, override.brain);

  return Object.keys(next).length > 0 ? next : null;
}

function sanitizeNumberField(obj, key, options = {}) {
  if (!isObject(obj)) return;
  if (!(key in obj)) return;

  const raw = obj[key];
  const n = toNumber(raw);
  if (n === null) {
    delete obj[key];
    return;
  }

  const min = options.min;
  const max = options.max;
  const clamped = clampNumber(n, min, max);
  if (options.positive && clamped <= 0) {
    delete obj[key];
    return;
  }

  obj[key] = clamped;
}

function sanitizeRotation(meta) {
  if (!isObject(meta?.correctionRotationRad)) return;
  const rot = meta.correctionRotationRad;
  const next = {
    x: toNumber(rot.x),
    y: toNumber(rot.y),
    z: toNumber(rot.z)
  };
  if (next.x === null && next.y === null && next.z === null) {
    delete meta.correctionRotationRad;
    return;
  }
  meta.correctionRotationRad = next;
}

function sanitizeOffset(meta) {
  if (!isObject(meta?.correctionOffset)) return;
  const off = meta.correctionOffset;
  const next = {
    x: toNumber(off.x),
    y: toNumber(off.y),
    z: toNumber(off.z)
  };
  if (next.x === null && next.y === null && next.z === null) {
    delete meta.correctionOffset;
    return;
  }
  // Keep offsets within a reasonable range (world units).
  for (const key of ['x', 'y', 'z']) {
    if (next[key] === null) continue;
    next[key] = clampNumber(next[key], -50, 50);
  }
  meta.correctionOffset = next;
}

function sanitizeSection(meta, sectionKey, spec = {}) {
  if (!isObject(meta)) return;
  if (!(sectionKey in meta)) return;
  const section = meta[sectionKey];
  if (!isObject(section)) {
    delete meta[sectionKey];
    return;
  }

  const next = { ...section };
  for (const [key, opts] of Object.entries(spec)) {
    sanitizeNumberField(next, key, opts);
  }
  meta[sectionKey] = next;
}

function sanitizeCombatRanged(combat) {
  if (!isObject(combat)) return;
  if (!('ranged' in combat)) return;

  const ranged = combat.ranged;
  if (!isObject(ranged)) {
    delete combat.ranged;
    return;
  }

  const next = { ...ranged };

  if ('enabled' in next && typeof next.enabled !== 'boolean') {
    delete next.enabled;
  }
  if ('kind' in next && typeof next.kind !== 'string') {
    delete next.kind;
  }

  sanitizeNumberField(next, 'damage', { min: 0, max: 99999 });
  sanitizeNumberField(next, 'cooldown', { min: 0.05, max: 60 });
  sanitizeNumberField(next, 'shotInterval', { min: 0.05, max: 60 });
  sanitizeNumberField(next, 'burstRest', { min: 0, max: 60 });
  sanitizeNumberField(next, 'burstRestSeconds', { min: 0, max: 60 });
  sanitizeNumberField(next, 'reloadSeconds', { min: 0.1, max: 60 });
  sanitizeNumberField(next, 'speed', { min: 1, max: 999 });
  sanitizeNumberField(next, 'lifetime', { min: 0.05, max: 60 });

  sanitizeNumberField(next, 'range', { min: 0, max: 999 });
  sanitizeNumberField(next, 'minRange', { min: 0, max: 999 });
  if (Number.isFinite(next.range) && Number.isFinite(next.minRange) && next.range < next.minRange) {
    const tmp = next.range;
    next.range = next.minRange;
    next.minRange = tmp;
  }

  sanitizeNumberField(next, 'spread', { min: 0, max: 1 });
  sanitizeNumberField(next, 'fireChance', { min: 0, max: 1 });

  sanitizeNumberField(next, 'fireAlignDeg', { min: 1, max: 90 });
  sanitizeNumberField(next, 'turnSpeed', { min: 0.1, max: 50 });
  sanitizeNumberField(next, 'burstMin', { min: 1, max: 99, positive: true });
  sanitizeNumberField(next, 'burstMax', { min: 1, max: 99, positive: true });
  if (Number.isFinite(next.burstMin) && Number.isFinite(next.burstMax) && next.burstMax < next.burstMin) {
    next.burstMax = next.burstMin;
  }

  sanitizeNumberField(next, 'magSize', { min: 1, max: 999, positive: true });

  // Keep `color` flexible: allow number or string (handled downstream).
  if ('color' in next && !(typeof next.color === 'number' || typeof next.color === 'string')) {
    delete next.color;
  }
  if ('explosionColor' in next && !(typeof next.explosionColor === 'number' || typeof next.explosionColor === 'string')) {
    delete next.explosionColor;
  }

  combat.ranged = next;
}

function sanitizeMeta(meta) {
  if (!isObject(meta)) return null;
  const next = { ...meta };

  if ('aiType' in next && typeof next.aiType !== 'string') {
    delete next.aiType;
  }

  sanitizeNumberField(next, 'scaleMultiplier', { min: 0.01, max: 100, positive: true });
  sanitizeNumberField(next, 'groundOffset', { min: -10, max: 10 });
  sanitizeNumberField(next, 'hitRadius', { min: 0.05, max: 20, positive: true });
  sanitizeRotation(next);
  sanitizeOffset(next);

  sanitizeSection(next, 'stats', {
    scale: { min: 0.01, max: 20, positive: true },
    speedFactor: { min: 0.05, max: 10, positive: true },
    health: { min: 1, max: 99999, positive: true },
    visionRange: { min: 0, max: 999 },
    visionFOV: { min: 0, max: Math.PI * 2 },
    hearingRange: { min: 0, max: 999 },
    groundOffset: { min: -10, max: 10 },
    hitRadius: { min: 0.05, max: 20, positive: true }
  });

  sanitizeSection(next, 'behavior', {
    chaseRange: { min: 0, max: 999 },
    chaseTimeout: { min: 0, max: 120 },
    maxChaseDuration: { min: 0, max: 120 },
    roamRadius: { min: 0, max: 999 },
    searchRadius: { min: 0, max: 999 },
    homeRadius: { min: 0, max: 999 },
    followDistance: { min: 0, max: 999 },
    memoryDuration: { min: 0, max: 120 },
    greetDistance: { min: 0, max: 999 },
    tooCloseDistance: { min: 0, max: 999 },
    idealDistance: { min: 0, max: 999 },
    slowDuration: { min: 0, max: 120 },
    sprintDuration: { min: 0, max: 120 },
    sprintMultiplier: { min: 0, max: 20 },
    teleportCooldown: { min: 0, max: 120 },
    teleportTriggerDistance: { min: 0, max: 999 },
    minTeleportDist: { min: 0, max: 999 },
    maxTeleportDist: { min: 0, max: 999 }
  });

  sanitizeSection(next, 'combat', {
    contactDamage: { min: 0, max: 99999 },
    hitStunSeconds: { min: 0, max: 10 },
    deathDelay: { min: 0, max: 10 },
    deathExplosionRadius: { min: 0, max: 999 },
    deathExplosionDamage: { min: 0, max: 99999 }
  });
  sanitizeCombatRanged(next.combat);

  // Keep `animations`, `appearance`, and `brain` as-is for flexibility; they are merged shallowly.
  // (They can still be overridden by built-in catalog entries or per-folder meta files.)

  for (const key of ['stats', 'behavior', 'combat', 'animations', 'appearance', 'brain']) {
    if (isObject(next[key]) && Object.keys(next[key]).length === 0) {
      delete next[key];
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function getEnemyFolderFromModelPath(modelPath) {
  const p = String(modelPath || '');
  if (!p) return null;
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const modelsIndex = parts.indexOf('models');
  if (modelsIndex === -1) return null;
  const folder = parts[modelsIndex + 1] || null;
  const file = parts[modelsIndex + 2] || null;
  if (!folder) return null;
  if (!file) return null;
  return folder;
}

export function getEnemyBaseName(modelPath) {
  const p = String(modelPath || '');
  const parts = p.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const file = parts[parts.length - 1];
  if (!file) return null;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

export function getCandidateMetaUrls(modelPath) {
  const urls = [];
  const folder = getEnemyFolderFromModelPath(modelPath);
  if (folder) {
    urls.push(`/models/${folder}/meta.json`);
  } else {
    const base = getEnemyBaseName(modelPath);
    if (base) urls.push(`/models/${base}.meta.json`);
  }
  return urls;
}

/**
 * EnemyCatalog
 * - Loads optional per-model metadata from `public/models/<enemy>/meta.json`.
 * - Falls back to an in-code catalog (optional).
 *
 * Supported meta fields (top-level):
 * - `aiType`: string (overrides monster aiType for this model)
 * - `scaleMultiplier`: number (multiplies typeConfig.stats.scale)
 * - `groundOffset`: number (sets typeConfig.stats.groundOffset)
 * - `hitRadius`: number (sets typeConfig.stats.hitRadius)
 * - `correctionOffset`: {x,y,z} applied to `__monsterInner.position` (offset from imported base)
 * - `correctionRotationDeg` or `correctionRotationRad`: {x,y,z} applied to `__monsterCorrection`
 * - `stats`, `behavior`, `combat`, `animations`, `appearance`: shallow-merged into typeConfig
 * - `brain`: extra brain config merged into MonsterManager brainConfig
 *
 * Nested meta fields validated (best-effort):
 * - `combat.ranged`: { enabled, kind, range, minRange, damage, cooldown/shotInterval, spread, fireChance, magSize, reloadSeconds, burstMin/burstMax, burstRestSeconds, fireAlignDeg, turnSpeed }
 */
export class EnemyCatalog {
  constructor(options = {}) {
    this.builtinByFolder = options.builtinByFolder || null;
    this.builtinByPath = options.builtinByPath || null;
    this.metaCache = new Map(); // modelPath -> meta|null
    this.metaPromises = new Map();
  }

  async getMeta(modelPath) {
    const key = String(modelPath || '');
    if (!key) return null;

    if (this.metaCache.has(key)) return this.metaCache.get(key);
    if (this.metaPromises.has(key)) return this.metaPromises.get(key);

    const promise = this.loadMeta(key)
      .then((meta) => {
        this.metaPromises.delete(key);
        this.metaCache.set(key, meta);
        return meta;
      })
      .catch((err) => {
        console.warn('⚠️ Enemy meta load failed:', key, err?.message || err);
        this.metaPromises.delete(key);
        this.metaCache.set(key, null);
        return null;
      });

    this.metaPromises.set(key, promise);
    return promise;
  }

  async loadMeta(modelPath) {
    let meta = null;
    const folder = getEnemyFolderFromModelPath(modelPath);

    if (folder && this.builtinByFolder && this.builtinByFolder[folder]) {
      meta = mergeMeta(meta, this.builtinByFolder[folder]);
    }
    if (this.builtinByPath && this.builtinByPath[modelPath]) {
      meta = mergeMeta(meta, this.builtinByPath[modelPath]);
    }

    const urls = getCandidateMetaUrls(modelPath);
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = await res.json();
        meta = mergeMeta(meta, json);
        break;
      } catch (err) {
        void err;
      }
    }

    return sanitizeMeta(meta);
  }
}

export function applyEnemyModelMeta(model, meta) {
  if (!model || !meta) return;
  if (!model.getObjectByName) return;

  const correction = model.getObjectByName('__monsterCorrection') || null;
  const inner = model.getObjectByName('__monsterInner') || null;

  const rot = meta.correctionRotationRad || null;
  if (rot && correction) {
    const rx = Number.isFinite(rot.x) ? rot.x : correction.rotation.x;
    const ry = Number.isFinite(rot.y) ? rot.y : correction.rotation.y;
    const rz = Number.isFinite(rot.z) ? rot.z : correction.rotation.z;
    correction.rotation.set(rx, ry, rz);
  }

  const off = meta.correctionOffset || null;
  if (off && inner) {
    const base = Array.isArray(inner.userData?.__basePosition) ? inner.userData.__basePosition : null;
    const baseX = Number.isFinite(base?.[0]) ? base[0] : inner.position.x;
    const baseY = Number.isFinite(base?.[1]) ? base[1] : inner.position.y;
    const baseZ = Number.isFinite(base?.[2]) ? base[2] : inner.position.z;

    const px = Number.isFinite(off.x) ? baseX + off.x : baseX;
    const py = Number.isFinite(off.y) ? baseY + off.y : baseY;
    const pz = Number.isFinite(off.z) ? baseZ + off.z : baseZ;
    inner.position.set(px, py, pz);
  }
}

export function applyEnemyMetaToTypeConfig(typeConfig, meta) {
  if (!typeConfig || !meta) return typeConfig;

  if (typeof meta.aiType === 'string') {
    typeConfig.aiType = meta.aiType;
  }

  typeConfig.stats = typeConfig.stats || {};
  typeConfig.behavior = typeConfig.behavior || {};
  typeConfig.combat = typeConfig.combat || {};
  typeConfig.animations = typeConfig.animations || {};
  typeConfig.appearance = typeConfig.appearance || {};
  typeConfig.brain = typeConfig.brain || {};

  const scaleMultiplier = toNumber(meta.scaleMultiplier);
  if (scaleMultiplier !== null) {
    const base = Number.isFinite(typeConfig.stats.scale) ? typeConfig.stats.scale : 1;
    typeConfig.stats.scale = base * scaleMultiplier;
  }

  const groundOffset = toNumber(meta.groundOffset);
  if (groundOffset !== null) {
    typeConfig.stats.groundOffset = groundOffset;
  }

  const hitRadius = toNumber(meta.hitRadius);
  if (hitRadius !== null) {
    typeConfig.stats.hitRadius = hitRadius;
  }

  if (isObject(meta.stats)) {
    typeConfig.stats = { ...typeConfig.stats, ...meta.stats };
  }
  if (isObject(meta.behavior)) {
    typeConfig.behavior = { ...typeConfig.behavior, ...meta.behavior };
  }
  if (isObject(meta.combat)) {
    typeConfig.combat = { ...typeConfig.combat, ...meta.combat };
  }
  if (isObject(meta.animations)) {
    typeConfig.animations = { ...typeConfig.animations, ...meta.animations };
  }
  if (isObject(meta.appearance)) {
    typeConfig.appearance = { ...typeConfig.appearance, ...meta.appearance };
  }
  if (isObject(meta.brain)) {
    typeConfig.brain = { ...typeConfig.brain, ...meta.brain };
  }

  return typeConfig;
}
