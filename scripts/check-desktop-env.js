import { execSync } from 'node:child_process';

function hasCommand(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore',
      shell: true
    });
    return true;
  } catch {
    return false;
  }
}

function runVersion(cmd) {
  try {
    return String(execSync(`${cmd} --version`, { shell: true, stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch {
    return '';
  }
}

const missing = [];
if (!hasCommand('cargo')) missing.push('cargo (Rust toolchain)');
if (!hasCommand('rustc')) missing.push('rustc (Rust toolchain)');

if (missing.length) {
  console.error(`❌ Desktop build prerequisites missing: ${missing.join(', ')}`);
  console.error('');
  console.error('Install Rust via rustup, then restart your terminal:');
  console.error('- https://rustup.rs');
  console.error('');
  console.error('Then re-run:');
  console.error('- npm run desktop:dev');
  console.error('- npm run desktop:build');
  process.exit(1);
}

const cargoV = runVersion('cargo');
const rustcV = runVersion('rustc');
if (cargoV) console.log(`✅ ${cargoV}`);
if (rustcV) console.log(`✅ ${rustcV}`);

