import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const modelsDir = path.resolve(rootDir, 'public/models');
const manifestFile = path.join(modelsDir, 'manifest.json');
const supportedExts = new Set(['.dae', '.glb', '.gltf']);

function normalizeUrlPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isSupportedModelFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return supportedExts.has(ext);
}

function scanModelUrls() {
  const results = [];
  if (!fs.existsSync(modelsDir)) return results;

  const stack = [modelsDir];
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

      if (path.resolve(fullPath) === path.resolve(manifestFile)) continue;
      if (!isSupportedModelFile(fullPath)) continue;

      const rel = path.relative(modelsDir, fullPath);
      results.push(`/models/${normalizeUrlPath(rel)}`);
    }
  }

  results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return results;
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function shouldCreateMetaForModel(modelUrl) {
  const lower = String(modelUrl || '').toLowerCase();
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
    'fx'
  ];
  return !denyKeywords.some((k) => lower.includes(k));
}

function ensureMetaStubs(modelUrls, options = {}) {
  const created = [];
  const skipped = [];

  const includeRoot = options.includeRoot ?? false;

  for (const url of modelUrls) {
    if (!shouldCreateMetaForModel(url)) {
      skipped.push({ url, reason: 'denylist' });
      continue;
    }

    const rel = url.startsWith('/models/') ? url.slice('/models/'.length) : url;
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    // /models/<folder>/... -> public/models/<folder>/meta.json
    if (parts.length >= 2) {
      const folder = parts[0];
      const metaPath = path.join(modelsDir, folder, 'meta.json');
      if (!fs.existsSync(metaPath)) {
        writeJsonFile(metaPath, { scaleMultiplier: 1, groundOffset: 0.02 });
        created.push(metaPath);
      }
      continue;
    }

    // /models/<file> -> public/models/<base>.meta.json (optional)
    if (!includeRoot) continue;
    const file = parts[0];
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    if (!base) continue;
    const metaPath = path.join(modelsDir, `${base}.meta.json`);
    if (!fs.existsSync(metaPath)) {
      writeJsonFile(metaPath, { scaleMultiplier: 1, groundOffset: 0.02 });
      created.push(metaPath);
    }
  }

  return { created, skipped };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const includeRoot = args.has('--include-root-meta') || args.has('--includeRootMeta');

  if (!fs.existsSync(modelsDir)) {
    console.error(`❌ Missing directory: ${modelsDir}`);
    process.exitCode = 1;
    return;
  }

  const modelUrls = scanModelUrls();

  writeJsonFile(manifestFile, {
    generatedAt: new Date().toISOString(),
    models: modelUrls
  });

  const { created } = ensureMetaStubs(modelUrls, { includeRoot });

  console.log(`✅ Wrote manifest: ${path.relative(rootDir, manifestFile)}`);
  console.log(`📦 Models: ${modelUrls.length}`);
  console.log(`🧩 Meta stubs created: ${created.length}${includeRoot ? ' (including root *.meta.json)' : ''}`);
}

main();

