import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import {
  computePeerStatus,
  createTaskRecord,
  getOrCreateToken,
  loadState,
  pushLog,
  saveState,
} from './store.mjs';
import { getMemoryOverview, searchDshMemory } from './memory-reader.mjs';
import { listInstalledDshPlugins } from './dsh-catalog.mjs';
import { renderWebConsoleHtml } from './web-ui.mjs';

export const HUB_HOST = '127.0.0.1';
export const HUB_PORT = Number(process.env.DSH_AGY_HUB_PORT) || 47891;

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function createHubServer({ port = HUB_PORT } = {}) {
  const token = getOrCreateToken();
  const sseClients = new Set();

  /** Pending RPC commands dispatched from Antigravity -> DSH Host plugin */
  const pendingDshCommands = [];
  const waitingResolvers = new Map();
  /** Ephemeral in-memory Antigravity Language Server wake credentials (never persisted to disk) */
  let agyWakeEndpoint = null;

  function broadcast(event, payload) {
    const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(line);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function buildDashboard(state) {
    return {
      ok: true,
      hub: { host: HUB_HOST, port, time: Date.now() },
      peers: {
        antigravity: computePeerStatus(state.peers.antigravity),
        deepseek: computePeerStatus(state.peers.deepseek),
      },
      settings: state.settings,
      tasks: state.tasks,
      logs: state.logs.slice(0, 40),
      memory: getMemoryOverview(),
      dshPlugins: listInstalledDshPlugins(),
    };
  }

  function maybeAutoWake(state, task) {
    if (task.to !== 'antigravity' || !state.settings.autoWakeAgy) return;

    // 1. Preferred: wake Antigravity natively via local ConversationService/CreateConversation
    if (agyWakeEndpoint?.address && agyWakeEndpoint?.csrfToken) {
      const promptText = [
        `[DSH 全自动协同任务 ${task.id}]`,
        `来自 DeepSeek Harness 的任务：${task.title}（类型：${task.kind}）`,
        task.workspace ? `工作区：${task.workspace}` : '',
        task.files?.length ? `涉及文件：${task.files.join(', ')}` : '',
        task.prompt ? `要求与说明：\n${task.prompt}` : '',
        task.diff ? `代码片段/Diff：\n${task.diff.slice(0, 8000)}` : '',
        `请你自动读取相关代码文件并完成审查或处理，然后务必调用 dsh_collab_submit_review(taskId="${task.id}", verdict=..., summary=..., comments=...) 将结构化结果回写给 DeepSeek Harness。`,
      ]
        .filter(Boolean)
        .join('\n\n');

      pushLog(state, {
        actor: 'hub',
        event: 'auto_wake_agy_native',
        detail: `通过 ConversationService 自动拉起 Antigravity 处理 ${task.id}`,
      });

      const body = {
        title: `[DSH 协同] ${task.title}`.slice(0, 80),
        tags: ['dsh-collab'],
        prompt: [{ text: promptText }],
        ...(agyWakeEndpoint.projectId ? { projectId: agyWakeEndpoint.projectId } : {}),
      };

      void fetch(`http://${agyWakeEndpoint.address}/product.v1.ConversationService/CreateConversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-antigravity-csrf-token': agyWakeEndpoint.csrfToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
        .then(async (res) => {
          const latest = loadState();
          if (res.ok) {
            const json = await res.json().catch(() => ({}));
            const convId = json?.conversation?.id || '';
            const t = latest.tasks.find((x) => x.id === task.id);
            if (t && t.status === 'pending') {
              t.status = 'in_progress';
              t.updatedAt = Date.now();
            }
            pushLog(latest, {
              actor: 'hub',
              event: 'auto_wake_agy_started',
              detail: `已创建 Antigravity 会话 ${convId} 处理 ${task.id}`,
            });
          } else {
            const errTxt = await res.text().catch(() => '');
            pushLog(latest, {
              actor: 'hub',
              event: 'auto_wake_failed',
              detail: `ConversationService 返回 ${res.status}: ${errTxt.slice(0, 200)}`,
            });
          }
          saveState(latest);
          broadcast('update', { type: 'auto_wake', taskId: task.id });
        })
        .catch((err) => {
          const latest = loadState();
          pushLog(latest, {
            actor: 'hub',
            event: 'auto_wake_failed',
            detail: String(err?.message || err),
          });
          saveState(latest);
          broadcast('update', { type: 'auto_wake', taskId: task.id });
        });
      return;
    }

    // 2. Fallback: custom shell wake command if configured
    if (state.settings.autoWakeCommand) {
      const cmd = state.settings.autoWakeCommand
        .replaceAll('{{TASK_ID}}', task.id)
        .replaceAll('{{TITLE}}', task.title.replace(/"/g, "'"));
      pushLog(state, { actor: 'hub', event: 'auto_wake_agy', detail: `触发命令: ${cmd}` });
      exec(cmd, { timeout: 120_000 }, (err) => {
        const latest = loadState();
        pushLog(latest, {
          actor: 'hub',
          event: err ? 'auto_wake_failed' : 'auto_wake_done',
          detail: err ? String(err.message) : `任务 ${task.id} 自动唤醒完成`,
        });
        saveState(latest);
        broadcast('update', { type: 'auto_wake', taskId: task.id });
      });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HUB_HOST}:${port}`);
    const pathname = url.pathname;

    // Health check doesn't require auth
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'dsh-agy-collab-hub', port });
    }

    // Local Web Console for VS Code Simple Browser / standalone browser (loopback only, no CORS)
    if (req.method === 'GET' && (pathname === '/' || pathname === '/ui')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(renderWebConsoleHtml(token));
      return;
    }

    // Token auth for all /api/* routes
    const reqToken = req.headers['x-collab-token'] || url.searchParams.get('token') || '';
    if (reqToken !== token) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized: invalid x-collab-token' });
    }

    try {
      // SSE stream for live UI updates
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, at: Date.now() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/dashboard') {
        const state = loadState();
        return sendJson(res, 200, buildDashboard(state));
      }

      if (req.method === 'POST' && pathname === '/api/heartbeat') {
        const body = await readJsonBody(req);
        const peer = body.peer === 'deepseek' ? 'deepseek' : 'antigravity';
        const state = loadState();
        if (peer === 'antigravity' && body.wakeEndpoint?.address && body.wakeEndpoint?.csrfToken) {
          agyWakeEndpoint = {
            address: String(body.wakeEndpoint.address),
            csrfToken: String(body.wakeEndpoint.csrfToken),
            projectId: body.wakeEndpoint.projectId ? String(body.wakeEndpoint.projectId) : '',
          };
        }
        state.peers[peer] = {
          online: true,
          lastSeen: Date.now(),
          meta: {
            ...(body.meta || {}),
            ...(peer === 'antigravity' ? { nativeAutoWakeReady: Boolean(agyWakeEndpoint) } : {}),
          },
        };
        saveState(state);
        return sendJson(res, 200, {
          ok: true,
          peer,
          pendingTasksForPeer: state.tasks.filter((t) => t.to === peer && t.status === 'pending').length,
        });
      }

      if (req.method === 'GET' && pathname === '/api/tasks') {
        const state = loadState();
        const toFilter = url.searchParams.get('to');
        const statusFilter = url.searchParams.get('status');
        let tasks = state.tasks;
        if (toFilter) tasks = tasks.filter((t) => t.to === toFilter);
        if (statusFilter) tasks = tasks.filter((t) => t.status === statusFilter);
        return sendJson(res, 200, { ok: true, tasks });
      }

      if (req.method === 'POST' && pathname === '/api/tasks') {
        const body = await readJsonBody(req);
        const state = loadState();
        const task = createTaskRecord(body);
        state.tasks.unshift(task);
        if (state.tasks.length > 100) state.tasks.length = 100;
        pushLog(state, {
          actor: task.from,
          event: 'task_created',
          detail: `[${task.from} -> ${task.to}] ${task.title} (${task.id})`,
        });
        maybeAutoWake(state, task);
        saveState(state);
        broadcast('update', { type: 'task_created', task });
        return sendJson(res, 201, { ok: true, task });
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && req.method === 'PATCH') {
        const taskId = decodeURIComponent(taskMatch[1]);
        const body = await readJsonBody(req);
        const state = loadState();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return sendJson(res, 404, { ok: false, error: 'Task not found' });
        if (body.status) task.status = String(body.status);
        if (body.prompt !== undefined) task.prompt = String(body.prompt);
        if (body.diff !== undefined) task.diff = String(body.diff);
        if (body.round !== undefined) task.round = Number(body.round) || task.round;
        task.updatedAt = Date.now();
        pushLog(state, {
          actor: body.actor || 'user',
          event: 'task_updated',
          detail: `${task.id} -> ${task.status}`,
        });
        saveState(state);
        broadcast('update', { type: 'task_updated', task });
        return sendJson(res, 200, { ok: true, task });
      }

      const reviewMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/review$/);
      if (reviewMatch && req.method === 'POST') {
        const taskId = decodeURIComponent(reviewMatch[1]);
        const body = await readJsonBody(req);
        const state = loadState();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return sendJson(res, 404, { ok: false, error: 'Task not found' });
        const reviewer = body.reviewer === 'deepseek' ? 'deepseek' : 'antigravity';
        const verdict = ['approved', 'changes_requested', 'commented'].includes(body.verdict)
          ? body.verdict
          : 'commented';
        const review = {
          id: `rev_${crypto.randomBytes(4).toString('hex')}`,
          reviewer,
          verdict,
          summary: String(body.summary || '').slice(0, 8000),
          comments: Array.isArray(body.comments) ? body.comments.slice(0, 50) : [],
          createdAt: Date.now(),
        };
        task.reviews.push(review);
        task.status = verdict === 'approved' ? 'approved' : verdict === 'changes_requested' ? 'changes_requested' : 'in_progress';
        task.updatedAt = Date.now();
        pushLog(state, {
          actor: reviewer,
          event: 'review_submitted',
          detail: `${task.id} [${verdict}] ${review.summary.slice(0, 120)}`,
        });
        saveState(state);
        broadcast('update', { type: 'review_submitted', task, review });
        return sendJson(res, 200, { ok: true, task, review });
      }

      if (req.method === 'PATCH' && pathname === '/api/settings') {
        const body = await readJsonBody(req);
        const state = loadState();
        if (typeof body.autoWakeAgy === 'boolean') state.settings.autoWakeAgy = body.autoWakeAgy;
        if (typeof body.autoWakeDsh === 'boolean') state.settings.autoWakeDsh = body.autoWakeDsh;
        if (typeof body.autoWakeCommand === 'string') state.settings.autoWakeCommand = body.autoWakeCommand.trim();
        pushLog(state, {
          actor: body.actor || 'user',
          event: 'settings_updated',
          detail: JSON.stringify(state.settings),
        });
        saveState(state);
        broadcast('update', { type: 'settings_updated', settings: state.settings });
        return sendJson(res, 200, { ok: true, settings: state.settings });
      }

      if (req.method === 'GET' && pathname === '/api/memory/search') {
        const q = url.searchParams.get('q') || '';
        const scope = url.searchParams.get('scope') || 'all';
        const limit = Number(url.searchParams.get('limit') || 12);
        const hits = searchDshMemory(q, { scope, limit });
        return sendJson(res, 200, { ok: true, query: q, scope, hits, overview: getMemoryOverview() });
      }

      if (req.method === 'GET' && pathname === '/api/dsh/plugins') {
        const state = loadState();
        return sendJson(res, 200, {
          ok: true,
          dshOnline: computePeerStatus(state.peers.deepseek).online,
          plugins: listInstalledDshPlugins(),
          liveServices: state.peers.deepseek?.meta?.services || [],
        });
      }

      // Antigravity -> Hub -> DSH Host plugin RPC dispatch
      if (req.method === 'POST' && pathname === '/api/dsh/call') {
        const body = await readJsonBody(req);
        const state = loadState();
        const dshOnline = computePeerStatus(state.peers.deepseek).online;
        if (!dshOnline) {
          return sendJson(res, 503, {
            ok: false,
            error: 'DeepSeek Harness (dsh) 当前离线或尚未安装 dsh-plugin-agy-collab 插件，无法实时调用运行时插件。',
          });
        }
        const cmdId = `cmd_${crypto.randomBytes(5).toString('hex')}`;
        const cmd = {
          id: cmdId,
          plugin: String(body.plugin || ''),
          action: String(body.action || 'status'),
          params: body.params || {},
          createdAt: Date.now(),
        };
        pendingDshCommands.push(cmd);
        const timeoutMs = Math.min(30_000, Math.max(2000, Number(body.timeoutMs) || 12_000));
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            waitingResolvers.delete(cmdId);
            resolve({ ok: false, error: `等待 DSH Host 执行超时 (${timeoutMs}ms)` });
          }, timeoutMs);
          waitingResolvers.set(cmdId, (payload) => {
            clearTimeout(timer);
            waitingResolvers.delete(cmdId);
            resolve(payload);
          });
        });
        pushLog(state, {
          actor: 'antigravity',
          event: 'dsh_plugin_call',
          detail: `${cmd.plugin}.${cmd.action} -> ${result.ok ? 'ok' : result.error}`,
        });
        saveState(state);
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      // DSH Host plugin polls for pending commands
      if (req.method === 'GET' && pathname === '/api/dsh/commands/poll') {
        const batch = pendingDshCommands.splice(0, 10);
        return sendJson(res, 200, { ok: true, commands: batch });
      }

      // DSH Host plugin posts command execution result
      if (req.method === 'POST' && pathname === '/api/dsh/commands/result') {
        const body = await readJsonBody(req);
        const resolver = waitingResolvers.get(body.id);
        if (resolver) {
          resolver(body.result || { ok: true });
        }
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${pathname}` });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message || err) });
    }
  });

  return {
    server,
    token,
    port,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HUB_HOST, () => {
          server.removeListener('error', reject);
          resolve({ host: HUB_HOST, port, token });
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// Run standalone if executed directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain && process.argv[1].includes('server.mjs') && process.argv[1].includes('hub')) {
  const hub = createHubServer();
  hub.start()
    .then(({ host, port }) => {
      console.log(`[dsh-agy-hub] listening on http://${host}:${port}`);
    })
    .catch((err) => {
      if (err?.code === 'EADDRINUSE') {
        console.log(`[dsh-agy-hub] already running on http://${HUB_HOST}:${HUB_PORT}`);
        process.exit(0);
      }
      console.error('[dsh-agy-hub] failed to start:', err);
      process.exit(1);
    });
}
