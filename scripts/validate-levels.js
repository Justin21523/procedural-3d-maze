import fs from 'node:fs';
import path from 'node:path';
import { ROOM_TYPES } from '../src/world/tileTypes.js';

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

function formatPath(parts) {
  if (!parts || parts.length === 0) return '(root)';
  return parts.join('.');
}

function pushIssue(list, file, parts, message) {
  list.push({ file, path: formatPath(parts), message: String(message || '') });
}

function resolveRoomType(value) {
  if (value === null || value === undefined) return null;

  const asNum = Number(value);
  if (Number.isFinite(asNum)) {
    const n = Math.round(asNum);
    const values = Object.values(ROOM_TYPES);
    return values.includes(n) ? n : null;
  }

  const key = String(value || '').trim().toUpperCase();
  if (!key) return null;
  const id = ROOM_TYPES[key];
  return Number.isFinite(id) ? id : null;
}

function validateManifest(manifest, errors, warnings) {
  if (!isPlainObject(manifest)) {
    pushIssue(errors, manifestPath, [], 'manifest.json must be an object');
    return { levelFiles: [] };
  }

  const schema = String(manifest.schema || '').trim();
  if (schema && schema !== 'v1') {
    pushIssue(warnings, manifestPath, ['schema'], `Unexpected schema "${schema}" (expected "v1")`);
  }

  if (!Array.isArray(manifest.levels) || manifest.levels.length === 0) {
    pushIssue(errors, manifestPath, ['levels'], 'levels must be a non-empty array of JSON filenames');
    return { levelFiles: [] };
  }

  const seen = new Set();
  const files = [];
  for (let i = 0; i < manifest.levels.length; i++) {
    const raw = manifest.levels[i];
    const file = String(raw || '').trim();
    if (!file) {
      pushIssue(errors, manifestPath, ['levels', String(i)], 'Level filename must be a non-empty string');
      continue;
    }
    if (!file.endsWith('.json')) {
      pushIssue(warnings, manifestPath, ['levels', String(i)], `Level filename should end with ".json": "${file}"`);
    }
    if (seen.has(file)) {
      pushIssue(errors, manifestPath, ['levels', String(i)], `Duplicate entry: "${file}"`);
      continue;
    }
    seen.add(file);
    files.push(file);
  }

  return { levelFiles: files };
}

function validateMissionEntry(entry, filePath, index, missionIds, errors, warnings) {
  if (!isPlainObject(entry)) {
    pushIssue(errors, filePath, ['missions', 'list', String(index)], 'Mission entry must be an object');
    return;
  }

  const id = String(entry.id || '').trim();
  const template = String(entry.template || '').trim();
  if (!id) {
    pushIssue(errors, filePath, ['missions', 'list', String(index), 'id'], 'Mission id is required');
  } else if (missionIds.has(id)) {
    pushIssue(errors, filePath, ['missions', 'list', String(index), 'id'], `Duplicate mission id "${id}"`);
  } else {
    missionIds.add(id);
  }

  if (!template) {
    pushIssue(errors, filePath, ['missions', 'list', String(index), 'template'], 'Mission template is required');
  }

  const allowedTemplates = new Set([
    'findKeycard',
    'collectEvidence',
    'restorePower',
    'surviveTimer',
    'enterRoomType',
    'killCount',
    'stealthNoise',
    'codeLock',
    'unlockExit'
  ]);
  if (template && !allowedTemplates.has(template)) {
    pushIssue(warnings, filePath, ['missions', 'list', String(index), 'template'], `Unknown mission template "${template}"`);
  }

  if (entry.params !== undefined && !isPlainObject(entry.params)) {
    pushIssue(errors, filePath, ['missions', 'list', String(index), 'params'], 'params must be an object');
    return;
  }
  const params = isPlainObject(entry.params) ? entry.params : {};

  const validateRoomTypesParam = (paramKey) => {
    if (!Array.isArray(params[paramKey])) return;
    for (let j = 0; j < params[paramKey].length; j++) {
      const v = params[paramKey][j];
      if (resolveRoomType(v) === null) {
        pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', paramKey, String(j)], `Unknown room type "${v}"`);
      }
    }
  };

  if (template === 'findKeycard') {
    validateRoomTypesParam('roomTypes');
  } else if (template === 'collectEvidence') {
    const count = Number(params.count);
    const required = Number(params.required);
    if (!Number.isFinite(count) || count <= 0) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'count'], 'count should be a positive number');
    }
    if (params.required !== undefined && (!Number.isFinite(required) || required <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'required'], 'required should be a positive number');
    }
    validateRoomTypesParam('roomTypes');
  } else if (template === 'restorePower') {
    const switches = Number(params.switches);
    if (params.switches !== undefined && (!Number.isFinite(switches) || switches <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'switches'], 'switches should be a positive number');
    }
    validateRoomTypesParam('roomTypes');
  } else if (template === 'surviveTimer') {
    const seconds = Number(params.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'seconds'], 'seconds should be a positive number');
    }
  } else if (template === 'enterRoomType') {
    const count = Number(params.count);
    if (params.count !== undefined && (!Number.isFinite(count) || count <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'count'], 'count should be a positive number');
    }
    validateRoomTypesParam('roomTypes');
  } else if (template === 'killCount') {
    const count = Number(params.count);
    if (params.count !== undefined && (!Number.isFinite(count) || count <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'count'], 'count should be a positive number');
    }
  } else if (template === 'stealthNoise') {
    const seconds = Number(params.seconds);
    if (params.seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'seconds'], 'seconds should be a positive number');
    }
  } else if (template === 'codeLock') {
    const clues = Number(params.clues);
    if (params.clues !== undefined && (!Number.isFinite(clues) || clues <= 0)) {
      pushIssue(warnings, filePath, ['missions', 'list', String(index), 'params', 'clues'], 'clues should be a positive number');
    }
    validateRoomTypesParam('roomTypes');
    validateRoomTypesParam('roomTypesClues');
    validateRoomTypesParam('roomTypesKeypad');
    validateRoomTypesParam('keypadRoomTypes');
  } else if (template === 'unlockExit') {
    // no required params
  }
}

