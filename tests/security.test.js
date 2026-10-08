import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../src/index.js';
import { SCHEMA_STATEMENTS } from '../src/lib/schema.js';
import { pendingMigrations, migrate } from '../src/lib/migrate.js';
import { getUser, hashPassword, readCookie } from '../src/lib/util.js';
import * as setup from '../src/routes/setup.js';
import * as bootstrap from '../src/routes/bootstrap.js';
import * as login from '../src/routes/login.js';
import * as password from '../src/routes/password.js';

test('foreign browser mutations are rejected before database work', async () => {
  for (const headers of [
    { origin: 'https://evil.test' }, { origin: 'null' },
    { origin: 'https://sibling.test.local', 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ]) {
    for (const [method, path] of [['POST', '/api/login'], ['POST', '/api/logout'], ['DELETE', '/api/answer']]) {
      const request = new Request(`https://test.local${path}`, { method, headers: { ...headers, 'content-type': 'text/plain' },
        body: '{"username":"admin","password":"test"}' });
      assert.equal((await worker.fetch(request, {}, {})).status, 403);
    }
  }
});

test('malformed cookies are treated as unauthenticated instead of crashing', () => {
  const request = new Request('https://test.local', { headers: { cookie: 'toigeun_session=%E0%A4%A' } });
  assert.equal(readCookie(request, 'toigeun_session'), null);
});

test('D1: safe migrations, reset revocation, protected bootstrap and legitimate browser/CLI flows', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-09-01', d1Databases: ['DB', 'FRESH'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB'), fresh = await mf.getD1Database('FRESH');
  await db.batch(SCHEMA_STATEMENTS.map(sql => db.prepare(sql)));
  const credentials = await hashPassword('old-password');
  for (const [id, username, role] of [[1, 'owner', 'admin'], [2, 'friend', 'player']]) {
    await db.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt) VALUES(?,?,?,?,?,?)`)
      .bind(id, username, username, role, credentials.hash, credentials.salt).run();
    await db.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,datetime('now','+1 day'))`)
      .bind(`session-${id}`, id).run();
  }
  await migrate(db);
  assert.equal((await db.prepare(`SELECT role FROM users WHERE username='owner'`).first()).role, 'admin');
  assert.equal(await db.prepare(`SELECT id FROM users WHERE username='admin'`).first(), null);
  let batches = 0;
  const measured = { prepare: sql => db.prepare(sql), batch: statements => { batches++; return db.batch(statements); } };
  assert.deepEqual(await pendingMigrations(measured), []);
  assert.equal(batches, 1, 'one D1 round trip for current schema');
  const context = (database, path, { body, headers = {}, method = 'POST', token = 'setup-test' } = {}) => ({
    env: { DB: database, SETUP_TOKEN: token }, request: new Request(`https://test.local${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  });
  const sessionUser = (id) => getUser(context(db, '/api/me', { method: 'GET', headers: { cookie: `toigeun_session=session-${id}` } }));
  const reset = context(db, '/api/setup', { headers: { 'x-setup-token': 'setup-test' },
    body: { users: [{ username: 'owner', role: 'admin', password: 'new-password' }] } });
  assert.equal((await setup.onRequestPost(reset)).status, 200);
  assert.equal(await sessionUser(1), null);
  assert.equal((await sessionUser(2)).id, 2);
  assert.equal((await login.onRequestPost(context(db, '/api/login', { body: { username: 'owner', password: 'new-password' } }))).status, 200);
  assert.equal((await login.onRequestPost(context(db, '/api/login', { body: { username: 'owner', password: 'old-password' } }))).status, 401);

  // A login already verifying an old password must not recreate a revoked session.
  let releaseLogin, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const pausedDb = {
    prepare: sql => db.prepare(sql),
    async batch(statements) {
      started();
      await new Promise(resolve => { releaseLogin = resolve; });
      return db.batch(statements);
    },
  };
  const racingLogin = login.onRequestPost(context(pausedDb, '/api/login', { body: { username: 'owner', password: 'new-password' } }));
  await waiting;
  const secondReset = context(db, '/api/setup', { headers: { 'x-setup-token': 'setup-test' },
    body: { users: [{ username: 'owner', role: 'admin', password: 'newest-password' }] } });
  assert.equal((await setup.onRequestPost(secondReset)).status, 200);
  releaseLogin();
  const stale = await racingLogin;
  assert.equal(stale.status, 401);
  assert.equal(stale.headers.has('set-cookie'), false);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id=1`).first()).n, 0);
  const signedIn = await login.onRequestPost(context(db, '/api/login', { body: { username: 'owner', password: 'newest-password' } }));
  assert.equal(signedIn.status, 200);
  let releaseChange, changing;
  const changeWaiting = new Promise(resolve => { changing = resolve; });
  const pausedChangeDb = {
    prepare: sql => db.prepare(sql),
    async batch(statements) {
      changing();
      await new Promise(resolve => { releaseChange = resolve; });
      return db.batch(statements);
    },
  };
  const racingChange = password.onRequestPost(context(pausedChangeDb, '/api/password', {
    headers: { cookie: signedIn.headers.get('set-cookie').split(';')[0] },
    body: { currentPassword: 'newest-password', newPassword: 'stale-attacker-password' },
  }));
  await changeWaiting;
  assert.equal((await setup.onRequestPost(context(db, '/api/setup', { headers: { 'x-setup-token': 'setup-test' },
    body: { users: [{ username: 'owner', role: 'admin', password: 'operator-final-password' }] } }))).status, 200);
  releaseChange();
  assert.equal((await racingChange).status, 401);
  assert.equal((await login.onRequestPost(context(db, '/api/login', { body: { username: 'owner', password: 'stale-attacker-password' } }))).status, 401);
  const finalLogin = await login.onRequestPost(context(db, '/api/login', { body: { username: 'owner', password: 'operator-final-password' } }));
  assert.equal(finalLogin.status, 200);
  assert.equal((await password.onRequestPost(context(db, '/api/password', {
    headers: { cookie: finalLogin.headers.get('set-cookie').split(';')[0] },
    body: { currentPassword: 'operator-final-password', newPassword: 'user-chosen-password' },
  }))).status, 200);

  // Header tokens are required; URLs alone do not authorize account creation.
  for (const [options, status] of [[{ token: '' }, 503], [{}, 401], [{ headers: { 'x-setup-token': 'wrong' } }, 401]]) {
    assert.equal((await bootstrap.onRequestPost(context(fresh, '/api/bootstrap?token=setup-test', options))).status, status);
  }
  const boot = await bootstrap.onRequestPost(context(fresh, '/api/bootstrap', { headers: { 'x-setup-token': 'setup-test' } }));
  assert.equal(boot.status, 200);
  const data = await boot.json();
  assert.equal(data.initialPasswords.length, 5);
  assert.equal(new Set(data.initialPasswords.map(u => u.password)).size, 5);
  const admin = data.initialPasswords.find(u => u.username === 'admin');
  assert.equal((await login.onRequestPost(context(fresh, '/api/login', { body: admin }))).status, 200);
  assert.equal((await login.onRequestPost(context(fresh, '/api/login', { body: { username: 'admin', password: 'admin' } }))).status, 401);
  const status = await bootstrap.onRequestGet(context(fresh, '/api/bootstrap', { method: 'GET' }));
  assert.equal(JSON.stringify(await status.json()).includes(admin.password), false);
  assert.equal((await bootstrap.onRequestPost(context(fresh, '/api/bootstrap', { headers: { 'x-setup-token': 'setup-test' } }))).status, 409);

  // The SQL reset path also revokes sessions while preserving unrelated accounts.
  await fresh.prepare(`INSERT INTO users(username,display_name,role,password_hash,password_salt) VALUES('untouched','untouched','player','x','x')`).run();
  await fresh.prepare(`INSERT INTO sessions(token,user_id,expires_at) SELECT 'unrelated',id,datetime('now','+1 day') FROM users WHERE username='untouched'`).run();
  const sql = await readFile(new URL('../seed-users.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
  await fresh.batch(statements.map(s => fresh.prepare(s)));
  assert.equal((await fresh.prepare(`SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username='admin'`).first()).n, 0);
  assert.equal((await fresh.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE token='unrelated'`).first()).n, 1);

  for (const headers of [{}, { origin: 'https://test.local', 'sec-fetch-site': 'same-origin' }]) {
    const request = new Request('https://test.local/api/logout', { method: 'POST', headers });
    assert.equal((await worker.fetch(request, { DB: db }, {})).status, 200);
  }
});
