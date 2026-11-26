import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DSH_HOME = path.join(os.homedir(), '.dsh');
const DSH_MEMORY_DIR = path.join(DSH_HOME, 'memory');
const MDCG_DATA_DIR = path.join(DSH_HOME, '.dsh-memory', 'data', 'mdcg');

const TEXT_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.jsonl']);

function walkFiles(dir, maxFiles = 200, maxDepth = 4, depth = 0, out = []) {
  if (depth > maxDepth || out.length >= maxFiles) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (entry.name.startsWith('.') && entry.name !== '.dsh-memory') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, maxFiles, maxDepth, depth + 1, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTS.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

function safeReadSnippet(filePath, maxBytes = 64 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, 0);
      fs.closeSync(fd);
      return { text: buf.toString('utf8'), mtimeMs: stat.mtimeMs, size: stat.size, truncated: true };
    }
    return {
      text: fs.readFileSync(filePath, 'utf8'),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      truncated: false,
    };
  } catch {
    return null;
  }
}

export function getMemoryOverview() {
  const dshFiles = fs.existsSync(DSH_MEMORY_DIR) ? walkFiles(DSH_MEMORY_DIR, 250, 4) : [];
  const mdcgFiles = fs.existsSync(MDCG_DATA_DIR) ? walkFiles(MDCG_DATA_DIR, 250, 3) : [];
  let workspacesSummary = null;
  const summaryPath = path.join(DSH_MEMORY_DIR, 'workspaces-summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      workspacesSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch {
      workspacesSummary = null;
    }
  }
  return {
    dshMemoryDir: DSH_MEMORY_DIR,
    dshMemoryFileCount: dshFiles.length,
    mdcgDataDir: MDCG_DATA_DIR,
    mdcgFileCount: mdcgFiles.length,
    hasWorkspacesSummary: workspacesSummary !== null,
  };
}

export function searchDshMemory(query, { scope = 'all', limit = 12 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const candidates = [];

  if (scope === 'all' || scope === 'dsh') {
    for (const f of walkFiles(DSH_MEMORY_DIR, 220, 4)) {
      candidates.push({ source: 'dsh-memory', file: f, rel: path.relative(DSH_MEMORY_DIR, f) });
    }
  }
  if (scope === 'all' || scope === 'mdcg') {
    for (const f of walkFiles(MDCG_DATA_DIR, 220, 3)) {
      candidates.push({ source: 'dsh-mdcg', file: f, rel: path.relative(MDCG_DATA_DIR, f) });
    }
  }

  const hits = [];
  for (const item of candidates) {
    const read = safeReadSnippet(item.file);
    if (!read) continue;
    const lowerText = read.text.toLowerCase();
    const lowerPath = item.rel.toLowerCase();

    if (terms.length === 0) {
      hits.push({
        source: item.source,
        path: item.file,
        relPath: item.rel,
        score: 1,
        mtimeMs: read.mtimeMs,
        excerpt: read.text.slice(0, 360).replace(/\s+/g, ' ').trim(),
      });
      continue;
    }

    let score = 0;
    let firstIdx = -1;
    for (const t of terms) {
      if (lowerPath.includes(t)) score += 3;
      const idx = lowerText.indexOf(t);
      if (idx !== -1) {
        score += 2;
        if (firstIdx === -1 || idx < firstIdx) firstIdx = idx;
      }
    }
    if (score > 0) {
      const start = Math.max(0, firstIdx - 120);
      const excerpt = read.text
        .slice(start, start + 420)
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      hits.push({
        source: item.source,
        path: item.file,
        relPath: item.rel,
        score,
        mtimeMs: read.mtimeMs,
        excerpt,
      });
    }
  }

  hits.sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs));
  return hits.slice(0, Math.max(1, Math.min(30, Number(limit) || 12)));
}
