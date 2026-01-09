const DEG2RAD = Math.PI / 180;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneJson(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  const n = toNumber(value);
  if (n === null) return null;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return value;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

function clamp01(value) {
  return clampNumber(value, 0, 1);
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

function getStudioPathKey(path) {
  if (!Array.isArray(path)) return '';
  return path
    .map((seg) => {
      const i = isObject(seg) ? toInt(seg.i) : null;
      return Number.isFinite(i) && i !== null ? String(i) : 'x';
    })
    .join('.');
}

function sanitizeStudioPath(path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  const cleaned = [];
  for (const seg of path) {
    if (!isObject(seg)) return null;
    const i = toInt(seg.i);
    if (!Number.isFinite(i) || i === null || i < 0 || i > 100000) return null;
    const name = typeof seg.name === 'string' ? seg.name.slice(0, 200) : null;
    cleaned.push(name ? { i, name } : { i });
  }
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeStudioTransform(transform) {
  if (!isObject(transform)) return null;
  const next = {};

  const position = Array.isArray(transform.position) ? transform.position : null;
  if (position && position.length === 3) {
    const x = toNumber(position[0]);
    const y = toNumber(position[1]);
    const z = toNumber(position[2]);
    if (x !== null && y !== null && z !== null) {
      next.position = [
        clampNumber(x, -1e4, 1e4),
        clampNumber(y, -1e4, 1e4),
        clampNumber(z, -1e4, 1e4)
      ];
    }
  }

  const quaternion = Array.isArray(transform.quaternion) ? transform.quaternion : null;
  if (quaternion && quaternion.length === 4) {
    const x = toNumber(quaternion[0]);
    const y = toNumber(quaternion[1]);
    const z = toNumber(quaternion[2]);
    const w = toNumber(quaternion[3]);
    if (x !== null && y !== null && z !== null && w !== null) {
      next.quaternion = [
        clampNumber(x, -1, 1),
        clampNumber(y, -1, 1),
        clampNumber(z, -1, 1),
        clampNumber(w, -1, 1)
      ];
    }
  }

  const scale = Array.isArray(transform.scale) ? transform.scale : null;
  if (scale && scale.length === 3) {
    const x = toNumber(scale[0]);
    const y = toNumber(scale[1]);
    const z = toNumber(scale[2]);
    if (x !== null && y !== null && z !== null) {
      next.scale = [
        clampNumber(Math.max(0.001, x), 0.001, 1e4),
        clampNumber(Math.max(0.001, y), 0.001, 1e4),
        clampNumber(Math.max(0.001, z), 0.001, 1e4)
      ];
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

function sanitizeStudioStandardMaterial(standard) {
  if (!isObject(standard)) return null;
  const next = {};

  if (typeof standard.color === 'string') {
    const c = standard.color.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(c)) next.color = c;
  }

  const metalness = toNumber(standard.metalness);
  if (metalness !== null) next.metalness = clamp01(metalness);

  const roughness = toNumber(standard.roughness);
  if (roughness !== null) next.roughness = clamp01(roughness);

  return Object.keys(next).length > 0 ? next : null;
}

function sanitizeStudio(meta) {
  if (!isObject(meta)) return null;

  const version = toInt(meta.version);
  if (version !== 1) return null;

  const objectsIn = Array.isArray(meta.objects) ? meta.objects : [];
  const materialsIn = Array.isArray(meta.materials) ? meta.materials : [];

  const objectsByKey = new Map();
  for (const entry of objectsIn) {
    if (!isObject(entry)) continue;
    const path = sanitizeStudioPath(entry.path);
    if (!path) continue;
    const key = getStudioPathKey(path);
    if (!key) continue;

    const next = { path };
    if (typeof entry.visible === 'boolean') next.visible = entry.visible;
    const transform = sanitizeStudioTransform(entry.transform);
    if (transform) next.transform = transform;

    if (Object.keys(next).length > 1) {
      objectsByKey.set(key, next);
    }
  }

  const materialsByKey = new Map();
  for (const entry of materialsIn) {
    if (!isObject(entry)) continue;
    const path = sanitizeStudioPath(entry.path);
    if (!path) continue;
    const slot = toInt(entry.slot);
    if (!Number.isFinite(slot) || slot === null || slot < 0 || slot > 256) continue;
    const standard = sanitizeStudioStandardMaterial(entry.standard);
    if (!standard) continue;
    const key = `${getStudioPathKey(path)}|${slot}`;
    materialsByKey.set(key, { path, slot, standard });
  }

  const objects = Array.from(objectsByKey.values());
  const materials = Array.from(materialsByKey.values());

  if (objects.length === 0 && materials.length === 0) return null;
  return { version: 1, objects, materials };
}

function mergeStudio(baseStudio, overrideStudio) {
  const base = sanitizeStudio(baseStudio);
  const override = sanitizeStudio(overrideStudio);
  if (!base && !override) return null;
  if (!base) return override ? deepCloneJson(override) : null;
  if (!override) return base ? deepCloneJson(base) : null;

  const objectsByKey = new Map();
  for (const entry of base.objects || []) {
    const key = getStudioPathKey(entry.path);
    if (key) objectsByKey.set(key, deepCloneJson(entry));
  }
  for (const entry of override.objects || []) {
    const key = getStudioPathKey(entry.path);
    if (key) objectsByKey.set(key, deepCloneJson(entry));
  }

  const materialsByKey = new Map();
  for (const entry of base.materials || []) {
    const key = `${getStudioPathKey(entry.path)}|${entry.slot}`;
    if (key) materialsByKey.set(key, deepCloneJson(entry));
  }
  for (const entry of override.materials || []) {
    const key = `${getStudioPathKey(entry.path)}|${entry.slot}`;
    if (key) materialsByKey.set(key, deepCloneJson(entry));
  }

  const merged = {
    version: 1,
    objects: Array.from(objectsByKey.values()),
    materials: Array.from(materialsByKey.values())
  };

  return merged.objects.length === 0 && merged.materials.length === 0 ? null : merged;
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

  const studio = mergeStudio(next.studio, override.studio);
  if (studio) next.studio = studio;

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
  if ('studio' in next) {
    const studio = sanitizeStudio(next.studio);
    if (studio) next.studio = studio;
    else delete next.studio;
  }

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

export function findEnemyModelObjectByStudioPath(root, path) {
  if (!root || !Array.isArray(path) || path.length === 0) return null;
  let current = root;
  for (const seg of path) {
    const i = isObject(seg) ? toInt(seg.i) : null;
    if (i === null || !Number.isFinite(i) || i < 0) return null;
    const children = current?.children;
    if (!Array.isArray(children) || children.length === 0) return null;

    let next = children[i] || null;
    const expectedName = typeof seg.name === 'string' ? seg.name : null;
    if (expectedName && next && next.name !== expectedName) {
      // Fallback to name match if indices shifted.
      next = children.find((c) => c && c.name === expectedName) || next;
    }
    if (!next) return null;
    current = next;
  }
  return current || null;
}

function applyStudioMeta(model, studio) {
  const root = model;
  const clean = sanitizeStudio(studio);
  if (!root || !clean) return;

  for (const entry of clean.objects || []) {
    const obj = findEnemyModelObjectByStudioPath(root, entry.path);
    if (!obj) continue;
    if (typeof entry.visible === 'boolean') {
      obj.visible = entry.visible;
    }
    const t = entry.transform || null;
    if (t && isObject(t)) {
      if (Array.isArray(t.position) && t.position.length === 3) {
        obj.position.set(t.position[0], t.position[1], t.position[2]);
      }
      if (Array.isArray(t.quaternion) && t.quaternion.length === 4) {
        obj.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
      }
      if (Array.isArray(t.scale) && t.scale.length === 3) {
        obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
      }
      obj.updateMatrixWorld?.(true);
    }
  }

  for (const entry of clean.materials || []) {
    const obj = findEnemyModelObjectByStudioPath(root, entry.path);
    if (!obj) continue;
    const mesh = obj && (obj.isMesh || obj.isSkinnedMesh) ? obj : null;
    if (!mesh) continue;
    const mat = mesh.material;
    const slot = entry.slot;

    let material = null;
    if (Array.isArray(mat)) {
      material = mat[slot] || null;
    } else if (slot === 0) {
      material = mat || null;
    }
    if (!material) continue;
    if (!material.isMeshStandardMaterial) continue;

    const standard = entry.standard || null;
    if (!standard) continue;
    if (typeof standard.color === 'string') {
      material.color?.set?.(standard.color);
    }
    if (Number.isFinite(standard.metalness)) {
      material.metalness = clamp01(standard.metalness);
    }
    if (Number.isFinite(standard.roughness)) {
      material.roughness = clamp01(standard.roughness);
    }
    material.needsUpdate = true;
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

  if (meta.studio) {
    applyStudioMeta(model, meta.studio);
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
