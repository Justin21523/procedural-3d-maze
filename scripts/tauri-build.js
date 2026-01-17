import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveBundlesFromArgs(argv) {
  const idx = argv.indexOf('--bundles');
  if (idx >= 0) {
    const next = argv[idx + 1];
    if (next && !next.startsWith('-')) return String(next).trim();
  }
  const eq = argv.find((a) => a.startsWith('--bundles='));
  if (eq) return String(eq.slice('--bundles='.length)).trim();
  return '';
}

function resolveBundles() {
  const fromArgs = resolveBundlesFromArgs(process.argv.slice(2));
  if (fromArgs) return fromArgs;

  const env = String(process.env.TAURI_BUNDLES || '').trim();
  if (env) return env;

  // Keep the default build reliable across platforms:
  // - Linux: deb (no spaces/rpm toolchain issues)
  // - macOS: dmg
  // - Windows: nsis
  if (process.platform === 'darwin') return 'dmg';
  if (process.platform === 'win32') return 'nsis';
  return 'deb';
}

const bundles = resolveBundles();
console.log(`🧱 Tauri build bundles: ${bundles}`);
run('tauri', ['build', '--bundles', bundles]);
