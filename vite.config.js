import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function modelsManifestPlugin() {
  const modelsDir = path.resolve(rootDir, 'public/models');
  const enemyDir = path.join(modelsDir, 'enemy');
  const weaponDir = path.join(modelsDir, 'weapon');
  const routes = [
    { url: '/models/manifest.json', file: path.join(modelsDir, 'manifest.json'), scanDir: modelsDir, prefix: '/models' },
    { url: '/models/enemy/manifest.json', file: path.join(enemyDir, 'manifest.json'), scanDir: enemyDir, prefix: '/models/enemy' },
    { url: '/models/weapon/manifest.json', file: path.join(weaponDir, 'manifest.json'), scanDir: weaponDir, prefix: '/models/weapon' }
  ];
  const supportedExts = new Set(['.dae', '.glb', '.gltf']);

  function normalizeUrlPath(filePath) {
    return filePath.split(path.sep).join('/');
  }

  function scanModels(scanDir, urlPrefix) {
    const results = [];
    if (!fs.existsSync(scanDir)) return results;

    const stack = [scanDir];
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

        if (entry.name === 'manifest.json') continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!supportedExts.has(ext)) continue;

        const rel = path.relative(scanDir, fullPath);
        results.push(`${urlPrefix}/${normalizeUrlPath(rel)}`);
      }
    }

    results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return results;
  }

  function buildManifestPayload(route) {
    return {
      generatedAt: new Date().toISOString(),
      models: scanModels(route.scanDir, route.prefix)
    };
  }

  function writeManifestFiles() {
    for (const route of routes) {
      if (!fs.existsSync(route.scanDir)) continue;
      fs.mkdirSync(path.dirname(route.file), { recursive: true });
      const payload = buildManifestPayload(route);
      try {
        const existingRaw = fs.existsSync(route.file) ? fs.readFileSync(route.file, 'utf8') : '';
        const existing = existingRaw ? JSON.parse(existingRaw) : null;
        const existingModels = Array.isArray(existing?.models) ? existing.models : null;
        if (existingModels && JSON.stringify(existingModels) === JSON.stringify(payload.models)) {
          // Avoid dirty working trees when only the timestamp would change.
          continue;
        }
      } catch {
        // ignore
      }
      fs.writeFileSync(route.file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    }
  }

  return {
    name: 'models-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        const route = routes.find((r) => r.url === url) || null;
        if (!route) {
          next();
          return;
        }

        const payload = buildManifestPayload(route);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      });

      if (fs.existsSync(modelsDir)) {
        server.watcher.add(modelsDir);
      }
    },
    buildStart() {
      writeManifestFiles();
    }
  };
}

