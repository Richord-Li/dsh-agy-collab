import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'dsh-plugin');
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const PKG_PATH = path.join(PROFILE_DIR, 'package.json');
const NM_LINK = path.join(PROFILE_DIR, 'node_modules', 'dsh-plugin-agy-collab');

if (!fs.existsSync(PKG_PATH)) {
  console.error(`[install-dsh] DSH desktop profile not found: ${PKG_PATH}`);
  console.error('[install-dsh] Alternatively, install via DSH UI install_bundle pointing to:', PLUGIN_DIR);
  process.exit(1);
}

const dataDir = path.join(REPO_ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(PKG_PATH, path.join(dataDir, 'backup-dsh-package.json'));

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['dsh-plugin-agy-collab'] = `link:${PLUGIN_DIR.replace(/\\/g, '/')}`;
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
if (!pkg.dsh.profile.bundles.includes('dsh-plugin-agy-collab')) {
  pkg.dsh.profile.bundles.push('dsh-plugin-agy-collab');
}
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

fs.mkdirSync(path.dirname(NM_LINK), { recursive: true });
if (fs.existsSync(NM_LINK)) {
  fs.rmSync(NM_LINK, { recursive: true, force: true });
}
fs.symlinkSync(PLUGIN_DIR, NM_LINK, process.platform === 'win32' ? 'junction' : 'dir');

console.log(`[install-dsh] registered dsh-plugin-agy-collab in ${PKG_PATH}`);
console.log(`[install-dsh] linked ${NM_LINK} -> ${PLUGIN_DIR}`);
console.log('[install-dsh] restart DeepSeek Harness Desktop to activate.');
