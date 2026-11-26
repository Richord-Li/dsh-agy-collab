export function renderWebConsoleHtml(token) {
  const safeToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>DSH ↔ Antigravity 协同台</title>
  <style>
    :root {
      --bg: #1e1e1e; --bg-card: #252526; --bg-hover: #2d2d30;
      --fg: #e5e7eb; --muted: #9ca3af; --border: rgba(255,255,255,0.12);
      --accent: #38bdf8; --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 14px; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.45; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; background: var(--bg-card); border: 1px solid var(--border); font-size: 11px; font-weight: 500; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
    .off { background: #6b7280; }
    .tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 12px; }
    .tab { background: transparent; color: var(--muted); border: 1px solid transparent; padding: 5px 11px; border-radius: 7px; cursor: pointer; font-size: 12px; }
    .tab.active { background: var(--bg-card); color: var(--fg); border-color: var(--border); }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 11px 13px; margin-bottom: 10px; }
    .btn { background: var(--bg-hover); color: var(--fg); border: 1px solid var(--border); padding: 5px 10px; border-radius: 7px; cursor: pointer; font-size: 12px; }
    .btn:hover { filter: brightness(1.12); }
    .btn-pri { background: var(--accent); color: #0b1020; border-color: transparent; font-weight: 600; }
    .badge { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .b-dir { background: rgba(56,189,248,0.16); color: var(--accent); }
    .b-pending { background: rgba(245,158,11,0.18); color: var(--warn); }
    .b-approved, .b-done { background: rgba(34,197,94,0.18); color: var(--ok); }
    .b-changes_requested, .b-rejected { background: rgba(239,68,68,0.18); color: var(--err); }
    .b-in_progress { background: rgba(56,189,248,0.18); color: var(--accent); }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .grid { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    input, select, textarea { background: #141416; color: var(--fg); border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px; font: inherit; width: 100%; }
    pre { background: #141416; border: 1px solid var(--border); border-radius: 7px; padding: 8px; overflow: auto; max-height: 240px; font-size: 11px; }
    .muted { color: var(--muted); font-size: 11px; }
    .toast { background: var(--accent); color: #0b1020; padding: 6px 10px; border-radius: 7px; font-weight: 600; margin-bottom: 10px; }
    .empty { text-align: center; color: var(--muted); padding: 24px; }
    summary { cursor: pointer; font-weight: 600; font-size: 12px; }
  </style>
</head>
<body>
  <div id="root">加载中...</div>
  <script>
    const TOKEN = ${safeToken};
    const S = { tab: 'tasks', data: null, mem: null, pluginRes: null, toast: '' };

    function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function tip(msg) { S.toast = msg; render(); setTimeout(() => { if (S.toast === msg) { S.toast = ''; render(); } }, 2800); }

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        ...opts,
        headers: { 'x-collab-token': TOKEN, ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return res.json();
    }

    async function load() {
      S.data = await api('/api/dashboard');
      render();
    }

    function connectSse() {
      try {
        const es = new EventSource('/api/events?token=' + encodeURIComponent(TOKEN));
        es.addEventListener('update', () => load());
      } catch {}
    }

    function render() {
      const d = S.data || {};
      const agyOn = Boolean(d.peers?.antigravity?.online);
      const dshOn = Boolean(d.peers?.deepseek?.online);
      const tasks = d.tasks || [];
      const plugins = d.dshPlugins || [];
      const logs = d.logs || [];

      let body = '';
      if (S.tab === 'tasks') {
        body = \`
          <details class="card">
            <summary>+ 新建协同任务（发给 DeepSeek / Antigravity）</summary>
            <form id="f-task" class="grid">
              <input name="title" placeholder="任务标题，如：审查登录模块重构" required />
              <div class="grid2">
                <select name="to"><option value="deepseek">发给 DeepSeek 审查/处理</option><option value="antigravity">发给 Antigravity 审查/处理</option></select>
                <select name="kind"><option value="code_review">代码审查</option><option value="implement">编码委派</option><option value="discuss">架构讨论</option></select>
              </div>
              <input name="files" placeholder="涉及文件路径（逗号分隔，可选）" />
              <textarea name="prompt" rows="2" placeholder="说明或审查重点..."></textarea>
              <button class="btn btn-pri" type="submit">创建任务</button>
            </form>
          </details>
          \${tasks.length ? tasks.map(t => \`
            <div class="card">
              <div class="row" style="margin-bottom:5px">
                <span class="badge b-dir">\${t.from === 'deepseek' ? 'DeepSeek → AGY' : 'AGY → DeepSeek'}</span>
                <span class="badge b-\${esc(t.status)}">\${esc(t.status)}</span>
                <span class="muted">\${esc(t.id)}</span>
              </div>
              <div style="font-weight:600;margin-bottom:4px">\${esc(t.title)}</div>
              \${t.prompt ? \`<div class="muted" style="margin-bottom:6px;white-space:pre-wrap">\${esc(t.prompt)}</div>\` : ''}
              \${(t.reviews || []).map(r => \`<div class="card" style="margin:6px 0;padding:7px"><span class="badge b-\${esc(r.verdict)}">\${esc(r.verdict)}</span> <b>\${esc(r.reviewer)}</b>: \${esc(r.summary)}</div>\`).join('')}
              <div class="row" style="margin-top:6px">
                <button class="btn" data-copy="\${esc(t.id)}">复制接手指令给对话</button>
                \${t.status !== 'done' ? \`<button class="btn" data-done="\${esc(t.id)}">标记完成</button>\` : ''}
              </div>
            </div>\`).join('') : '<div class="empty">暂无协同任务</div>'}
        \`;
      } else if (S.tab === 'memory') {
        const hits = S.mem?.hits || [];
        body = \`
          <div class="card">
            <div class="muted" style="margin-bottom:6px">DSH 文件记忆：\${d.memory?.dshMemoryFileCount ?? 0} · 灵枢 MDCG：\${d.memory?.mdcgFileCount ?? 0}</div>
            <form id="f-mem" class="row">
              <input name="q" style="flex:1" placeholder="输入关键词搜索 DSH 记忆..." value="\${esc(S.mem?.query || '')}" />
              <button class="btn btn-pri" type="submit">搜索</button>
            </form>
          </div>
          \${hits.map(h => \`<div class="card"><div class="row"><span class="badge b-dir">\${esc(h.source)}</span><span class="muted">\${esc(h.relPath)}</span></div><div style="margin-top:5px">\${esc(h.excerpt)}</div></div>\`).join('')}
        \`;
      } else if (S.tab === 'plugins') {
        body = \`
          <div class="card">
            <div class="row" style="margin-bottom:8px">
              <button class="btn" data-call="host:list_services">探测 DSH 服务</button>
              <button class="btn" data-call="quota-balance:status">查余额插件</button>
            </div>
            \${S.pluginRes ? \`<pre>\${esc(JSON.stringify(S.pluginRes, null, 2))}</pre>\` : ''}
          </div>
          \${plugins.map(p => \`<div class="card row" style="justify-content:space-between"><div><b>\${esc(p.name)}</b> <span class="muted">\${esc(p.versionSpec)}</span></div><span class="badge \${p.enabled ? 'b-approved' : 'b-pending'}">\${p.enabled ? '已启用' : '未启用'}</span></div>\`).join('')}
        \`;
      } else {
        body = \`
          <div class="card">
            <form id="f-set" class="grid">
              <label class="row"><input type="checkbox" name="autoWakeAgy" style="width:auto" \${d.settings?.autoWakeAgy ? 'checked' : ''} /> 开启自动唤醒（DeepSeek 投递任务时触发本地命令）</label>
              <input name="autoWakeCommand" placeholder="可选唤醒命令模板，支持 {{TASK_ID}} 和 {{TITLE}}" value="\${esc(d.settings?.autoWakeCommand || '')}" />
              <button class="btn btn-pri" type="submit">保存设置</button>
            </form>
          </div>
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px">实时事件日志</div>
            \${logs.map(l => \`<div class="muted" style="margin-bottom:4px">[\${new Date(l.at).toLocaleTimeString()}] <b>\${esc(l.actor)}</b> \${esc(l.event)} — \${esc(l.detail)}</div>\`).join('') || '<div class="muted">暂无日志</div>'}
          </div>
        \`;
      }

      document.getElementById('root').innerHTML = \`
        <div class="top">
          <div class="brand">
            DSH ↔ Antigravity 协同台
            <span class="pill"><span class="dot \${agyOn ? 'on' : 'off'}"></span>AGY</span>
            <span class="pill"><span class="dot \${dshOn ? 'on' : 'off'}"></span>DSH</span>
          </div>
          <button class="btn" id="btn-ref">刷新</button>
        </div>
        <div class="tabs">
          <button class="tab \${S.tab==='tasks'?'active':''}" data-tab="tasks">双向任务 (\${tasks.length})</button>
          <button class="tab \${S.tab==='memory'?'active':''}" data-tab="memory">DSH 记忆</button>
          <button class="tab \${S.tab==='plugins'?'active':''}" data-tab="plugins">DSH 插件 (\${plugins.length})</button>
          <button class="tab \${S.tab==='settings'?'active':''}" data-tab="settings">设置与日志</button>
        </div>
        \${S.toast ? \`<div class="toast">\${esc(S.toast)}</div>\` : ''}
        \${body}
      \`;

      document.getElementById('btn-ref').onclick = load;
      document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); });
      document.getElementById('f-task')?.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const to = fd.get('to');
        const files = String(fd.get('files') || '').split(/[,\\n]+/).map(s=>s.trim()).filter(Boolean);
        await api('/api/tasks', { method: 'POST', body: { title: fd.get('title'), kind: fd.get('kind'), from: to === 'deepseek' ? 'antigravity' : 'deepseek', to, files, prompt: fd.get('prompt') } });
        tip('任务已创建');
        load();
      });
      document.getElementById('f-mem')?.addEventListener('submit', async e => {
        e.preventDefault();
        const q = new FormData(e.target).get('q') || '';
        S.mem = await api('/api/memory/search?q=' + encodeURIComponent(q));
        render();
      });
      document.getElementById('f-set')?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        await api('/api/settings', { method: 'PATCH', body: { autoWakeAgy: f.autoWakeAgy.checked, autoWakeCommand: f.autoWakeCommand.value } });
        tip('设置已保存');
        load();
      });
      document.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
        await api('/api/tasks/' + encodeURIComponent(b.dataset.done), { method: 'PATCH', body: { status: 'done' } });
        tip('已标记完成');
        load();
      });
      document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
        const t = tasks.find(x => x.id === b.dataset.copy);
        if (!t) return;
        const msg = t.to === 'antigravity'
          ? \`请处理来自 DeepSeek 的协同任务 \${t.id}（\${t.title}），先调用 dsh_collab_list_tasks 查看详情，审查后调用 dsh_collab_submit_review 回写结论。\`
          : \`请审查来自 Antigravity 的协同任务 \${t.id}（\${t.title}），先调用 agy_list_tasks 查看详情，审查后调用 agy_submit_review 回写结论。\`;
        navigator.clipboard?.writeText(msg);
        tip('已复制指令，粘贴到对应对话即可');
      });
      document.querySelectorAll('[data-call]').forEach(b => b.onclick = async () => {
        const [plugin, action] = b.dataset.call.split(':');
        S.pluginRes = await api('/api/dsh/call', { method: 'POST', body: { plugin, action } });
        render();
      });
    }

    load();
    connectSse();
  </script>
</body>
</html>`;
}
