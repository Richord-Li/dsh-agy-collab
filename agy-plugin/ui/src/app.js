import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'DSH 协同台', version: '0.1.0' }, {});

let state = {
  tab: 'tasks',
  filter: 'all',
  dashboard: null,
  memoryHits: null,
  pluginResult: null,
  selectedTaskId: null,
  busy: false,
  toast: '',
  canMessage: false,
  canUpdateContext: false,
};

function showToast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => {
    if (state.toast === msg) {
      state.toast = '';
      render();
    }
  }, 3000);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const STATUS_LABEL = {
  pending: '待处理',
  in_progress: '进行中',
  changes_requested: '需修改',
  approved: '已通过',
  done: '已完成',
  rejected: '已驳回',
};

const KIND_LABEL = {
  code_review: '代码审查',
  implement: '编码实现',
  discuss: '架构讨论',
  plugin_call: '插件调用',
};

async function refreshDashboard() {
  state.busy = true;
  render();
  try {
    const res = await app.callServerTool({ name: 'app_get_dashboard', arguments: {} });
    if (res?.structuredContent) {
      state.dashboard = res.structuredContent;
    }
  } catch (err) {
    showToast(`刷新失败: ${err?.message || err}`);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleCreateTask(form) {
  const title = form.querySelector('[name="title"]').value.trim();
  const kind = form.querySelector('[name="kind"]').value;
  const workspace = form.querySelector('[name="workspace"]').value.trim();
  const filesRaw = form.querySelector('[name="files"]').value.trim();
  const prompt = form.querySelector('[name="prompt"]').value.trim();
  if (!title) {
    showToast('请填写任务标题');
    return;
  }
  const files = filesRaw ? filesRaw.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean) : [];
  state.busy = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_create_task',
      arguments: { title, kind, to: 'deepseek', workspace, files, prompt },
    });
    if (res?.structuredContent) state.dashboard = res.structuredContent;
    showToast('已发送给 DeepSeek Harness');
  } catch (err) {
    showToast(`创建失败: ${err?.message || err}`);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleTakeoverTask(task) {
  const text = [
    `请帮我处理来自 DeepSeek Harness 的协同任务（ID: ${task.id}）：`,
    `- 标题：${task.title}`,
    `- 类型：${KIND_LABEL[task.kind] || task.kind}`,
    task.workspace ? `- 工作区：${task.workspace}` : '',
    task.files?.length ? `- 涉及文件：${task.files.join(', ')}` : '',
    task.prompt ? `- 说明：${task.prompt}` : '',
    `请先调用 dsh_collab_list_tasks 查看完整 Diff/上下文，完成审查或处理后调用 dsh_collab_submit_review 回写给 DeepSeek。`,
  ]
    .filter(Boolean)
    .join('\n');

  if (state.canMessage) {
    try {
      await app.callServerTool({
        name: 'app_update_task_status',
        arguments: { taskId: task.id, status: 'in_progress' },
      });
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text }],
      });
      showToast('已转交给当前对话处理');
      await refreshDashboard();
      return;
    } catch (err) {
      showToast(`发送失败: ${err?.message || err}`);
    }
  } else {
    try {
      await navigator.clipboard?.writeText(text);
      showToast('全局视图无法直接发消息，已复制任务指令到剪贴板');
    } catch {
      showToast('请在对话侧边栏中点击接手');
    }
  }
}

