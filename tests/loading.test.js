import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';
import { JSDOM } from 'jsdom';

async function common(t, fetch) {
  const dom = new JSDOM('<main><header data-gnb></header></main>', {
    url: 'https://test.local/morning', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  dom.window.fetch = fetch;
  const mod = new SourceTextModule(await readFile(new URL('../public/js/common.js', import.meta.url), 'utf8'), {
    context: dom.getInternalVMContext(),
  });
  await mod.link(() => { throw new Error('unexpected import'); });
  await mod.evaluate();
  return { ...mod.namespace, window: dom.window };
}

test('API shares in-flight GETs, releases them after completion and does not cache responses', async t => {
  let calls = 0, release;
  const { api } = await common(t, async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const a = api('/api/me'), b = api('/api/me');
  assert.equal(a, b);
  await Promise.resolve();
  release();
  await a;
  const c = api('/api/me');
  assert.notEqual(c, a);
  await Promise.resolve();
  release();
  await c;
  assert.equal(calls, 2);
});

test('API times out both stalled fetch and stalled body reads, and can retry', async t => {
  for (const bodyStalls of [false, true]) {
    let signal;
    const { api, window } = await common(t, async (_, options) => {
      signal = options.signal;
      const stalled = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      return bodyStalls ? { ok: true, json: () => stalled } : stalled;
    });
    await assert.rejects(api('/api/me', { timeout: 10 }), /응답이 늦어지고/);
    assert.equal(signal.aborted, true);
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    assert.equal((await api('/api/me')).ok, true);
  }
});

test('API rejects malformed success responses and preserves server errors', async t => {
  const { api, window } = await common(t, async () => ({ ok: true, json: async () => { throw new Error('HTML'); } }));
  await assert.rejects(api('/api/me'), /서버 응답/);
  window.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'busy' }) });
  await assert.rejects(api('/api/me'), err => err.status === 503 && err.message === 'busy');
});

test('a successful mutation cannot reuse an older in-flight GET and is never retried', async t => {
  const pending = [];
  const { api } = await common(t, (path, options) => new Promise(resolve => pending.push({ path, options, resolve })));
  const old = api('/api/me');
  const write = api('/api/profile', { method: 'POST', body: { displayName: '새이름' } });
  await Promise.resolve();
  pending[1].resolve({ ok: true, json: async () => ({ ok: true }) });
  await write;
  const fresh = api('/api/me');
  assert.notEqual(old, fresh);
  await Promise.resolve();
  assert.equal(pending.length, 3);
  pending[0].resolve({ ok: true, json: async () => ({ name: 'old' }) });
  pending[2].resolve({ ok: true, json: async () => ({ name: 'new' }) });
  assert.equal((await old).name, 'old');
  assert.equal((await fresh).name, 'new');
});

test('entry and game login guards share one lookup; outages show a retry without logging out', async t => {
  let calls = 0;
  const app = await common(t, async () => {
    calls++;
    return { ok: true, json: async () => ({ user: { id: 1, displayName: '친구', role: 'player' } }) };
  });
  assert.equal(await app.requireLogin(), await app.requireLogin());
  assert.equal(calls, 1);
  const outage = await common(t, async () => { throw new Error('network offline'); });
  await assert.rejects(outage.requireLogin(), /network offline/);
  assert.equal(outage.window.location.pathname, '/morning');
  assert.equal(outage.window.document.querySelector('[data-load-error] button').textContent, '다시 시도');
  outage.window.fetch = async () => ({ ok: true, json: async () => ({ user: { id: 1, role: 'player' } }) });
  assert.equal((await outage.requireLogin()).id, 1);
});

test('login redirects validate the exact URL used by the browser', async t => {
  const { safeNextUrl } = await common(t, () => {});
  for (const next of ['//evil.test', '/\\evil.test', '/\t/evil.test', '/\n/evil.test',
    'https://evil.test', 'javascript:alert(1)', 'https://test.local@evil.test', 'https://user@test.local/']) {
    assert.equal(safeNextUrl(next), 'https://test.local/');
  }
  assert.equal(safeNextUrl('/quiz?round=3#answer'), 'https://test.local/quiz?round=3#answer');
  assert.equal(safeNextUrl('/a/..//evil.test'), 'https://test.local//evil.test');
});
