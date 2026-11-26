import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'agy-plugin/ui/src/app.js');
const OUT_HTML = path.join(ROOT, 'agy-plugin/ui/index.html');

const CSS = `
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, #111318);
  --bg-card: var(--color-background-secondary, #1a1d24);
  --bg-hover: var(--color-background-tertiary, #232732);
  --fg: var(--color-text-primary, #e5e7eb);
  --fg-muted: var(--color-text-secondary, #9ca3af);
  --border: var(--color-border-primary, rgba(255,255,255,0.12));
  --accent: var(--color-accent-primary, #38bdf8);
  --ok: #22c55e;
  --warn: #f59e0b;
  --err: #ef4444;
  --radius: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 12px;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 13px;
  line-height: 1.45;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  gap: 8px;
}
.brand { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand-title { font-weight: 700; font-size: 14px; }
.status-pills { display: flex; gap: 6px; }
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  background: var(--bg-card); border: 1px solid var(--border);
  font-size: 11px;
}
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.dot-off { background: #6b7280; }
.tabs {
  display: flex; gap: 4px; border-bottom: 1px solid var(--border);
  margin-bottom: 10px; padding-bottom: 6px; overflow-x: auto;
}
.tab {
  background: transparent; color: var(--fg-muted); border: 1px solid transparent;
  padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500;
}
.tab:hover { background: var(--bg-hover); color: var(--fg); }
.tab.active { background: var(--bg-card); color: var(--fg); border-color: var(--border); }
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px;
}
.toolbar { margin-bottom: 8px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  background: var(--bg-card); color: var(--fg-muted); border: 1px solid var(--border);
  padding: 3px 9px; border-radius: 999px; font-size: 11px; cursor: pointer;
}
.chip.active { color: var(--fg); border-color: var(--accent); }
.btn {
  background: var(--bg-hover); color: var(--fg); border: 1px solid var(--border);
  padding: 6px 11px; border-radius: 8px; cursor: pointer; font-size: 12px;
}
.btn:hover { filter: brightness(1.08); }
.btn-sm { padding: 4px 8px; font-size: 11px; }
.btn-primary { background: var(--accent); color: #0b1020; border-color: transparent; font-weight: 600; }
.badge {
  display: inline-block; padding: 1px 6px; border-radius: 6px; font-size: 11px; font-weight: 600;
}
.badge-dir { background: rgba(56,189,248,0.16); color: var(--accent); }
.badge-pending { background: rgba(245,158,11,0.18); color: var(--warn); }
.badge-in_progress { background: rgba(56,189,248,0.18); color: var(--accent); }
.badge-approved, .badge-done { background: rgba(34,197,94,0.18); color: var(--ok); }
.badge-changes_requested, .badge-rejected { background: rgba(239,68,68,0.18); color: var(--err); }
.task-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.task-title { font-weight: 600; font-size: 13px; }
.task-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.task-detail { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
.kv { display: flex; gap: 8px; font-size: 12px; margin-bottom: 4px; }
.kv span { color: var(--fg-muted); min-width: 44px; }
.prompt-box {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px; margin-top: 6px; white-space: pre-wrap; font-size: 12px;
}
.diff-box {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px; overflow-x: auto; font-size: 11px; max-height: 220px; margin: 6px 0 0;
}
.review-box {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 9px; margin-top: 6px;
}
.review-head { display: flex; gap: 8px; align-items: center; font-size: 11px; margin-bottom: 4px; }
.form-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.row-search { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; margin-top: 8px; }
input, select, textarea {
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 7px; padding: 6px 8px; font: inherit; width: 100%;
}
.switch-row { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.switch-row input { width: auto; }
.quick-calls { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.plugin-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.section-sub { font-weight: 600; font-size: 12px; margin-bottom: 6px; }
.log-list { display: flex; flex-direction: column; gap: 5px; max-height: 260px; overflow-y: auto; }
.log-row { display: flex; gap: 6px; align-items: baseline; font-size: 11px; flex-wrap: wrap; }
.muted { color: var(--fg-muted); }
.small { font-size: 11px; }
.empty { text-align: center; color: var(--fg-muted); padding: 24px 12px; }
.toast {
  background: var(--accent); color: #0b1020; padding: 6px 10px;
  border-radius: 8px; font-weight: 600; font-size: 12px; margin-bottom: 8px;
}
summary { cursor: pointer; font-weight: 600; font-size: 12px; }
`;

async function build() {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    target: ['es2022'],
  });
  const js = result.outputFiles[0].text;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>DSH 双向协同台</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module">${js.replace(/<\/script>/gi, '<\\/script>')}</script>
</body>
</html>`;
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log(`[build-ui] wrote ${OUT_HTML} (${(html.length / 1024).toFixed(1)} KB)`);
}

build().catch((err) => {
  console.error('[build-ui] failed:', err);
  process.exit(1);
});
