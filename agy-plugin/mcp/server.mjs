import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHubServer, HUB_HOST, HUB_PORT } from '../../hub/server.mjs';
import { getOrCreateToken } from '../../hub/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.resolve(__dirname, '../ui/index.html');
const APP_URI = 'ui://dsh-collab/app.html';
const HUB_BASE = `http://${HUB_HOST}:${HUB_PORT}`;
const TOKEN = getOrCreateToken();

let localHub = null;

async function ensureHubRunning() {
  try {
    const r = await fetch(`${HUB_BASE}/health`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) return;
  } catch {
    // not running yet
  }
  try {
    localHub = createHubServer({ port: HUB_PORT });
    await localHub.start();
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') {
      console.error('[dsh-collab-mcp] hub start error:', err);
    }
  }
}

async function hubFetch(pathname, { method = 'GET', body } = {}) {
  await ensureHubRunning();
  const res = await fetch(`${HUB_BASE}${pathname}`, {
    method,
    headers: {
      'x-collab-token': TOKEN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, error: text.slice(0, 400) };
  }
}

async function sendHeartbeat() {
  try {
    const wakeEndpoint =
      process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN
        ? {
            address: process.env.ANTIGRAVITY_LS_ADDRESS,
            csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
            projectId: process.env.ANTIGRAVITY_PROJECT_ID || '',
          }
        : undefined;
    await hubFetch('/api/heartbeat', {
      method: 'POST',
      body: {
        peer: 'antigravity',
        meta: { pid: process.pid, ui: 'mcp-app' },
        ...(wakeEndpoint ? { wakeEndpoint } : {}),
      },
    });
  } catch {
    // ignore transient heartbeat failure
  }
}

function readUiHtml() {
  if (fs.existsSync(UI_HTML_PATH)) {
    return fs.readFileSync(UI_HTML_PATH, 'utf8');
  }
  return '<!doctype html><html><body style="font-family:sans-serif;padding:16px">UI 未构建，请运行 npm run build:ui</body></html>';
}

const PANE_META = {
  ui: { resourceUri: APP_URI },
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: 'DSH 协同台' },
      { type: 'global', title: 'DSH 协同台' },
    ],
  },
};

const INLINE_META = {
  ui: { resourceUri: APP_URI },
};

const APP_ONLY_META = {
  ui: { visibility: ['app'] },
};

const server = new McpServer({
  name: 'dsh-collab-hub',
  version: '0.1.0',
});

// UI Resource
server.registerResource(
  'dsh-collab-app',
  APP_URI,
  {
    title: 'DSH 双向协同台',
    description: 'Antigravity 与 DeepSeek Harness (dsh) 双向协同可视化控制台',
    mimeType: 'text/html;profile=mcp-app',
    _meta: { ui: { prefersBorder: false } },
  },
  async () => ({
    contents: [
      {
        uri: APP_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: readUiHtml(),
      },
    ],
  })
);

// 1. Entrypoint tool for side pane + global sidebar + model opening
server.registerTool(
  'dsh_collab_open',
  {
    title: 'DSH 协同台',
    description: '打开或刷新 Antigravity 与 DeepSeek Harness (dsh) 双向协同可视化面板，展示在线状态、双向任务流、记忆搜索和 dsh 插件台。',
    inputSchema: {
      tab: z.enum(['tasks', 'memory', 'plugins', 'settings']).optional().describe('默认打开的标签页'),
    },
    _meta: PANE_META,
  },
  async ({ tab } = {}) => {
    await sendHeartbeat();
    const dashboard = await hubFetch('/api/dashboard');
    const pendingForAgy = (dashboard.tasks || []).filter((t) => t.to === 'antigravity' && t.status === 'pending').length;
    const pendingForDsh = (dashboard.tasks || []).filter((t) => t.to === 'deepseek' && t.status === 'pending').length;
    return {
      content: [
        {
          type: 'text',
          text: `DSH 协同台已就绪。DeepSeek Harness: ${dashboard.peers?.deepseek?.online ? '在线' : '离线'}；待我处理: ${pendingForAgy} 条；待 DeepSeek 处理: ${pendingForDsh} 条；已检测到 ${dashboard.dshPlugins?.length || 0} 个 dsh 插件。`,
        },
      ],
      structuredContent: { ...dashboard, initialTab: tab || 'tasks' },
    };
  }
);

