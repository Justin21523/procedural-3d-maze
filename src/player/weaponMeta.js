const DEG2RAD = Math.PI / 180;

export const DEFAULT_WEAPON_META = Object.freeze({
  schemaVersion: 1,
  weapons: {}
});

export async function loadWeaponMetaFile(url = '/models/weapon/meta.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    return json;
  } catch (err) {
    void err;
    return null;
  }
}

function toNum(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function readVec3(obj, fallback = { x: 0, y: 0, z: 0 }) {
  const src = obj && typeof obj === 'object' ? obj : null;
  return {
    x: toNum(src?.x, fallback.x),
    y: toNum(src?.y, fallback.y),
    z: toNum(src?.z, fallback.z)
  };
}

export function normalizeWeaponViewMeta(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const view = entry.view && typeof entry.view === 'object' ? entry.view : entry;

  const offset = readVec3(view.offset, { x: 0, y: 0, z: 0 });

  const rotDeg = view.rotationDeg && typeof view.rotationDeg === 'object' ? view.rotationDeg : null;
  const rotRad = view.rotationRad && typeof view.rotationRad === 'object' ? view.rotationRad : null;
  const rot = view.rotation && typeof view.rotation === 'object' ? view.rotation : null;

  let rotation = { x: 0, y: 0, z: 0 };
  if (rotDeg) {
    rotation = {
      x: toNum(rotDeg.x, 0) * DEG2RAD,
      y: toNum(rotDeg.y, 0) * DEG2RAD,
      z: toNum(rotDeg.z, 0) * DEG2RAD
    };
  } else if (rotRad) {
    rotation = readVec3(rotRad, { x: 0, y: 0, z: 0 });
  } else if (rot) {
    // Back-compat: treat "rotation" as radians (weaponCatalog convention).
    rotation = readVec3(rot, { x: 0, y: 0, z: 0 });
  }

  const scale = toNum(view.scale, 1.0);

  return { offset, rotation, scale };
}

export function applyWeaponMetaToCatalog(weaponDefs, metaFile) {
  if (!weaponDefs || typeof weaponDefs !== 'object') return;
  const weapons = metaFile?.weapons && typeof metaFile.weapons === 'object' ? metaFile.weapons : null;
  if (!weapons) return;

  for (const def of Object.values(weaponDefs)) {
    if (!def || typeof def !== 'object') continue;
    const path = typeof def.viewModelPath === 'string' ? def.viewModelPath : null;
    if (!path) continue;

    const entry = weapons[path];
    const normalized = normalizeWeaponViewMeta(entry);
    if (!normalized) continue;

    def.view = {
      ...(def.view || {}),
      ...normalized
    };
  }
}