async function handleSearchMemory(query, scope) {
  state.busy = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_search_memory',
      arguments: { query, scope },
    });
    state.memoryHits = res?.structuredContent || { hits: [] };
  } catch (err) {
    showToast(`检索失败: ${err?.message || err}`);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleAttachMemory(hit) {
  if (!state.canUpdateContext) {
    showToast('当前视图不支持附加到对话上下文');
    return;
  }
  try {
    await app.updateModelContext({
      content: [
        {
          type: 'text',
          text: `[来自 DSH 记忆 ${hit.source}:${hit.relPath}]\n${hit.excerpt}`,
        },
      ],
    });
    showToast('已附加到下一条消息上下文');
  } catch (err) {
    showToast(`附加失败: ${err?.message || err}`);
  }
}

async function handleCallPlugin(plugin, action, paramsText) {
  let params = {};
  if (paramsText && paramsText.trim()) {
    try {
      params = JSON.parse(paramsText);
    } catch {
      showToast('参数必须是合法 JSON');
      return;
    }
  }
  state.busy = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_call_plugin',
      arguments: { plugin, action, params },
    });
    state.pluginResult = res?.structuredContent || res;
  } catch (err) {
    state.pluginResult = { ok: false, error: String(err?.message || err) };
  } finally {
    state.busy = false;
    render();
  }
}

async function handleSaveSettings(autoWakeAgy, autoWakeCommand) {
  state.busy = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_update_settings',
      arguments: { autoWakeAgy, autoWakeCommand },
    });
    if (res?.structuredContent) state.dashboard = res.structuredContent;
    showToast('设置已保存');
  } catch (err) {
    showToast(`保存失败: ${err?.message || err}`);
  } finally {
    state.busy = false;
    render();
  }
}

function renderTasksTab(d) {
  const tasks = d?.tasks || [];
  const filtered = tasks.filter((t) => {
    if (state.filter === 'to_agy') return t.to === 'antigravity';
    if (state.filter === 'to_dsh') return t.to === 'deepseek';
    if (state.filter === 'pending') return t.status === 'pending' || t.status === 'changes_requested';
    return true;
  });

  const taskCards = filtered.length
    ? filtered
        .map((t) => {
          const isOpen = state.selectedTaskId === t.id;
          const dirText = t.from === 'deepseek' ? 'DeepSeek → 我' : '我 → DeepSeek';
          const reviewsHtml = (t.reviews || [])
            .map(
              (r) => `
              <div class="review-box">
                <div class="review-head">
                  <span class="badge badge-${escapeHtml(r.verdict)}">${escapeHtml(r.verdict)}</span>
                  <span>${r.reviewer === 'deepseek' ? 'DeepSeek' : 'Antigravity'}</span>
                  <span class="muted">${formatTime(r.createdAt)}</span>
                </div>
                <div class="review-body">${escapeHtml(r.summary)}</div>
              </div>`
            )
            .join('');

          return `
            <div class="card task-card" data-task-id="${escapeHtml(t.id)}">
              <div class="task-head">
                <div class="task-title-row">
                  <span class="badge badge-dir">${dirText}</span>
                  <span class="badge badge-${escapeHtml(t.status)}">${STATUS_LABEL[t.status] || escapeHtml(t.status)}</span>
                  <span class="muted small">${KIND_LABEL[t.kind] || escapeHtml(t.kind)} · ${formatTime(t.updatedAt)}</span>
                </div>
                <div class="task-title">${escapeHtml(t.title)}</div>
              </div>
              <div class="task-actions">
                ${
                  t.to === 'antigravity'
                    ? `<button class="btn btn-primary btn-sm" data-action="takeover" data-id="${escapeHtml(t.id)}">交给当前对话审查</button>`
                    : ''
                }
                <button class="btn btn-sm" data-action="toggle" data-id="${escapeHtml(t.id)}">${isOpen ? '收起详情' : '查看详情'}</button>
                ${
                  t.status !== 'done'
                    ? `<button class="btn btn-sm" data-action="mark-done" data-id="${escapeHtml(t.id)}">标记完成</button>`
                    : ''
                }
              </div>
              ${
                isOpen
                  ? `<div class="task-detail">
                      ${t.workspace ? `<div class="kv"><span>工作区</span><code>${escapeHtml(t.workspace)}</code></div>` : ''}
                      ${t.files?.length ? `<div class="kv"><span>文件</span><code>${escapeHtml(t.files.join(', '))}</code></div>` : ''}
                      ${t.prompt ? `<div class="prompt-box">${escapeHtml(t.prompt)}</div>` : ''}
                      ${t.diff ? `<pre class="diff-box">${escapeHtml(t.diff.slice(0, 4000))}</pre>` : ''}
                      ${reviewsHtml ? `<div class="reviews-wrap"><div class="section-sub">审查记录</div>${reviewsHtml}</div>` : '<div class="muted small">暂无审查记录</div>'}
                    </div>`
                  : ''
              }
            </div>`;
        })
        .join('')
    : '<div class="empty">当前筛选条件下暂无协同任务</div>';

  return `
    <div class="toolbar">
      <div class="chips">
        <button class="chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all">全部 (${tasks.length})</button>
        <button class="chip ${state.filter === 'to_agy' ? 'active' : ''}" data-filter="to_agy">发给我的 (${tasks.filter((t) => t.to === 'antigravity').length})</button>
        <button class="chip ${state.filter === 'to_dsh' ? 'active' : ''}" data-filter="to_dsh">发给 DeepSeek (${tasks.filter((t) => t.to === 'deepseek').length})</button>
        <button class="chip ${state.filter === 'pending' ? 'active' : ''}" data-filter="pending">待处理</button>
      </div>
    </div>

    <details class="card create-box">
      <summary>+ 发起新任务给 DeepSeek Harness</summary>
      <form id="create-task-form" class="form-grid">
        <input name="title" placeholder="任务标题，如：审查新建 API 鉴权逻辑" required />
        <div class="row-2">
          <select name="kind">
            <option value="code_review">代码审查</option>
            <option value="implement">编码委派</option>
            <option value="discuss">架构讨论</option>
          </select>
          <input name="workspace" placeholder="工作区路径（可选）" />
        </div>
        <input name="files" placeholder="涉及文件路径（逗号或换行分隔，可选）" />
        <textarea name="prompt" rows="3" placeholder="审查重点或任务说明..."></textarea>
        <button type="submit" class="btn btn-primary">发送到协同中枢</button>
      </form>
    </details>

    <div class="list">${taskCards}</div>
  `;
}