// 2. Status tool
server.registerTool(
  'dsh_collab_status',
  {
    title: '查看协同状态',
    description: '获取协同中枢状态、DeepSeek Harness 在线心跳、待处理任务数量及已安装的 dsh 插件概览。',
    inputSchema: {},
  },
  async () => {
    await sendHeartbeat();
    const dashboard = await hubFetch('/api/dashboard');
    return {
      content: [{ type: 'text', text: JSON.stringify(dashboard, null, 2) }],
      structuredContent: dashboard,
    };
  }
);

// 3. Create bidirectional task
server.registerTool(
  'dsh_collab_create_task',
  {
    title: '发起双向协同任务',
    description: '向 DeepSeek Harness 发起代码审查、编码委派或技术讨论任务，同步显示在双端可视化面板中。',
    inputSchema: {
      title: z.string().describe('任务标题，例如“审查登录态刷新逻辑”'),
      kind: z.enum(['code_review', 'implement', 'discuss', 'plugin_call']).optional().describe('任务类型，默认 code_review'),
      to: z.enum(['deepseek', 'antigravity']).optional().describe('目标执行方，默认 deepseek'),
      workspace: z.string().optional().describe('项目根目录绝对路径'),
      files: z.array(z.string()).optional().describe('涉及的文件路径列表'),
      diff: z.string().optional().describe('可选的代码 diff 或关键片段'),
      prompt: z.string().optional().describe('具体要求或审查重点'),
    },
    _meta: INLINE_META,
  },
  async (args) => {
    const res = await hubFetch('/api/tasks', {
      method: 'POST',
      body: {
        ...args,
        from: 'antigravity',
        to: args.to || 'deepseek',
      },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return {
      content: [
        {
          type: 'text',
          text: res.ok
            ? `已创建协同任务 ${res.task.id}（${res.task.from} -> ${res.task.to}）：${res.task.title}`
            : `创建任务失败：${res.error}`,
        },
      ],
      structuredContent: { ...dashboard, highlightTaskId: res.task?.id },
    };
  }
);

// 4. List tasks
server.registerTool(
  'dsh_collab_list_tasks',
  {
    title: '列出协同任务',
    description: '查询双向协同任务队列，可按目标方（antigravity/deepseek）或状态过滤。',
    inputSchema: {
      to: z.enum(['antigravity', 'deepseek']).optional(),
      status: z.enum(['pending', 'in_progress', 'changes_requested', 'approved', 'done', 'rejected']).optional(),
    },
  },
  async ({ to, status } = {}) => {
    const qs = new URLSearchParams();
    if (to) qs.set('to', to);
    if (status) qs.set('status', status);
    const res = await hubFetch(`/api/tasks${qs.toString() ? `?${qs}` : ''}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    };
  }
);

// 5. Submit review
server.registerTool(
  'dsh_collab_submit_review',
  {
    title: '提交代码审查结论',
    description: '对 DeepSeek 提交的代码任务发表审查意见（approved / changes_requested / commented）与具体批注，并同步回写到 DSH 端。',
    inputSchema: {
      taskId: z.string().describe('任务 ID'),
      verdict: z.enum(['approved', 'changes_requested', 'commented']).describe('审查结论'),
      summary: z.string().describe('总体审查摘要'),
      comments: z
        .array(
          z.object({
            file: z.string().optional(),
            line: z.number().optional(),
            severity: z.enum(['info', 'warning', 'error']).optional(),
            message: z.string(),
          })
        )
        .optional()
        .describe('逐条批注'),
    },
    _meta: INLINE_META,
  },
  async ({ taskId, verdict, summary, comments }) => {
    const res = await hubFetch(`/api/tasks/${encodeURIComponent(taskId)}/review`, {
      method: 'POST',
      body: { reviewer: 'antigravity', verdict, summary, comments: comments || [] },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return {
      content: [
        {
          type: 'text',
          text: res.ok
            ? `已向任务 ${taskId} 提交审查结论 [${verdict}]：${summary}`
            : `提交审查失败：${res.error}`,
        },
      ],
      structuredContent: { ...dashboard, highlightTaskId: taskId },
    };
  }
);

// 6. Search DSH memory
server.registerTool(
  'dsh_collab_memory_search',
  {
    title: '检索 DSH 记忆',
    description: '检索 DeepSeek Harness 本地记忆目录（~/.dsh/memory 与 .dsh-memory/data/mdcg），即使 DSH 离线也可用。',
    inputSchema: {
      query: z.string().describe('搜索关键词，为空则返回最新记忆条目'),
      scope: z.enum(['all', 'dsh', 'mdcg']).optional().describe('检索范围，默认 all'),
      limit: z.number().optional().describe('返回条数上限，默认 10'),
    },
  },
  async ({ query, scope = 'all', limit = 10 }) => {
    const qs = new URLSearchParams({ q: query || '', scope, limit: String(limit) });
    const res = await hubFetch(`/api/memory/search?${qs}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    };
  }
);

// 7. List DSH plugins
server.registerTool(
  'dsh_collab_plugin_list',
  {
    title: '列出 DSH 插件',
    description: '列出本机 DeepSeek Harness 已安装的插件及运行时服务。',
    inputSchema: {},
  },
  async () => {
    const res = await hubFetch('/api/dsh/plugins');
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    };
  }
);

// 8. Call DSH plugin via bridge
server.registerTool(
  'dsh_collab_plugin_call',
  {
    title: '调用 DSH 插件',
    description: '通过 DSH Host 桥接插件调用 DeepSeek Harness 中已安装的插件能力（如 host.list_services、quota-balance.status、http.get 本机回环接口）。',
    inputSchema: {
      plugin: z.string().describe('插件名，例如 host / quota-balance / http'),
      action: z.string().describe('操作名，例如 list_services / status / get'),
      params: z.record(z.any()).optional().describe('可选参数对象'),
    },
  },
  async ({ plugin, action, params }) => {
    const res = await hubFetch('/api/dsh/call', {
      method: 'POST',
      body: { plugin, action, params: params || {} },
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    };
  }
);

// --- App-only tools for interactive UI ---

server.registerTool(
  'app_get_dashboard',
  {
    title: 'Get Dashboard (App)',
    description: 'Fetch latest dashboard data for UI',
    inputSchema: {},
    _meta: APP_ONLY_META,
  },
  async () => {
    await sendHeartbeat();
    const dashboard = await hubFetch('/api/dashboard');
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: dashboard };
  }
);

server.registerTool(
  'app_create_task',
  {
    title: 'Create Task (App)',
    description: 'Create task from UI',
    inputSchema: {
      title: z.string(),
      kind: z.string().optional(),
      to: z.string().optional(),
      workspace: z.string().optional(),
      files: z.array(z.string()).optional(),
      prompt: z.string().optional(),
      diff: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (args) => {
    const res = await hubFetch('/api/tasks', {
      method: 'POST',
      body: { ...args, from: 'antigravity' },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: { ...dashboard, lastResult: res } };
  }
);

server.registerTool(
  'app_update_task_status',
  {
    title: 'Update Task Status (App)',
    description: 'Update task status from UI',
    inputSchema: {
      taskId: z.string(),
      status: z.string(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ taskId, status }) => {
    await hubFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: { status, actor: 'antigravity-ui' },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: dashboard };
  }
);

server.registerTool(
  'app_submit_review',
  {
    title: 'Submit Review (App)',
    description: 'Submit review from UI',
    inputSchema: {
      taskId: z.string(),
      verdict: z.string(),
      summary: z.string(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ taskId, verdict, summary }) => {
    await hubFetch(`/api/tasks/${encodeURIComponent(taskId)}/review`, {
      method: 'POST',
      body: { reviewer: 'antigravity', verdict, summary, comments: [] },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: dashboard };
  }
);

server.registerTool(
  'app_search_memory',
  {
    title: 'Search Memory (App)',
    description: 'Search DSH memory from UI',
    inputSchema: {
      query: z.string(),
      scope: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ query, scope = 'all' }) => {
    const qs = new URLSearchParams({ q: query || '', scope, limit: '15' });
    const res = await hubFetch(`/api/memory/search?${qs}`);
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: res };
  }
);

server.registerTool(
  'app_call_plugin',
  {
    title: 'Call DSH Plugin (App)',
    description: 'Call DSH plugin from UI',
    inputSchema: {
      plugin: z.string(),
      action: z.string(),
      params: z.record(z.any()).optional(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ plugin, action, params }) => {
    const res = await hubFetch('/api/dsh/call', {
      method: 'POST',
      body: { plugin, action, params: params || {} },
    });
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: res };
  }
);

server.registerTool(
  'app_update_settings',
  {
    title: 'Update Settings (App)',
    description: 'Update hub settings from UI',
    inputSchema: {
      autoWakeAgy: z.boolean().optional(),
      autoWakeDsh: z.boolean().optional(),
      autoWakeCommand: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (args) => {
    await hubFetch('/api/settings', {
      method: 'PATCH',
      body: { ...args, actor: 'antigravity-ui' },
    });
    const dashboard = await hubFetch('/api/dashboard');
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: dashboard };
  }
);

await ensureHubRunning();
await sendHeartbeat();
const hbTimer = setInterval(sendHeartbeat, 15_000);
hbTimer.unref?.();

const transport = new StdioServerTransport();
await server.connect(transport);