function enemyMetaSavePlugin() {
  const modelsDir = path.resolve(rootDir, 'public/models');
  const apiUrls = new Set(['/api/enemy-meta', '/api/model-meta']);

  function json(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  function resolveMetaFile(modelPath) {
    const raw = String(modelPath || '').trim();
    if (!raw.startsWith('/models/')) return null;

    const relUrl = raw.slice('/models/'.length);
    const parts = relUrl.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // New layout: /models/enemy/<Enemy>/<file> -> /public/models/enemy/<Enemy>/manifest.json
    if (parts[0] === 'enemy' && parts.length >= 3) {
      const enemyName = parts[1];
      if (!enemyName || enemyName === '.' || enemyName === '..') return null;
      return path.join(modelsDir, 'enemy', enemyName, 'manifest.json');
    }

    // Legacy layout: /models/<folder>/<file> -> /public/models/<folder>/meta.json
    if (parts.length >= 2) {
      const folder = parts[0];
      if (!folder || folder === '.' || folder === '..') return null;
      return path.join(modelsDir, folder, 'meta.json');
    }

    // Fallback for top-level models: /models/<file> -> /public/models/<file>.meta.json
    const file = parts[0];
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    if (!base) return null;
    return path.join(modelsDir, `${base}.meta.json`);
  }

  function resolveMetaUrl(modelPath) {
    const raw = String(modelPath || '').trim();
    if (!raw.startsWith('/models/')) return null;
    const relUrl = raw.slice('/models/'.length);
    const parts = relUrl.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    if (parts[0] === 'enemy' && parts.length >= 3) {
      const enemyName = parts[1];
      if (!enemyName || enemyName === '.' || enemyName === '..') return null;
      return `/models/enemy/${enemyName}/manifest.json`;
    }
    if (parts.length >= 2) {
      const folder = parts[0];
      if (!folder || folder === '.' || folder === '..') return null;
      return `/models/${folder}/meta.json`;
    }
    const file = parts[0];
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    if (!base) return null;
    return `/models/${base}.meta.json`;
  }

  function isSafePath(filePath) {
    const abs = path.resolve(filePath);
    const root = path.resolve(modelsDir) + path.sep;
    return abs === path.resolve(modelsDir) || abs.startsWith(root);
  }

  return {
    name: 'enemy-meta-save',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!apiUrls.has(url)) {
          next();
          return;
        }

        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }

        let body = '';
        const maxBytes = 256 * 1024;
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > maxBytes) {
            json(res, 413, { ok: false, error: 'Payload too large' });
            req.destroy();
          }
        });

        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const modelPath = payload?.modelPath || payload?.model || null;
            const meta = payload?.meta || null;
            if (typeof modelPath !== 'string' || !modelPath) {
              json(res, 400, { ok: false, error: 'Missing modelPath' });
              return;
            }
            if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
              json(res, 400, { ok: false, error: 'Missing meta object' });
              return;
            }

            const file = resolveMetaFile(modelPath);
            if (!file) {
              json(res, 400, { ok: false, error: 'Unsupported modelPath (expected /models/...)' });
              return;
            }

            if (!isSafePath(file)) {
              json(res, 400, { ok: false, error: 'Unsafe path' });
              return;
            }

            fs.mkdirSync(path.dirname(file), { recursive: true });

            const wantsManifest = file.endsWith(`${path.sep}manifest.json`) && file.includes(`${path.sep}enemy${path.sep}`);
            if (wantsManifest) {
              let base = {};
              try {
                if (fs.existsSync(file)) {
                  base = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
                }
              } catch {
                base = {};
              }

              const relUrl = String(modelPath).slice('/models/'.length);
              const parts = relUrl.split('/').filter(Boolean);
              const enemyName = parts[1] || null;
              const modelFile = parts[2] || null;
              const enemyFolder = enemyName ? path.join(modelsDir, 'enemy', enemyName) : null;

              let textureFiles = Array.isArray(base?.textureFiles) ? base.textureFiles : [];
              if ((!textureFiles || textureFiles.length === 0) && enemyFolder && fs.existsSync(enemyFolder)) {
                try {
                  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
                  textureFiles = fs.readdirSync(enemyFolder, { withFileTypes: true })
                    .filter((e) => e.isFile())
                    .map((e) => e.name)
                    .filter((name) => exts.has(path.extname(name).toLowerCase()))
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                } catch {
                  textureFiles = [];
                }
              }

              const merged = {
                schemaVersion: 1,
                ...(base && typeof base === 'object' ? base : {}),
                id: base?.id || enemyName || 'enemy',
                displayName: base?.displayName || enemyName || base?.id || 'enemy',
                modelFile: base?.modelFile || modelFile || null,
                textureFiles,
                ...meta
              };

              fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf8');
            } else {
              fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
            }

            json(res, 200, {
              ok: true,
              file: path.relative(rootDir, file).split(path.sep).join('/'),
              metaUrl: resolveMetaUrl(modelPath)
            });
          } catch (err) {
            json(res, 500, { ok: false, error: err?.message || String(err) });
          }
        });
      });
    }
  };
}

