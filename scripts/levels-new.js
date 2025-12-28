import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48);
}

function parseArgs(argv) {
  const args = {
    slug: '',
    name: '',
    validate: true,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (cur === '--help' || cur === '-h') {
      args.help = true;
      continue;
    }
    if (cur === '--slug') {
      args.slug = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (cur === '--name') {
      args.name = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (cur === '--no-validate') {
      args.validate = false;
      continue;
    }
    if (cur === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!cur.startsWith('--') && !args.slug) {
      args.slug = String(cur || '');
    }
  }

  return args;
}

function printHelp() {
  console.log('Usage: npm run levels:new -- <slug> [options]');
  console.log('');
  console.log('Creates a new level JSON using the template and updates public/levels/manifest.json.');
  console.log('');
  console.log('Options:');
  console.log('  --slug <slug>        Filename slug (default: "new-level")');
  console.log('  --name <name>        Human-readable level name');
  console.log('  --no-validate        Skip running npm run levels:validate');
  console.log('  --dry-run            Print what would be written');
  console.log('  -h, --help           Show this help');
  console.log('');
  console.log('Example:');
  console.log('  npm run levels:new -- stealth-lab --name "L12 - Stealth Lab"');
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { schema: 'v1', levels: [] };
  }
  const manifest = readJson(manifestPath);
  if (!isPlainObject(manifest)) {
    throw new Error(`Expected manifest.json to be an object: ${manifestPath}`);
  }
  const schema = String(manifest.schema || 'v1');
  const levels = Array.isArray(manifest.levels) ? manifest.levels : [];
  return { schema, levels: levels.map((f) => String(f || '').trim()).filter(Boolean) };
}

function findMaxLevelId(manifest) {
  let maxId = 0;
  for (const file of manifest.levels) {
    const filePath = path.join(levelsDir, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const level = readJson(filePath);
      const id = Math.round(Number(level?.id));
      if (Number.isFinite(id)) maxId = Math.max(maxId, id);
    } catch {
      // ignore
    }
  }
  return maxId;
}

function buildTemplateLevel({ id, name }) {
  return {
    id,
    name,
    maze: { width: 33, height: 33, roomDensity: 2.9, extraConnectionChance: 0.12 },
    rooms: {
      typeWeights: {
        CLASSROOM: 2.6,
        CLASSROOMS_BLOCK: 1.7,
        OFFICE: 1.6,
        LAB: 1.45,
        STORAGE: 1.2,
        CAFETERIA: 0.75,
        BATHROOM: 0.65,
        LIBRARY: 0.7,
        POOL: 0.2,
        GYM: 0.25,
        BEDROOM: 0.35
      }
    },
    monsters: {
      count: 3,
      maxCount: 5,
      speedMultiplier: 1.0,
      visionMultiplier: 1.0,
      memoryMultiplier: 1.0,
      typeWeights: { WANDERER: 0.55, HUNTER: 0.25, SENTINEL: 0.15, GREETER: 0.05 },
      allowSprintTypes: ['HUNTER']
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'power',
          template: 'restorePowerFuses',
          required: true,
          params: {
            fuses: 2,
            itemId: 'fuse',
            roomTypesFuses: ['STORAGE', 'LAB', 'OFFICE'],
            roomTypesPanel: ['LAB', 'OFFICE'],
            minDistFromSpawn: 7,
            hints: [
              'Collect the fuses.',
              'After collecting all fuses, find the power panel and press E to install them.',
              'Press E again on the power panel to restore power.'
            ]
          }
        },
        {
          id: 'upload',
          template: 'uploadEvidence',
          required: true,
          params: {
            count: 3,
            required: 2,
            itemId: 'evidence',
            requiresPower: true,
            powerItemId: 'power_on',
            roomTypesEvidence: ['CLASSROOM', 'OFFICE', 'CLASSROOMS_BLOCK', 'LIBRARY'],
            roomTypesTerminal: ['OFFICE', 'LAB'],
            minDistFromSpawn: 7,
            hints: [
              'Collect evidence pickups.',
              'Restore power so the upload terminal can be used.',
              'Upload the evidence at the terminal to complete the objective.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.',
              'If it stays locked, you missed a required objective.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'upload', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.5,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.7
    }
  };
}

function runLevelsValidate() {
  const res = spawnSync(process.execPath, ['scripts/validate-levels.js'], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  return res.status || 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const slug = slugify(args.slug) || 'new-level';
  const manifest = loadManifest();
  const maxId = findMaxLevelId(manifest);
  const id = Math.max(1, maxId + 1);

  const fileName = `l${id}-${slug}.json`;
  const filePath = path.join(levelsDir, fileName);

  if (fs.existsSync(filePath)) {
    console.error(`❌ Level already exists: ${path.relative(rootDir, filePath)}`);
    process.exitCode = 1;
    return;
  }

  const levelName = args.name ? String(args.name || '').trim() : `L${id} - ${slug.replaceAll('-', ' ')}`;
  const level = buildTemplateLevel({ id, name: levelName });

  const nextManifest = {
    schema: 'v1',
    levels: manifest.levels.concat([fileName])
  };

  if (args.dryRun) {
    console.log(`(dry-run) would write: ${path.relative(rootDir, filePath)}`);
    console.log(`(dry-run) would update: ${path.relative(rootDir, manifestPath)}`);
    return;
  }

  if (!fs.existsSync(levelsDir)) {
    fs.mkdirSync(levelsDir, { recursive: true });
  }

  writeJson(filePath, level);
  writeJson(manifestPath, nextManifest);

  console.log(`✅ Created ${path.relative(rootDir, filePath)}`);
  console.log(`✅ Updated ${path.relative(rootDir, manifestPath)}`);

  if (args.validate) {
    console.log('🔎 Running levels:validate...');
    const status = runLevelsValidate();
    if (status !== 0) {
      console.error('❌ Validation failed.');
      process.exitCode = status;
    }
  }
}

main();
