import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const levelsDir = path.resolve(rootDir, 'public/levels');
const manifestPath = path.join(levelsDir, 'manifest.json');

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json at ${path.relative(rootDir, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  if (!isPlainObject(manifest)) {
    throw new Error(`manifest.json must be an object: ${path.relative(rootDir, manifestPath)}`);
  }
  const levels = Array.isArray(manifest.levels) ? manifest.levels : [];
  return { schema: String(manifest.schema || 'v1'), levels };
}

function main() {
  const manifest = loadManifest();
  const seen = new Set();
  const entries = [];
  const missing = [];
  const invalid = [];

  for (const raw of manifest.levels) {
    const file = String(raw || '').trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const filePath = path.join(levelsDir, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
      continue;
    }

    try {
      const level = readJson(filePath);
      const id = Math.round(Number(level?.id));
      entries.push({ file, id: Number.isFinite(id) ? id : null });
    } catch (err) {
      invalid.push({ file, error: err?.message || String(err) });
    }
  }

  entries.sort((a, b) => {
    const ai = Number.isFinite(a.id) ? a.id : 999999;
    const bi = Number.isFinite(b.id) ? b.id : 999999;
    if (ai !== bi) return ai - bi;
    return String(a.file).localeCompare(String(b.file));
  });

  const next = {
    schema: 'v1',
    levels: entries.map((e) => e.file)
  };

  writeJson(manifestPath, next);

  console.log(`✅ Synced ${path.relative(rootDir, manifestPath)} (${next.levels.length} entries)`);

  if (missing.length > 0) {
    console.warn(`⚠️ Missing level files (${missing.length}):`);
    for (const file of missing) console.warn(`  - ${file}`);
  }
  if (invalid.length > 0) {
    console.warn(`⚠️ Invalid level JSON (${invalid.length}):`);
    for (const entry of invalid) console.warn(`  - ${entry.file}: ${entry.error}`);
  }

  if (missing.length > 0 || invalid.length > 0) {
    process.exitCode = 1;
  }
}

main();