function enemyModelImportPlugin() {
  const modelsDir = path.resolve(rootDir, 'public/models');
  const apiUrl = '/api/models-import';
  const maxBytes = 200 * 1024 * 1024; // 200MB per file (dev-only safeguard)
  const supportedModelExts = new Set(['.glb', '.gltf', '.dae']);
  const allowedExts = new Set([
    // primary model files
    '.glb', '.gltf', '.dae',
    // gltf dependencies
    '.bin',
    // textures (common)
    '.png', '.jpg', '.jpeg', '.webp',
    // textures (less common, still useful)
    '.tga', '.dds'
  ]);

  function json(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  function normalizeSegment(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (raw.includes('/') || raw.includes('\\')) return null;
    if (raw === '.' || raw === '..') return null;
    if (raw.includes('..')) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) return null;
    return raw;
  }

  function isSafePath(filePath) {
    const abs = path.resolve(filePath);
    const root = path.resolve(modelsDir) + path.sep;
    return abs === path.resolve(modelsDir) || abs.startsWith(root);
  }

  function enemyFolderDir(folder) {
    return path.join(modelsDir, 'enemy', folder);
  }

  function ensureDefaultEnemyManifest(folder) {
    const manifestFile = path.join(enemyFolderDir(folder), 'manifest.json');
    if (!isSafePath(manifestFile)) return;
    if (fs.existsSync(manifestFile)) return;
    const payload = {
      schemaVersion: 1,
      id: folder,
      displayName: folder,
      modelFile: null,
      textureFiles: [],
      scaleMultiplier: 1,
      groundOffset: 0.02,
      stats: { hitRadius: 1 },
      studio: { version: 1, objects: [], materials: [] }
    };
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  function updateEnemyManifestFiles(folder, fileName) {
    const manifestFile = path.join(enemyFolderDir(folder), 'manifest.json');
    if (!isSafePath(manifestFile)) return;
    if (!fs.existsSync(manifestFile)) return;

    let jsonObj = null;
    try {
      jsonObj = JSON.parse(fs.readFileSync(manifestFile, 'utf8') || '{}');
    } catch {
      jsonObj = null;
    }
    if (!jsonObj || typeof jsonObj !== 'object') return;

    const ext = path.extname(fileName).toLowerCase();
    const next = { ...jsonObj };
    next.textureFiles = Array.isArray(next.textureFiles) ? [...next.textureFiles] : [];

    if (supportedModelExts.has(ext)) {
      // Prefer .dae as primary model when present.
      const current = typeof next.modelFile === 'string' ? next.modelFile : null;
      if (!current || (ext === '.dae' && !String(current).toLowerCase().endsWith('.dae'))) {
        next.modelFile = fileName;
      }
    } else if (['.png', '.jpg', '.jpeg', '.webp', '.tga', '.dds'].includes(ext)) {
      if (!next.textureFiles.includes(fileName)) {
        next.textureFiles.push(fileName);
        next.textureFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      }
    }

    fs.writeFileSync(manifestFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  return {
    name: 'enemy-model-import',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== apiUrl) {
          next();
          return;
        }

        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }

        const folder = normalizeSegment(req.headers['x-model-folder']);
        const fileName = normalizeSegment(req.headers['x-file-name']);
        const overwrite = String(req.headers['x-overwrite'] || '').toLowerCase() === 'true';

        if (!folder) {
          json(res, 400, { ok: false, error: 'Missing or invalid x-model-folder' });
          return;
        }
        if (!fileName) {
          json(res, 400, { ok: false, error: 'Missing or invalid x-file-name' });
          return;
        }

        const ext = path.extname(fileName).toLowerCase();
        if (!allowedExts.has(ext)) {
          json(res, 400, { ok: false, error: `Unsupported file type: ${ext}` });
          return;
        }

        const dest = path.join(modelsDir, 'enemy', folder, fileName);
        if (!isSafePath(dest)) {
          json(res, 400, { ok: false, error: 'Unsafe path' });
          return;
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        ensureDefaultEnemyManifest(folder);

        let bytes = 0;
        const stream = fs.createWriteStream(dest, { flags: overwrite ? 'w' : 'wx' });

        const abort = (statusCode, error) => {
          try {
            stream.destroy();
          } catch {
            // ignore
          }
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
          } catch {
            // ignore
          }
          json(res, statusCode, { ok: false, error });
        };

        req.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            req.destroy();
            abort(413, 'Payload too large');
          }
        });

        req.on('aborted', () => {
          abort(499, 'Client aborted');
        });

        stream.on('error', (err) => {
          if (err?.code === 'EEXIST') {
            json(res, 409, { ok: false, error: 'File exists (set x-overwrite: true to overwrite)' });
            return;
          }
          abort(500, err?.message || String(err));
        });

        stream.on('finish', () => {
          updateEnemyManifestFiles(folder, fileName);
          json(res, 200, {
            ok: true,
            folder,
            fileName,
            modelUrl: `/models/enemy/${folder}/${fileName}`
          });
        });

        req.pipe(stream);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), modelsManifestPlugin(), enemyMetaSavePlugin(), enemyModelImportPlugin()],
  server: {
    // Default port for web dev; `npm run dev -- --port 3002` (Tauri) can override this.
    port: 3000,
    watch: {
      // Avoid hitting file descriptor limits on systems with low defaults
      usePolling: true,
      interval: 300,
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      // Multi-page build: package all diagnostic/test pages into `dist/` for Tauri.
      input: {
        index: path.resolve(rootDir, 'index.html'),
        diagnostic: path.resolve(rootDir, 'diagnostic.html'),
        debugHub: path.resolve(rootDir, 'debug-hub.html'),
        enemyLab: path.resolve(rootDir, 'enemy-lab.html'),
        levelLab: path.resolve(rootDir, 'level-lab.html'),
        testAi: path.resolve(rootDir, 'test-ai.html'),
        testEnemyMeta: path.resolve(rootDir, 'test-enemy-meta.html')
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('node_modules/three/examples/jsm')) return 'vendor-three-examples';
          if (id.includes('node_modules/three')) return 'vendor-three';
          return 'vendor';
        }
      }
    },
  },
});
