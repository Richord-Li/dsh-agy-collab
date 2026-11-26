import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DSH_AGY_COLLAB_DATA_DIR || path.join(PROJECT_ROOT, 'data');
export const STATE_FILE = path.join(DATA_DIR, 'hub-state.json');
export const TOKEN_FILE = path.join(DATA_DIR, 'hub-token');
const USER_META_DIR = path.join(os.homedir(), '.dsh-agy-collab');

const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    autoWakeAgy: true,
    autoWakeDsh: true,
    autoWakeCommand: '',
  },
  peers: {
    antigravity: { online: false, lastSeen: 0, meta: {} },
    deepseek: { online: false, lastSeen: 0, meta: {} },
  },
  tasks: [],
  logs: [],
});

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getOrCreateToken() {
  ensureDataDir();
  let token = '';
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing.length >= 16) token = existing;
  }
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 });
  }
  try {
    fs.mkdirSync(USER_META_DIR, { recursive: true });
    fs.writeFileSync(path.join(USER_META_DIR, 'repo-path'), PROJECT_ROOT, 'utf8');
    fs.writeFileSync(path.join(USER_META_DIR, 'hub-token'), token, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore user home pointer failure
  }
  return token;
}

export function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = DEFAULT_STATE();
    saveState(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const base = DEFAULT_STATE();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      peers: {
        antigravity: { ...base.peers.antigravity, ...(parsed.peers?.antigravity || {}) },
        deepseek: { ...base.peers.deepseek, ...(parsed.peers?.deepseek || {}) },
      },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return DEFAULT_STATE();
  }
}

export function saveState(state) {
  ensureDataDir();
  const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

export function pushLog(state, { actor, event, detail = '' }) {
  state.logs.unshift({
    id: `log_${crypto.randomBytes(4).toString('hex')}`,
    at: Date.now(),
    actor: actor || 'hub',
    event,
    detail: String(detail).slice(0, 600),
  });
  if (state.logs.length > 120) {
    state.logs.length = 120;
  }
}

export function createTaskRecord(input) {
  const now = Date.now();
  const from = input.from === 'deepseek' ? 'deepseek' : 'antigravity';
  const to = input.to || (from === 'deepseek' ? 'antigravity' : 'deepseek');
  return {
    id: `task_${crypto.randomBytes(5).toString('hex')}`,
    title: String(input.title || '未命名协同任务').trim().slice(0, 200),
    kind: input.kind || 'code_review',
    from,
    to,
    status: 'pending',
    workspace: String(input.workspace || '').trim(),
    files: Array.isArray(input.files) ? input.files.map((f) => String(f)).slice(0, 50) : [],
    diff: String(input.diff || '').slice(0, 60_000),
    prompt: String(input.prompt || '').slice(0, 12_000),
    round: 1,
    reviews: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function computePeerStatus(peer) {
  if (!peer || !peer.lastSeen) return { online: false, lastSeen: 0, meta: peer?.meta || {} };
  const fresh = Date.now() - peer.lastSeen < 35_000;
  return {
    online: fresh,
    lastSeen: peer.lastSeen,
    meta: peer.meta || {},
  };
}