function renderMemoryTab(d) {
  const ov = d?.memory || {};
  const hits = state.memoryHits?.hits || [];
  return `
    <div class="card">
      <div class="small muted">DSH 文件记忆: <b>${ov.dshMemoryFileCount ?? 0}</b> 个 · 灵枢 MDCG 节点文件: <b>${ov.mdcgFileCount ?? 0}</b> 个（离线直读可用）</div>
      <form id="memory-search-form" class="row-search">
        <input name="query" placeholder="输入关键词搜索 DeepSeek 记忆（留空列最新）" value="${escapeHtml(state.memoryHits?.query || '')}" />
        <select name="scope">
          <option value="all">全部</option>
          <option value="dsh">DSH Memory</option>
          <option value="mdcg">DSH MDCG</option>
        </select>
        <button type="submit" class="btn btn-primary">搜索</button>
      </form>
    </div>
    <div class="list">
      ${
        state.memoryHits === null
          ? '<div class="empty">输入关键词点击搜索，即可检索 DeepSeek Harness 的历史记忆</div>'
          : hits.length === 0
            ? '<div class="empty">未找到匹配记忆</div>'
            : hits
                .map(
                  (h, i) => `
                  <div class="card">
                    <div class="task-title-row">
                      <span class="badge badge-dir">${escapeHtml(h.source)}</span>
                      <code class="small">${escapeHtml(h.relPath)}</code>
                    </div>
                    <div class="prompt-box">${escapeHtml(h.excerpt)}</div>
                    <div class="task-actions">
                      <button class="btn btn-sm" data-action="attach-mem" data-idx="${i}">附加到对话上下文</button>
                    </div>
                  </div>`
                )
                .join('')
      }
    </div>
  `;
}

