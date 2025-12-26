import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function modelsManifestPlugin() {
  const modelsDir = path.resolve(rootDir, 'public/models');
  const manifestFile = path.join(modelsDir, 'manifest.json');
  const manifestUrl = '/models/manifest.json';
  const supportedExts = new Set(['.dae', '.glb', '.gltf']);

  function normalizeUrlPath(filePath) {
    return filePath.split(path.sep).join('/');
  }

  function scanModels() {
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

        if (entry.name === path.basename(manifestFile)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!supportedExts.has(ext)) continue;

        const rel = path.relative(modelsDir, fullPath);
        results.push(`/models/${normalizeUrlPath(rel)}`);
      }
    }

    results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return results;
  }

  function buildManifestPayload() {
    return {
      generatedAt: new Date().toISOString(),
      models: scanModels()
    };
  }

  function writeManifestFile() {
    if (!fs.existsSync(modelsDir)) return;
    const payload = buildManifestPayload();
    fs.writeFileSync(manifestFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  return {
    name: 'models-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== manifestUrl) {
          next();
          return;
        }

        const payload = buildManifestPayload();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      });

      if (fs.existsSync(modelsDir)) {
        server.watcher.add(modelsDir);
      }
    },
    buildStart() {
      writeManifestFile();
    }
  };
}

function enemyMetaSavePlugin() {
  const modelsDir = path.resolve(rootDir, 'public/models');
  const apiUrl = '/api/enemy-meta';

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

    // Prefer per-folder meta.json: /models/<folder>/<file>
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
        if (url !== apiUrl) {
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
            fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');

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

export default defineConfig({
  plugins: [modelsManifestPlugin(), enemyMetaSavePlugin()],
  server: {
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
