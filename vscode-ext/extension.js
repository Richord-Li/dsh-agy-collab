const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HUB_HOST = '127.0.0.1';

function getHubPort() {
  const cfg = vscode.workspace.getConfiguration('dshCollab');
  return Number(cfg.get('hubPort')) || Number(process.env.DSH_AGY_HUB_PORT) || 47891;
}

function getHubBase() {
  return `http://${HUB_HOST}:${getHubPort()}`;
}

function resolveCollabRoot() {
  const cfgRoot = String(vscode.workspace.getConfiguration('dshCollab').get('collabRoot') || '').trim();
  let pointerRoot = '';
  try {
    const pFile = path.join(os.homedir(), '.dsh-agy-collab', 'repo-path');
    if (fs.existsSync(pFile)) pointerRoot = fs.readFileSync(pFile, 'utf8').trim();
  } catch {
    // ignore
  }
  const candidates = [
    cfgRoot,
    process.env.DSH_AGY_COLLAB_DIR,
    pointerRoot,
    path.join(os.homedir(), '.dsh-agy-collab'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'hub', 'server.mjs')) || fs.existsSync(path.join(dir, 'data', 'hub-token'))) {
      return dir;
    }
  }
  return candidates[0] || path.join(os.homedir(), '.dsh-agy-collab');
}

function readToken() {
  const root = resolveCollabRoot();
  const candidates = [
    process.env.DSH_AGY_HUB_TOKEN_FILE,
    path.join(root, 'data', 'hub-token'),
    path.join(os.homedir(), '.dsh-agy-collab', 'hub-token'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const t = fs.readFileSync(p, 'utf8').trim();
        if (t) return t;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

async function ensureHubRunning() {
  const base = getHubBase();
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    if (r.ok) return true;
  } catch {
    // not running
  }
  const root = resolveCollabRoot();
  const hubScript = path.join(root, 'hub', 'server.mjs');
  if (!fs.existsSync(hubScript)) return false;
  try {
    const child = spawn('node', [hubScript], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(800) });
        if (r.ok) return true;
      } catch {
        // retry
      }
    }
  } catch {
    // ignore
  }
  return false;
}