function renderPluginsTab(d) {
  const plugins = d?.dshPlugins || [];
  const dshOnline = Boolean(d?.peers?.deepseek?.online);
  return `
    <div class="card">
      <div class="task-title-row">
        <span class="dot ${dshOnline ? 'dot-on' : 'dot-off'}"></span>
        <span>DSH 桥接状态：<b>${dshOnline ? '在线（可实时调用插件）' : '离线（请在 DSH 安装并启用 dsh-plugin-agy-collab）'}</b></span>
      </div>
      <div class="quick-calls">
        <button class="btn btn-sm" data-quick-plugin="host" data-quick-action="list_services">探测 DSH 服务</button>
        <button class="btn btn-sm" data-quick-plugin="quota-balance" data-quick-action="status">查询余额插件</button>
      </div>
      <form id="plugin-call-form" class="form-grid" style="margin-top:10px">
        <div class="row-2">
          <input name="plugin" placeholder="插件名，如 quota-balance / host" value="host" />
          <input name="action" placeholder="动作，如 status / list_services" value="list_services" />
        </div>
        <input name="params" placeholder='JSON 参数（可选），如 {"path":"/plugin/quota-balance/status"}' />
        <button type="submit" class="btn btn-primary">调用 DSH 插件</button>
      </form>
      ${state.pluginResult ? `<pre class="diff-box" style="margin-top:10px">${escapeHtml(JSON.stringify(state.pluginResult, null, 2))}</pre>` : ''}
    </div>

    <div class="list">
      ${plugins
        .map(
          (p) => `
          <div class="card plugin-row">
            <div>
              <div class="task-title">${escapeHtml(p.name)}</div>
              <div class="muted small">${escapeHtml(p.versionSpec)} · ${escapeHtml(p.source)}</div>
            </div>
            <span class="badge ${p.enabled ? 'badge-approved' : 'badge-pending'}">${p.enabled ? '已启用' : '未启用'}</span>
          </div>`
        )
        .join('')}
    </div>
  `;
}

function renderSettingsTab(d) {
  const s = d?.settings || {};
  const logs = d?.logs || [];
  return `
    <div class="card">
      <div class="section-sub">触发模式配置</div>
      <form id="settings-form" class="form-grid">
        <label class="switch-row">
          <input type="checkbox" name="autoWakeAgy" ${s.autoWakeAgy ? 'checked' : ''} />
          <span>开启全自动唤醒（当 DeepSeek 投递审查任务时自动执行本地唤醒命令）</span>
        </label>
        <input name="autoWakeCommand" placeholder="可选唤醒命令模板（支持 {{TASK_ID}} 和 {{TITLE}}）" value="${escapeHtml(s.autoWakeCommand || '')}" />
        <button type="submit" class="btn btn-primary">保存配置</button>
      </form>
      <div class="muted small" style="margin-top:8px">
        Hub 地址：<code>http://${escapeHtml(d?.hub?.host || '127.0.0.1')}:${escapeHtml(d?.hub?.port || 47891)}</code>
      </div>
    </div>

    <div class="card">
      <div class="section-sub">协同事件日志</div>
      <div class="log-list">
        ${
          logs.length
            ? logs
                .map(
                  (l) => `
                  <div class="log-row">
                    <span class="muted">${formatTime(l.at)}</span>
                    <span class="badge badge-dir">${escapeHtml(l.actor)}</span>
                    <span>${escapeHtml(l.event)}</span>
                    <span class="muted">${escapeHtml(l.detail)}</span>
                  </div>`
                )
                .join('')
            : '<div class="muted small">暂无日志</div>'
        }
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  const d = state.dashboard;
  const agyOn = Boolean(d?.peers?.antigravity?.online);
  const dshOn = Boolean(d?.peers?.deepseek?.online);

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-title">DSH 双向协同台</div>
        <div class="status-pills">
          <span class="pill"><span class="dot ${agyOn ? 'dot-on' : 'dot-off'}"></span>AGY</span>
          <span class="pill"><span class="dot ${dshOn ? 'dot-on' : 'dot-off'}"></span>DSH</span>
        </div>
      </div>
      <button class="btn btn-sm" id="btn-refresh" ${state.busy ? 'disabled' : ''}>${state.busy ? '同步中...' : '刷新'}</button>
    </header>

    <nav class="tabs">
      <button class="tab ${state.tab === 'tasks' ? 'active' : ''}" data-tab="tasks">双向任务</button>
      <button class="tab ${state.tab === 'memory' ? 'active' : ''}" data-tab="memory">DSH 记忆</button>
      <button class="tab ${state.tab === 'plugins' ? 'active' : ''}" data-tab="plugins">DSH 插件</button>
      <button class="tab ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">设置与日志</button>
    </nav>

    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}

    <main class="content">
      ${
        state.tab === 'tasks'
          ? renderTasksTab(d)
          : state.tab === 'memory'
            ? renderMemoryTab(d)
            : state.tab === 'plugins'
              ? renderPluginsTab(d)
              : renderSettingsTab(d)
      }
    </main>
  `;

  bindEvents(root);
}