function validateLevel(level, filePath, errors, warnings, seenLevelIds) {
  if (!isPlainObject(level)) {
    pushIssue(errors, filePath, [], 'Level JSON must be an object');
    return;
  }

  const id = Number(level.id);
  if (!Number.isFinite(id) || id <= 0) {
    pushIssue(errors, filePath, ['id'], 'id must be a positive number');
  } else if (seenLevelIds.has(id)) {
    pushIssue(errors, filePath, ['id'], `Duplicate level id "${id}"`);
  } else {
    seenLevelIds.add(id);
  }

  const name = String(level.name || '').trim();
  if (!name) {
    pushIssue(warnings, filePath, ['name'], 'name should be a non-empty string');
  }

  const maze = isPlainObject(level.maze) ? level.maze : {};
  const width = Number(maze.width);
  const height = Number(maze.height);
  if (!Number.isFinite(width) || width <= 0) {
    pushIssue(warnings, filePath, ['maze', 'width'], 'maze.width should be a positive number');
  }
  if (!Number.isFinite(height) || height <= 0) {
    pushIssue(warnings, filePath, ['maze', 'height'], 'maze.height should be a positive number');
  }

  const rooms = isPlainObject(level.rooms) ? level.rooms : {};
  const typeWeights = isPlainObject(rooms.typeWeights) ? rooms.typeWeights : null;
  if (typeWeights) {
    for (const [k, v] of Object.entries(typeWeights)) {
      if (resolveRoomType(k) === null) {
        pushIssue(warnings, filePath, ['rooms', 'typeWeights', k], `Unknown room type "${k}"`);
      }
      const weight = Number(v);
      if (!Number.isFinite(weight) || weight <= 0) {
        pushIssue(warnings, filePath, ['rooms', 'typeWeights', k], `Weight should be a positive number (got "${v}")`);
      }
    }
  }

  const missions = isPlainObject(level.missions) ? level.missions : null;
  if (!missions) {
    pushIssue(errors, filePath, ['missions'], 'missions is required');
    return;
  }

  if (!Array.isArray(missions.list)) {
    pushIssue(errors, filePath, ['missions', 'list'], 'missions.list must be an array');
    return;
  }

  const missionIds = new Set();
  for (let i = 0; i < missions.list.length; i++) {
    validateMissionEntry(missions.list[i], filePath, i, missionIds, errors, warnings);
  }

  const exit = isPlainObject(missions.exit) ? missions.exit : {};
  const requires = Array.isArray(exit.requires) ? exit.requires : [];
  for (let i = 0; i < requires.length; i++) {
    const rid = String(requires[i] || '').trim();
    if (!rid) {
      pushIssue(errors, filePath, ['missions', 'exit', 'requires', String(i)], 'Requirement id must be a non-empty string');
      continue;
    }
    if (!missionIds.has(rid)) {
      pushIssue(errors, filePath, ['missions', 'exit', 'requires', String(i)], `Unknown mission id "${rid}"`);
    }
  }
}

function main() {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Missing: ${path.relative(rootDir, manifestPath)}`);
    process.exitCode = 1;
    return;
  }

  const manifest = readJson(manifestPath);
  const { levelFiles } = validateManifest(manifest, errors, warnings);

  const seenLevelIds = new Set();
  for (const file of levelFiles) {
    const filePath = path.join(levelsDir, file);
    if (!fs.existsSync(filePath)) {
      pushIssue(errors, manifestPath, ['levels', file], `Missing level file: ${file}`);
      continue;
    }

    const level = readJson(filePath);
    validateLevel(level, filePath, errors, warnings, seenLevelIds);
  }

  const rel = (p) => path.relative(rootDir, p);

  if (warnings.length > 0) {
    console.log(`\n⚠️ Warnings: ${warnings.length}`);
    for (const w of warnings) {
      console.log(`  - ${rel(w.file)} ${w.path}: ${w.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Errors: ${errors.length}`);
    for (const e of errors) {
      console.error(`  - ${rel(e.file)} ${e.path}: ${e.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Levels validated: ${levelFiles.length}`);
}

main();
