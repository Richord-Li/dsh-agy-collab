import assert from 'node:assert/strict';
import { createHubServer } from '../hub/server.mjs';

const TEST_PORT = 47899;

async function run() {
  const hub = createHubServer({ port: TEST_PORT });
  const { token } = await hub.start();
  const base = `http://127.0.0.1:${TEST_PORT}`;
  const headers = { 'x-collab-token': token, 'content-type': 'application/json' };

  try {
    // 1. Health
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true, 'health ok');

    // 2. Heartbeats from both sides
    await fetch(`${base}/api/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ peer: 'antigravity', meta: { test: true } }) });
    await fetch(`${base}/api/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ peer: 'deepseek', meta: { services: ['webServer', 'tools'] } }) });

    // 3. Antigravity -> DeepSeek review task
    const t1 = await (
      await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Smoke: AGY -> DSH review', from: 'antigravity', to: 'deepseek', kind: 'code_review', prompt: 'Check edge cases' }),
      })
    ).json();
    assert.equal(t1.ok, true, 't1 created');

    // 4. DeepSeek submits review
    const r1 = await (
      await fetch(`${base}/api/tasks/${t1.task.id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reviewer: 'deepseek', verdict: 'approved', summary: 'Looks clean' }),
      })
    ).json();
    assert.equal(r1.ok, true, 'r1 submitted');
    assert.equal(r1.task.status, 'approved');

    // 5. DeepSeek -> Antigravity review task
    const t2 = await (
      await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Smoke: DSH -> AGY review', from: 'deepseek', to: 'antigravity', kind: 'code_review' }),
      })
    ).json();
    assert.equal(t2.ok, true, 't2 created');

    // 6. Antigravity submits review
    const r2 = await (
      await fetch(`${base}/api/tasks/${t2.task.id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reviewer: 'antigravity', verdict: 'changes_requested', summary: 'Add null guard' }),
      })
    ).json();
    assert.equal(r2.ok, true, 'r2 submitted');
    assert.equal(r2.task.status, 'changes_requested');

    // 7. Memory search & DSH plugin catalog
    const mem = await (await fetch(`${base}/api/memory/search?q=&limit=3`, { headers })).json();
    assert.equal(mem.ok, true, 'memory search ok');
    const plugins = await (await fetch(`${base}/api/dsh/plugins`, { headers })).json();
    assert.equal(plugins.ok, true, 'dsh plugins ok');

    console.log('[smoke-test] PASS:', {
      memoryFiles: mem.overview?.dshMemoryFileCount,
      mdcgFiles: mem.overview?.mdcgFileCount,
      dshPluginsFound: plugins.plugins?.length,
    });
  } finally {
    await hub.stop();
  }
}

run().catch((err) => {
  console.error('[smoke-test] FAIL:', err);
  process.exit(1);
});
