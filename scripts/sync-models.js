import fs from 'node:fs';
import path from 'node:path';
import { createWeaponCatalog } from '../src/player/weaponCatalog.js';

const rootDir = process.cwd();
const modelsDir = path.resolve(rootDir, 'public/models');
const rootManifestFile = path.join(modelsDir, 'manifest.json');
const enemyDir = path.join(modelsDir, 'enemy');
const weaponDir = path.join(modelsDir, 'weapon');
const enemyManifestFile = path.join(enemyDir, 'manifest.json');
const weaponManifestFile = path.join(weaponDir, 'manifest.json');
const weaponMetaFile = path.join(weaponDir, 'meta.json');

const supportedExts = new Set(['.dae', '.glb', '.gltf']);
const textureExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function normalizeUrlPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isSupportedModelFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return supportedExts.has(ext);
}

function scanModelUrls(baseDir, urlPrefix) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;

  const stack = [baseDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (path.resolve(fullPath) === path.resolve(rootManifestFile)) continue;
      if (path.resolve(fullPath) === path.resolve(enemyManifestFile)) continue;
      if (path.resolve(fullPath) === path.resolve(weaponManifestFile)) continue;
      if (!isSupportedModelFile(fullPath)) continue;

      const rel = path.relative(baseDir, fullPath);
      results.push(`${urlPrefix}/${normalizeUrlPath(rel)}`);
    }
  }

  results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return results;
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    void err;
    return null;
  }
}

function pickPrimaryModelFile(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => isSupportedModelFile(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length === 0) return null;
  const dae = files.find((f) => f.toLowerCase().endsWith('.dae'));
  return dae || files[0];
}

function listTextureFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => textureExts.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function ensureEnemyManifests(options = {}) {
  const created = [];
  const updated = [];
  const skipped = [];

  const force = options.force ?? false;

  if (!fs.existsSync(enemyDir)) return { created, updated, skipped };
  const folders = fs
    .readdirSync(enemyDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const folder of folders) {
    const dirPath = path.join(enemyDir, folder);
    const manifestPath = path.join(dirPath, 'manifest.json');

    if (fs.existsSync(manifestPath) && !force) {
      skipped.push(manifestPath);
      continue;
    }

    const modelFile = pickPrimaryModelFile(dirPath);
    if (!modelFile) {
      skipped.push(manifestPath);
      continue;
    }

    const textureFiles = listTextureFiles(dirPath);
    const metaPath = path.join(dirPath, 'meta.json');
    const meta = readJsonIfExists(metaPath) || {};
    const defaults = {
      scaleMultiplier: 1,
      groundOffset: 0.02,
      stats: { hitRadius: 1 }
    };

    const payload = {
      schemaVersion: 1,
      id: folder,
      displayName: folder,
      modelFile,
      textureFiles,
      ...defaults,
      ...meta,
      stats: { ...(defaults.stats || {}), ...(meta.stats || {}) }
    };

    writeJsonFile(manifestPath, payload);
    if (fs.existsSync(manifestPath) && force) updated.push(manifestPath);
    else created.push(manifestPath);
  }

  return { created, updated, skipped };
}

function ensureWeaponMetaFile(weaponModelUrls) {
  if (!Array.isArray(weaponModelUrls)) return false;
  if (fs.existsSync(weaponMetaFile)) return false;

  const radToDeg = (n) => (Number(n) || 0) * (180 / Math.PI);
  const defaultView = {
    offset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1.0
  };

  let catalog = {};
  try {
    catalog = createWeaponCatalog() || {};
  } catch (err) {
    void err;
    catalog = {};
  }

  const viewByPath = {};
  for (const def of Object.values(catalog)) {
    if (!def || typeof def !== 'object') continue;
    const modelPath = typeof def.viewModelPath === 'string' ? def.viewModelPath : null;
    if (!modelPath) continue;
    viewByPath[modelPath] = def.view && typeof def.view === 'object' ? def.view : null;
  }

  const weapons = {};
  for (const modelPath of weaponModelUrls) {
    const view = viewByPath[modelPath] || defaultView;
    const rot = view?.rotation && typeof view.rotation === 'object' ? view.rotation : defaultView.rotation;
    const off = view?.offset && typeof view.offset === 'object' ? view.offset : defaultView.offset;
    weapons[modelPath] = {
      view: {
        offset: {
          x: Number(off.x) || 0,
          y: Number(off.y) || 0,
          z: Number(off.z) || 0
        },
        rotationDeg: {
          x: radToDeg(rot.x),
          y: radToDeg(rot.y),
          z: radToDeg(rot.z)
        },
        scale: Number.isFinite(Number(view?.scale)) ? Number(view.scale) : 1.0
      }
    };
  }

  writeJsonFile(weaponMetaFile, {
    schemaVersion: 1,
    weapons
  });

  return true;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const forceEnemy = args.has('--force-enemy') || args.has('--forceEnemy');

  if (!fs.existsSync(modelsDir)) {
    console.error(`❌ Missing directory: ${modelsDir}`);
    process.exitCode = 1;
    return;
  }

  const modelUrls = scanModelUrls(modelsDir, '/models');
  const enemyModelUrls = scanModelUrls(enemyDir, '/models/enemy');
  const weaponModelUrls = scanModelUrls(weaponDir, '/models/weapon');

  writeJsonFile(rootManifestFile, {
    generatedAt: new Date().toISOString(),
    models: modelUrls,
    enemyModels: enemyModelUrls,
    weaponModels: weaponModelUrls
  });

  writeJsonFile(enemyManifestFile, {
    generatedAt: new Date().toISOString(),
    models: enemyModelUrls
  });

  writeJsonFile(weaponManifestFile, {
    generatedAt: new Date().toISOString(),
    models: weaponModelUrls
  });

  const { created: enemyManifestsCreated, updated: enemyManifestsUpdated } = ensureEnemyManifests({ force: forceEnemy });
  const weaponMetaCreated = ensureWeaponMetaFile(weaponModelUrls);

  console.log(`✅ Wrote manifest: ${path.relative(rootDir, rootManifestFile)}`);
  console.log(`✅ Wrote enemy manifest: ${path.relative(rootDir, enemyManifestFile)}`);
  console.log(`✅ Wrote weapon manifest: ${path.relative(rootDir, weaponManifestFile)}`);
  console.log(`📦 Models: ${modelUrls.length} (enemy: ${enemyModelUrls.length}, weapon: ${weaponModelUrls.length})`);
  console.log(`👹 Enemy manifest files: +${enemyManifestsCreated.length}${forceEnemy ? ` (forced overwrite: ${enemyManifestsUpdated.length})` : ''}`);
  if (weaponMetaCreated) console.log(`🔫 Weapon meta file: +1`);
}

main();