function bindEvents(root) {
  root.querySelector('#btn-refresh')?.addEventListener('click', refreshDashboard);

  root.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.tab;
      render();
    });
  });

  root.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      state.filter = el.dataset.filter;
      render();
    });
  });

  root.querySelector('#create-task-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleCreateTask(e.currentTarget);
  });

  root.querySelector('#memory-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.currentTarget.querySelector('[name="query"]').value;
    const scope = e.currentTarget.querySelector('[name="scope"]').value;
    handleSearchMemory(q, scope);
  });

  root.querySelector('#plugin-call-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const plugin = e.currentTarget.querySelector('[name="plugin"]').value.trim();
    const action = e.currentTarget.querySelector('[name="action"]').value.trim();
    const params = e.currentTarget.querySelector('[name="params"]').value;
    handleCallPlugin(plugin, action, params);
  });

  root.querySelectorAll('[data-quick-plugin]').forEach((el) => {
    el.addEventListener('click', () => {
      handleCallPlugin(el.dataset.quickPlugin, el.dataset.quickAction, '');
    });
  });

  root.querySelector('#settings-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const autoWakeAgy = e.currentTarget.querySelector('[name="autoWakeAgy"]').checked;
    const autoWakeCommand = e.currentTarget.querySelector('[name="autoWakeCommand"]').value;
    handleSaveSettings(autoWakeAgy, autoWakeCommand);
  });

  root.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      state.selectedTaskId = state.selectedTaskId === id ? null : id;
      render();
    });
  });

  root.querySelectorAll('[data-action="takeover"]').forEach((el) => {
    el.addEventListener('click', () => {
      const task = (state.dashboard?.tasks || []).find((t) => t.id === el.dataset.id);
      if (task) handleTakeoverTask(task);
    });
  });

  root.querySelectorAll('[data-action="mark-done"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const res = await app.callServerTool({
        name: 'app_update_task_status',
        arguments: { taskId: el.dataset.id, status: 'done' },
      });
      if (res?.structuredContent) state.dashboard = res.structuredContent;
      showToast('已标记为完成');
      render();
    });
  });

  root.querySelectorAll('[data-action="attach-mem"]').forEach((el) => {
    el.addEventListener('click', () => {
      const hit = state.memoryHits?.hits?.[Number(el.dataset.idx)];
      if (hit) handleAttachMemory(hit);
    });
  });
}

// Register handlers BEFORE connect()
app.ontoolinput = () => {
  state.busy = true;
  render();
};

app.ontoolresult = (result) => {
  state.busy = false;
  const sc = result?.structuredContent;
  if (sc && sc.hub) {
    state.dashboard = sc;
    if (sc.initialTab) state.tab = sc.initialTab;
    if (sc.highlightTaskId) state.selectedTaskId = sc.highlightTaskId;
  }
  render();
};

app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

async function boot() {
  render();
  await app.connect();
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  const caps = app.getHostCapabilities() || {};
  state.canMessage = Boolean(caps.message);
  state.canUpdateContext = Boolean(caps.updateModelContext);
  if (!state.dashboard) {
    await refreshDashboard();
  }
}

boot();