async function hubRequest(pathname, { method = 'GET', body } = {}) {
  await ensureHubRunning();
  const token = readToken();
  if (!token) {
    return { ok: false, error: '未找到协同中枢 token，请在设置中配置 dshCollab.collabRoot 或先启动 Hub' };
  }
  try {
    const res = await fetch(`${getHubBase()}${pathname}`, {
      method,
      headers: {
        'x-collab-token': token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

class DshCollabSidebarProvider {
  constructor(context, onDashboardUpdate) {
    this.context = context;
    this.onDashboardUpdate = onDashboardUpdate;
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'ready':
        case 'refresh': {
          await this.pushDashboard();
          break;
        }
        case 'getActiveContext': {
          const editor = vscode.window.activeTextEditor;
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
          const file = editor?.document?.uri?.fsPath || '';
          const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).slice(0, 8000) : '';
          this.post({ type: 'activeContext', workspace: ws, file, selection });
          break;
        }
        case 'createTask': {
          const res = await hubRequest('/api/tasks', {
            method: 'POST',
            body: {
              title: msg.payload?.title,
              kind: msg.payload?.kind || 'code_review',
              from: msg.payload?.to === 'antigravity' ? 'deepseek' : 'antigravity',
              to: msg.payload?.to || 'deepseek',
              workspace: msg.payload?.workspace || vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '',
              files: msg.payload?.files || [],
              diff: msg.payload?.diff || '',
              prompt: msg.payload?.prompt || '',
            },
          });
          if (res.ok) vscode.window.showInformationMessage(`已创建协同任务：${res.task.title}`);
          else vscode.window.showErrorMessage(`创建任务失败：${res.error}`);
          await this.pushDashboard();
          break;
        }
        case 'updateTaskStatus': {
          await hubRequest(`/api/tasks/${encodeURIComponent(msg.taskId)}`, {
            method: 'PATCH',
            body: { status: msg.status, actor: 'vscode-sidebar' },
          });
          await this.pushDashboard();
          break;
        }
        case 'copyTakeover': {
          const t = msg.task;
          if (!t) break;
          const text =
            t.to === 'antigravity'
              ? `请帮我处理来自 DeepSeek Harness 的协同任务（ID: ${t.id}，标题：${t.title}）。请先调用 dsh_collab_list_tasks 查看详情与文件，完成后调用 dsh_collab_submit_review 回写给 DeepSeek。`
              : `请审查来自 Antigravity 的协同任务（ID: ${t.id}，标题：${t.title}）。请先调用 agy_list_tasks 查看详情，完成后调用 agy_submit_review 回写结论。`;
          await vscode.env.clipboard.writeText(text);
          vscode.window.showInformationMessage('已复制接手指令到剪贴板，直接粘贴给对应对话即可。');
          break;
        }
        case 'openFile': {
          if (!msg.filePath) break;
          try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath));
            await vscode.window.showTextDocument(doc, { preview: true });
          } catch (err) {
            vscode.window.showWarningMessage(`无法打开文件：${msg.filePath} (${err?.message || err})`);
          }
          break;
        }
        case 'searchMemory': {
          const qs = new URLSearchParams({ q: msg.query || '', scope: msg.scope || 'all', limit: '15' });
          const res = await hubRequest(`/api/memory/search?${qs}`);
          this.post({ type: 'memoryResult', data: res });
          break;
        }
        case 'callPlugin': {
          const res = await hubRequest('/api/dsh/call', {
            method: 'POST',
            body: { plugin: msg.plugin, action: msg.action, params: msg.params || {} },
          });
          this.post({ type: 'pluginResult', data: res });
          break;
        }
        case 'saveSettings': {
          const res = await hubRequest('/api/settings', {
            method: 'PATCH',
            body: {
              autoWakeAgy: Boolean(msg.autoWakeAgy),
              autoWakeCommand: String(msg.autoWakeCommand || ''),
              actor: 'vscode-sidebar',
            },
          });
          if (res.ok) vscode.window.showInformationMessage('DSH 协同设置已保存');
          await this.pushDashboard();
          break;
        }
      }
    });

    void this.pushDashboard();
  }

  post(message) {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  async pushDashboard() {
    const data = await hubRequest('/api/dashboard');
    this.onDashboardUpdate?.(data);
    this.post({ type: 'dashboard', data });
    return data;
  }

  getHtml(webview) {
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.45;
    }
    .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .between { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 7px; border-radius: 999px;
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
      font-size: 11px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
    .on { background: #22c55e; box-shadow: 0 0 5px #22c55e; }
    .off { background: #6b7280; }
    .tabs {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
      margin: 10px 0; padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    }
    .tab {
      background: transparent; color: var(--vscode-descriptionForeground);
      border: 1px solid transparent; border-radius: 6px;
      padding: 4px 2px; cursor: pointer; font-size: 11px; text-align: center;
    }
    .tab.active {
      color: var(--vscode-foreground);
      background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,0.2));
      border-color: var(--vscode-focusBorder, transparent);
      font-weight: 600;
    }
    .card {
      background: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      border-radius: 8px; padding: 9px 10px; margin-bottom: 8px;
    }
    .btn {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid transparent; border-radius: 5px;
      padding: 4px 8px; cursor: pointer; font-size: 11px;
    }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
    .btn-pri {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
      font-weight: 600;
    }
    .btn-pri:hover { background: var(--vscode-button-hoverBackground, #0062a3); }
    input, select, textarea {
      width: 100%; font: inherit; font-size: 12px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
      border-radius: 5px; padding: 5px 7px;
    }
    .grid { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .badge { padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .b-dir { background: rgba(56,189,248,0.18); color: #38bdf8; }
    .b-pending { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .b-in_progress { background: rgba(56,189,248,0.2); color: #38bdf8; }
    .b-approved, .b-done { background: rgba(34,197,94,0.2); color: #22c55e; }
    .b-changes_requested, .b-rejected { background: rgba(239,68,68,0.2); color: #ef4444; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; word-break: break-all; }
    pre {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      border-radius: 5px; padding: 7px; overflow: auto; max-height: 200px; font-size: 11px; margin: 6px 0 0;
    }
    summary { cursor: pointer; font-weight: 600; font-size: 12px; }
    .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 18px 8px; font-size: 12px; }
  </style>
</head>
<body>
  <div id="root">正在连接协同中枢...</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const S = { tab: 'tasks', data: null, mem: null, pluginRes: null, filter: 'all' };

    function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (!m) return;
      if (m.type === 'dashboard') { S.data = m.data; render(); }
      if (m.type === 'memoryResult') { S.mem = m.data; render(); }
      if (m.type === 'pluginResult') { S.pluginRes = m.data; render(); }
      if (m.type === 'activeContext') {
        const form = document.getElementById('f-task');
        if (form) {
          if (m.file) form.querySelector('[name="files"]').value = m.file;
          if (m.workspace) form.querySelector('[name="workspace"]').value = m.workspace;
          if (m.selection) form.querySelector('[name="diff"]').value = m.selection;
          if (m.file && !form.querySelector('[name="title"]').value) {
            const base = m.file.split(/[\\\\/]/).pop();
            form.querySelector('[name="title"]').value = '审查 ' + base;
          }
        }
      }
    });

    function render() {
      const d = S.data || {};
      const agyOn = Boolean(d.peers?.antigravity?.online);
      const dshOn = Boolean(d.peers?.deepseek?.online);
      const tasks = d.tasks || [];
      const pendingAgy = tasks.filter(t => t.to === 'antigravity' && t.status === 'pending').length;

      let content = '';
      if (S.tab === 'tasks') {
        const list = tasks.filter(t => {
          if (S.filter === 'to_agy') return t.to === 'antigravity';
          if (S.filter === 'to_dsh') return t.to === 'deepseek';
          return true;
        });
        content = \`
          <div class="row" style="margin-bottom:8px">
            <button class="btn \${S.filter==='all'?'btn-pri':''}" data-f="all">全部 (\${tasks.length})</button>
            <button class="btn \${S.filter==='to_agy'?'btn-pri':''}" data-f="to_agy">待我审 (\${pendingAgy})</button>
            <button class="btn \${S.filter==='to_dsh'?'btn-pri':''}" data-f="to_dsh">发给 DSH</button>
          </div>
          <details class="card">
            <summary>+ 发起新协同任务</summary>
            <form id="f-task" class="grid">
              <div class="between">
                <span class="muted">可一键填入当前打开文件</span>
                <button type="button" class="btn" id="btn-fill-active">填入当前文件</button>
              </div>
              <input name="title" placeholder="任务标题" required />
              <select name="to">
                <option value="deepseek">发给 DeepSeek (DSH) 审查/处理</option>
                <option value="antigravity">发给 Antigravity 审查/处理</option>
              </select>
              <input name="workspace" placeholder="工作区路径（可选）" />
              <input name="files" placeholder="涉及文件（逗号分隔）" />
              <textarea name="prompt" rows="2" placeholder="审查重点或说明..."></textarea>
              <textarea name="diff" rows="2" placeholder="可选代码片段或 Diff..."></textarea>
              <button type="submit" class="btn btn-pri">发送到协同中枢</button>
            </form>
          </details>
          \${list.length ? list.map(t => \`
            <div class="card">
              <div class="row" style="margin-bottom:4px">
                <span class="badge b-dir">\${t.from === 'deepseek' ? 'DSH → AGY' : 'AGY → DSH'}</span>
                <span class="badge b-\${esc(t.status)}">\${esc(t.status)}</span>
              </div>
              <div style="font-weight:600;margin-bottom:4px">\${esc(t.title)}</div>
              \${t.files?.length ? \`<div class="muted" style="margin-bottom:4px">\${t.files.map(f => \`<span class="link" data-open="\${esc(f)}">\${esc(f.split(/[\\\\/]/).pop())}</span>\`).join(' · ')}</div>\` : ''}
              \${t.prompt ? \`<div class="muted" style="white-space:pre-wrap;margin-bottom:5px">\${esc(t.prompt)}</div>\` : ''}
              \${(t.reviews||[]).map(r => \`<div class="card" style="margin:5px 0;padding:6px"><span class="badge b-\${esc(r.verdict)}">\${esc(r.verdict)}</span> <b>\${esc(r.reviewer)}</b>: \${esc(r.summary)}</div>\`).join('')}
              <div class="row" style="margin-top:6px">
                <button class="btn btn-pri" data-copy="\${esc(t.id)}">复制接手指令</button>
                \${t.status !== 'done' ? \`<button class="btn" data-done="\${esc(t.id)}">标记完成</button>\` : ''}
              </div>
            </div>\`).join('') : '<div class="empty">暂无协同任务</div>'}
        \`;
      } else if (S.tab === 'memory') {
        const hits = S.mem?.hits || [];
        content = \`
          <div class="card">
            <div class="muted" style="margin-bottom:6px">DSH 记忆：\${d.memory?.dshMemoryFileCount ?? 0} · MDCG：\${d.memory?.mdcgFileCount ?? 0}</div>
            <form id="f-mem" class="grid">
              <input name="q" placeholder="搜索 DeepSeek 历史记忆..." value="\${esc(S.mem?.query || '')}" />
              <button type="submit" class="btn btn-pri">搜索记忆</button>
            </form>
          </div>
          \${hits.map(h => \`
            <div class="card">
              <div class="row"><span class="badge b-dir">\${esc(h.source)}</span><span class="link muted" data-open="\${esc(h.path)}">\${esc(h.relPath)}</span></div>
              <div style="margin-top:4px;font-size:12px">\${esc(h.excerpt)}</div>
            </div>\`).join('')}
        \`;
      } else if (S.tab === 'plugins') {
        const plugins = d.dshPlugins || [];
        content = \`
          <div class="card">
            <div class="row" style="margin-bottom:6px">
              <button class="btn" data-call="host:list_services">探测服务</button>
              <button class="btn" data-call="quota-balance:status">余额插件</button>
            </div>
            \${S.pluginRes ? \`<pre>\${esc(JSON.stringify(S.pluginRes, null, 2))}</pre>\` : ''}
          </div>
          \${plugins.map(p => \`<div class="card between"><span style="font-weight:600;word-break:break-all">\${esc(p.name)}</span><span class="badge \${p.enabled ? 'b-approved' : 'b-pending'}">\${p.enabled ? '启用' : '未启用'}</span></div>\`).join('')}
        \`;
      } else {
        const logs = d.logs || [];
        content = \`
          <div class="card">
            <form id="f-set" class="grid">
              <label class="row"><input type="checkbox" name="autoWakeAgy" style="width:auto" \${d.settings?.autoWakeAgy ? 'checked' : ''} /> <span>开启自动唤醒（DeepSeek 投递任务时）</span></label>
              <input name="autoWakeCommand" placeholder="可选唤醒命令模板（{{TASK_ID}} / {{TITLE}}）" value="\${esc(d.settings?.autoWakeCommand || '')}" />
              <button type="submit" class="btn btn-pri">保存配置</button>
            </form>
          </div>
          <div class="card">
            <div style="font-weight:600;margin-bottom:5px;font-size:12px">事件日志</div>
            \${logs.slice(0, 20).map(l => \`<div class="muted" style="margin-bottom:4px">[\${new Date(l.at).toLocaleTimeString()}] <b>\${esc(l.actor)}</b> \${esc(l.event)} \${esc(l.detail)}</div>\`).join('') || '<div class="muted">暂无日志</div>'}
          </div>
        \`;
      }

      document.getElementById('root').innerHTML = \`
        <div class="between">
          <div class="row">
            <span class="pill"><span class="dot \${agyOn ? 'on' : 'off'}"></span>AGY</span>
            <span class="pill"><span class="dot \${dshOn ? 'on' : 'off'}"></span>DSH</span>
          </div>
          <button class="btn" id="btn-ref">刷新</button>
        </div>
        <div class="tabs">
          <button class="tab \${S.tab==='tasks'?'active':''}" data-tab="tasks">任务</button>
          <button class="tab \${S.tab==='memory'?'active':''}" data-tab="memory">记忆</button>
          <button class="tab \${S.tab==='plugins'?'active':''}" data-tab="plugins">插件</button>
          <button class="tab \${S.tab==='settings'?'active':''}" data-tab="settings">设置</button>
        </div>
        \${content}
      \`;

      document.getElementById('btn-ref').onclick = () => vscode.postMessage({ type: 'refresh' });
      document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { S.tab = el.dataset.tab; render(); });
      document.querySelectorAll('[data-f]').forEach(el => el.onclick = () => { S.filter = el.dataset.f; render(); });
      document.getElementById('btn-fill-active')?.addEventListener('click', () => vscode.postMessage({ type: 'getActiveContext' }));
      document.getElementById('f-task')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const files = String(fd.get('files') || '').split(/[,\\n]+/).map(s=>s.trim()).filter(Boolean);
        vscode.postMessage({
          type: 'createTask',
          payload: {
            title: fd.get('title'),
            to: fd.get('to'),
            workspace: fd.get('workspace'),
            files,
            prompt: fd.get('prompt'),
            diff: fd.get('diff'),
          },
        });
      });
      document.getElementById('f-mem')?.addEventListener('submit', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'searchMemory', query: new FormData(e.target).get('q') || '' });
      });
      document.getElementById('f-set')?.addEventListener('submit', (e) => {
        e.preventDefault();
        vscode.postMessage({
          type: 'saveSettings',
          autoWakeAgy: e.target.autoWakeAgy.checked,
          autoWakeCommand: e.target.autoWakeCommand.value,
        });
      });
      document.querySelectorAll('[data-open]').forEach(el => el.onclick = () => vscode.postMessage({ type: 'openFile', filePath: el.dataset.open }));
      document.querySelectorAll('[data-done]').forEach(el => el.onclick = () => vscode.postMessage({ type: 'updateTaskStatus', taskId: el.dataset.done, status: 'done' }));
      document.querySelectorAll('[data-copy]').forEach(el => el.onclick = () => {
        const task = tasks.find(x => x.id === el.dataset.copy);
        if (task) vscode.postMessage({ type: 'copyTakeover', task });
      });
      document.querySelectorAll('[data-call]').forEach(el => el.onclick = () => {
        const [plugin, action] = el.dataset.call.split(':');
        vscode.postMessage({ type: 'callPlugin', plugin, action });
      });
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function activate(context) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'dshCollab.openSidebar';
  statusBar.text = '$(sync) DSH 协同';
  statusBar.tooltip = '点击打开 DSH ↔ Antigravity 双向协同台';
  statusBar.show();
  context.subscriptions.push(statusBar);

  let notifiedTaskIds = new Set();

  function updateStatusBar(data) {
    if (!data || !data.ok) {
      statusBar.text = '$(debug-disconnect) DSH 协同: 离线';
      statusBar.backgroundColor = undefined;
      return;
    }
    const dshOn = Boolean(data.peers?.deepseek?.online);
    const pendingForAgy = (data.tasks || []).filter((t) => t.to === 'antigravity' && t.status === 'pending');

    if (pendingForAgy.length > 0) {
      statusBar.text = `$(bell-dot) DSH 协同 · ${pendingForAgy.length} 待审`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBar.tooltip = `收到 ${pendingForAgy.length} 条来自 DeepSeek Harness 的待审任务，点击打开侧边栏`;

      for (const task of pendingForAgy) {
        if (!notifiedTaskIds.has(task.id)) {
          notifiedTaskIds.add(task.id);
          void vscode.window
            .showInformationMessage(
              `DeepSeek Harness 发来待审任务：${task.title}`,
              '打开协同台',
              '复制接手指令'
            )
            .then((choice) => {
              if (choice === '打开协同台') {
                void vscode.commands.executeCommand('dshCollab.openSidebar');
              } else if (choice === '复制接手指令') {
                const msg = `请帮我处理来自 DeepSeek Harness 的协同任务（ID: ${task.id}，标题：${task.title}），先调用 dsh_collab_list_tasks 查看详情，审查后调用 dsh_collab_submit_review 回写结论。`;
                void vscode.env.clipboard.writeText(msg);
              }
            });
        }
      }
    } else {
      statusBar.backgroundColor = undefined;
      statusBar.text = dshOn ? '$(plug) DSH 协同: 在线' : '$(circle-outline) DSH 协同';
      statusBar.tooltip = dshOn
        ? 'DeepSeek Harness 已连接，点击打开双向协同台'
        : '协同中枢已就绪（等待 DSH 连接），点击打开侧边栏';
    }
  }

  const provider = new DshCollabSidebarProvider(context, updateStatusBar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dshCollab.sidebarView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dshCollab.openSidebar', () => {
      void vscode.commands.executeCommand('workbench.view.extension.dsh-collab-container');
    }),
    vscode.commands.registerCommand('dshCollab.refresh', () => {
      void provider.pushDashboard();
    }),
    vscode.commands.registerCommand('dshCollab.toggleAutoWake', async () => {
      const d = await hubRequest('/api/dashboard');
      const next = !d?.settings?.autoWakeAgy;
      await hubRequest('/api/settings', {
        method: 'PATCH',
        body: { autoWakeAgy: next, actor: 'vscode-command' },
      });
      vscode.window.showInformationMessage(`DSH 协同自动唤醒已${next ? '开启' : '关闭'}`);
      void provider.pushDashboard();
    }),
    vscode.commands.registerCommand('dshCollab.sendActiveFileToDsh', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('当前没有打开的编辑器文件');
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const base = path.basename(filePath);
      const prompt = await vscode.window.showInputBox({
        prompt: `将 ${base} 发送给 DeepSeek Harness 审查`,
        placeHolder: '可选：输入你希望 DeepSeek 重点关注的审查要点',
      });
      if (prompt === undefined) return;
      const selection = !editor.selection.isEmpty ? editor.document.getText(editor.selection).slice(0, 12_000) : '';
      const res = await hubRequest('/api/tasks', {
        method: 'POST',
        body: {
          title: `审查 ${base}`,
          kind: 'code_review',
          from: 'antigravity',
          to: 'deepseek',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '',
          files: [filePath],
          diff: selection,
          prompt: prompt || '请检查逻辑、边界条件与潜在缺陷。',
        },
      });
      if (res.ok) {
        vscode.window.showInformationMessage(`已将 ${base} 发给 DeepSeek 审查 (${res.task.id})`);
        void provider.pushDashboard();
      } else {
        vscode.window.showErrorMessage(`发送失败：${res.error}`);
      }
    })
  );

  // Poll hub for status bar updates & incoming DeepSeek tasks
  const poll = async () => {
    const data = await hubRequest('/api/dashboard');
    updateStatusBar(data);
    if (provider.view?.visible) {
      provider.post({ type: 'dashboard', data });
    }
  };
  void poll();
  const timer = setInterval(poll, 6_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {}

module.exports = { activate, deactivate };
