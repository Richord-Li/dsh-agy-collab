/**
 * Host half of dsh-plugin-agy-collab.
 *
 * 1. Connects to the local Antigravity <-> DSH Collab Hub (127.0.0.1:47891).
 * 2. Registers same-origin routes under /plugin/agy-collab/* for the DSH dock UI.
 * 3. Registers native DSH tools (agy_request_review, agy_list_tasks, agy_submit_review, agy_collab_status)
 *    when ctx.tools is present so DeepSeek can collaborate with Antigravity directly.
 * 4. Polls Hub for plugin-call RPC commands from Antigravity and executes them safely inside DSH Host.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'agy-collab';
export const inject = ['webServer'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_HOST = '127.0.0.1';
const HUB_PORT = Number(process.env.DSH_AGY_HUB_PORT) || 47891;
const HUB_BASE = `http://${HUB_HOST}:${HUB_PORT}`;
const TOKEN_CANDIDATES = [
  process.env.DSH_AGY_HUB_TOKEN_FILE,
  path.resolve(__dirname, '../data/hub-token'),
  path.join(os.homedir(), '.dsh-agy-collab', 'hub-token'),
].filter(Boolean);

function readHubToken() {
  for (const p of TOKEN_CANDIDATES) {
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

async function hubFetch(pathname, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const token = readHubToken();
  if (!token) {
    return { ok: false, error: '未找到协同中枢 hub-token，请先在 Antigravity 启用 dsh-collab 或启动 Hub' };
  }
  try {
    const res = await fetch(`${HUB_BASE}${pathname}`, {
      method,
      headers: {
        'x-collab-token': token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function readReqJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

function probeHostServices(ctx) {
  const known = ['webServer', 'tools', 'deepseekAccount', 'llm', 'session', 'subagent', 'timer'];
  return known.filter((k) => {
    try {
      return ctx.get(k) !== undefined;
    } catch {
      return false;
    }
  });
}

async function executeDshCommand(ctx, cmd) {
  const plugin = String(cmd.plugin || '').trim();
  const action = String(cmd.action || 'status').trim();

  if (plugin === 'host' && action === 'list_services') {
    return { ok: true, services: probeHostServices(ctx) };
  }

  if (plugin === 'quota-balance' && action === 'status') {
    const account = ctx.get('deepseekAccount');
    if (!account) return { ok: false, error: 'deepseekAccount 服务不可用' };
    try {
      const balance = await account.getBalance({
        version: '0.2.2-rc.1',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      });
      if (!balance) return { ok: false, error: '未登录 DeepSeek 账号' };
      return { ok: true, status: balance.status, wallets: balance.value ?? [], bonus: balance.bonusWallets ?? [] };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  if (plugin === 'http' && action === 'get') {
    const targetUrl = String(cmd.params?.url || '').trim();
    if (!targetUrl.startsWith('http://127.0.0.1:') && !targetUrl.startsWith('http://localhost:')) {
      return { ok: false, error: '安全限制：仅允许访问本机回环地址 (127.0.0.1 / localhost)' };
    }
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(2500) });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, error: `本机服务不可达: ${err?.message || err}` };
    }
  }

  return {
    ok: false,
    error: `未支持的插件调用: ${plugin}.${action}（当前支持 host.list_services, quota-balance.status, http.get）`,
  };
}

async function registerNativeTools(ctx) {
  const toolsSvc = ctx.get('tools');
  if (!toolsSvc || typeof toolsSvc.register !== 'function') return [];

  let defineTool;
  try {
    ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
  } catch {
    ctx.logger?.warn?.('agy-collab: @deepseek-ai/dsh-tools 不可用，跳过原生工具注册');
    return [];
  }

  const disposers = [];
  const register = (spec) => {
    disposers.push(toolsSvc.register(defineTool(spec)));
  };

  register({
    name: 'agy_request_review',
    description: '将你编写的代码、文件路径或 Diff 提交给 Antigravity 进行审查或协同处理，并同步显示在双端可视化面板中。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题，如“审查新增缓存层实现”' },
        kind: { type: 'string', description: '任务类型：code_review | implement | discuss，默认 code_review' },
        workspace: { type: 'string', description: '项目根目录路径' },
        files: { type: 'array', items: { type: 'string' }, description: '涉及的文件路径列表' },
        diff: { type: 'string', description: '可选的代码 diff 或关键代码片段' },
        prompt: { type: 'string', description: '希望 Antigravity 重点审查或处理的内容' },
      },
      required: ['title'],
    },
    output: {
      schema: { type: 'json' },
      render: (_args, val) => [{ type: 'text', text: JSON.stringify(val, null, 2) }],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await hubFetch('/api/tasks', {
        method: 'POST',
        body: { ...args, from: 'deepseek', to: 'antigravity' },
      });
    },
  });

  register({
    name: 'agy_list_tasks',
    description: '查看 Antigravity 与 DeepSeek 之间的双向协同任务列表（包括 Antigravity 发给你审查的代码任务以及最新批注）。',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '可选过滤目标：deepseek | antigravity' },
        status: { type: 'string', description: '可选过滤状态：pending | in_progress | changes_requested | approved | done' },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, val) => [{ type: 'text', text: JSON.stringify(val, null, 2) }],
    },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const qs = new URLSearchParams();
      if (args?.to) qs.set('to', args.to);
      if (args?.status) qs.set('status', args.status);
      return await hubFetch(`/api/tasks${qs.toString() ? `?${qs}` : ''}`);
    },
  });

  register({
    name: 'agy_submit_review',
    description: '对 Antigravity 发来的代码审查任务提交结构化审查意见（approved / changes_requested / commented）并回写给 Antigravity。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        verdict: { type: 'string', description: '审查结论：approved | changes_requested | commented' },
        summary: { type: 'string', description: '审查总结' },
      },
      required: ['taskId', 'verdict', 'summary'],
    },
    output: {
      schema: { type: 'json' },
      render: (_args, val) => [{ type: 'text', text: JSON.stringify(val, null, 2) }],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await hubFetch(`/api/tasks/${encodeURIComponent(args.taskId)}/review`, {
        method: 'POST',
        body: {
          reviewer: 'deepseek',
          verdict: args.verdict,
          summary: args.summary,
          comments: Array.isArray(args.comments) ? args.comments : [],
        },
      });
    },
  });

  register({
    name: 'agy_collab_status',
    description: '查询 Antigravity 双向协同中枢的在线状态与待办统计。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'json' },
      render: (_args, val) => [{ type: 'text', text: JSON.stringify(val, null, 2) }],
    },
    timeoutMs: 8000,
    isConcurrencySafe: () => true,
    async execute() {
      return await hubFetch('/api/dashboard');
    },
  });

  ctx.logger?.info?.(`agy-collab: 已注册 ${disposers.length} 个双向协同工具`);
  return disposers;
}

function readFileContext(files) {
  if (!Array.isArray(files) || files.length === 0) return '';
  const parts = [];
  for (const rawPath of files.slice(0, 6)) {
    try {
      const p = String(rawPath).trim();
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      const content = fs.readFileSync(p, 'utf8').slice(0, 12_000);
      parts.push(`--- FILE: ${p} ---\n${content}`);
    } catch {
      // ignore unreadable file
    }
  }
  return parts.join('\n\n');
}

function parseReviewJson(raw) {
  const cleaned = String(raw || '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const verdict = ['approved', 'changes_requested', 'commented'].includes(parsed.verdict)
        ? parsed.verdict
        : 'commented';
      return {
        verdict,
        summary: String(parsed.summary || cleaned).slice(0, 4000),
        comments: Array.isArray(parsed.comments) ? parsed.comments.slice(0, 20) : [],
      };
    } catch {
      // fallback below
    }
  }
  return {
    verdict: 'commented',
    summary: cleaned.slice(0, 4000) || 'DeepSeek 已完成自动审查，但未返回结构化内容。',
    comments: [],
  };
}

async function runAutoReviewInDsh(ctx, task) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, error: 'DSH llm 服务不可用，无法自动审查' };
  }

  let provider = 'deepseek-account';
  try {
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : [];
    const ids = providers.map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean);
    if (ids.length > 0 && !ids.includes(provider)) {
      provider = ids.find((id) => id.includes('deepseek')) || ids[0];
    }
  } catch {
    // keep default
  }

  const fileContext = readFileContext(task.files);
  const userText = [
    `请作为资深工程师，对来自 Antigravity 的协同任务进行审查或回复：`,
    `任务标题：${task.title}`,
    `任务类型：${task.kind}`,
    task.workspace ? `工作区：${task.workspace}` : '',
    task.prompt ? `审查重点/说明：\n${task.prompt}` : '',
    task.diff ? `代码 Diff / 片段：\n${task.diff.slice(0, 16_000)}` : '',
    fileContext ? `涉及文件内容：\n${fileContext}` : '',
    `请严格只输出一个 JSON 对象，格式如下：\n{"verdict":"approved"|"changes_requested"|"commented","summary":"简洁明确的中文审查总结","comments":[{"file":"可选文件名","severity":"info"|"warning"|"error","message":"具体问题或建议"}]}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const reviewModel = process.env.DSH_AGY_REVIEW_MODEL || 'deepseek-flash';
  let fullText = '';
  const stream = llm.stream({
    provider,
    model: reviewModel,
    system: '你是 DeepSeek Harness 自动代码审查员，负责与 Antigravity 协同互审代码。请客观、精准、简洁地给出审查结论，只输出合法 JSON（不要 Markdown 代码块包裹）。',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    maxTokens: 4096,
  });

  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      fullText += chunk.text;
    }
  }

  const review = parseReviewJson(fullText);
  return await hubFetch(`/api/tasks/${encodeURIComponent(task.id)}/review`, {
    method: 'POST',
    body: {
      reviewer: 'deepseek',
      verdict: review.verdict,
      summary: review.summary,
      comments: review.comments,
    },
    timeoutMs: 12_000,
  });
}

export function apply(ctx) {
  let toolDisposers = [];
  const processingTasks = new Set();

  // 1. Heartbeat + command polling + auto-review loop
  const sendHeartbeat = async () => {
    await hubFetch('/api/heartbeat', {
      method: 'POST',
      body: {
        peer: 'deepseek',
        meta: { services: probeHostServices(ctx), pid: process.pid, autoReview: true },
      },
      timeoutMs: 3000,
    });
  };

  let polling = false;
  const pollCommandsAndTasks = async () => {
    if (polling) return;
    polling = true;
    try {
      // A. Execute plugin RPC commands from Antigravity
      const res = await hubFetch('/api/dsh/commands/poll', { timeoutMs: 3000 });
      if (res?.ok && Array.isArray(res.commands) && res.commands.length > 0) {
        for (const cmd of res.commands) {
          const result = await executeDshCommand(ctx, cmd);
          await hubFetch('/api/dsh/commands/result', {
            method: 'POST',
            body: { id: cmd.id, result },
            timeoutMs: 4000,
          });
        }
      }

      // B. Auto-review pending tasks addressed to deepseek when autoWakeDsh is enabled
      const dash = await hubFetch('/api/dashboard', { timeoutMs: 3000 });
      if (dash?.ok && dash.settings?.autoWakeDsh) {
        const pending = (dash.tasks || []).filter(
          (t) => t.to === 'deepseek' && t.status === 'pending' && !processingTasks.has(t.id)
        );
        for (const task of pending.slice(0, 2)) {
          processingTasks.add(task.id);
          void (async () => {
            try {
              await hubFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
                method: 'PATCH',
                body: { status: 'in_progress', actor: 'deepseek-auto' },
              });
              await runAutoReviewInDsh(ctx, task);
            } catch (err) {
              ctx.logger?.warn?.('agy-collab: 自动审查失败', err);
            } finally {
              processingTasks.delete(task.id);
            }
          })();
        }
      }
    } finally {
      polling = false;
    }
  };

  void sendHeartbeat();
  const hbTimer = setInterval(sendHeartbeat, 12_000);
  const pollTimer = setInterval(pollCommandsAndTasks, 2_500);

  ctx.effect(() => () => {
    clearInterval(hbTimer);
    clearInterval(pollTimer);
    for (const d of toolDisposers) {
      try { d(); } catch { /* ignore */ }
    }
  });

  void registerNativeTools(ctx).then((d) => {
    toolDisposers = d;
  });

  // 2. Register same-origin routes for client.js dock UI
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugin/agy-collab/dashboard',
      handler: (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false });
        void hubFetch('/api/dashboard').then((data) => writeJson(res, data.ok ? 200 : 503, data));
      },
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugin/agy-collab/tasks',
      handler: (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false });
        void readReqJson(req)
          .then((body) =>
            hubFetch('/api/tasks', {
              method: 'POST',
              body: { ...body, from: 'deepseek', to: 'antigravity' },
            })
          )
          .then((data) => writeJson(res, data.ok ? 200 : 502, data))
          .catch((err) => writeJson(res, 400, { ok: false, error: String(err?.message || err) }));
      },
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugin/agy-collab/settings',
      handler: (req, res) => {
        if (req.method !== 'PATCH' && req.method !== 'POST') return writeJson(res, 405, { ok: false });
        void readReqJson(req)
          .then((body) =>
            hubFetch('/api/settings', {
              method: 'PATCH',
              body: { ...body, actor: 'deepseek-ui' },
            })
          )
          .then((data) => writeJson(res, data.ok ? 200 : 502, data))
          .catch((err) => writeJson(res, 400, { ok: false, error: String(err?.message || err) }));
      },
    })
  );
}
