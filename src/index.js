// Worker 진입점.
//
// 정적 파일(public/)은 Cloudflare 의 assets 레이어가 먼저 처리하고,
// 거기서 매칭되지 않은 요청만 이 Worker 로 넘어온다. 즉 여기서는 사실상
// /api/* 만 다루면 된다.

import * as adminAnswer from './routes/admin-answer.js';
import * as adminSetter from './routes/admin-setter.js';
import * as avatar from './routes/avatar.js';
import * as bootstrap from './routes/bootstrap.js';
import * as guess from './routes/guess.js';
import * as history from './routes/history.js';
import * as login from './routes/login.js';
import * as logout from './routes/logout.js';
import * as me from './routes/me.js';
import * as migrate from './routes/migrate.js';
import * as password from './routes/password.js';
import * as profile from './routes/profile.js';
import * as ranking from './routes/ranking.js';
import * as setup from './routes/setup.js';
import * as today from './routes/today.js';
import { migrate as runMigration, pendingMigrations } from './lib/migrate.js';
import { json } from './lib/util.js';

const ROUTES = new Map([
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/me', me],
  ['/api/avatar', avatar],
  ['/api/today', today],
  ['/api/guess', guess],
  ['/api/ranking', ranking],
  ['/api/history', history],
  ['/api/password', password],
  ['/api/profile', profile],
  ['/api/setup', setup],
  ['/api/admin/answer', adminAnswer],
  ['/api/admin/setter', adminSetter],
  ['/api/bootstrap', bootstrap],
  ['/api/migrate', migrate],
]);

/**
 * 새 코드를 배포했는데 D1 이 아직 예전 모양이면 앱이 통째로 안 돌아간다.
 * 그래서 요청을 받기 전에 한 번 확인하고, 남은 게 있으면 옮기고 시작한다.
 *
 * 확인은 워커 인스턴스마다 딱 한 번이라 평소에는 비용이 없고, 여러 요청이
 * 동시에 들어와도 마이그레이션은 하나만 돈다. 옮길 게 없으면 아무 일도 없다.
 */
let schemaReady = null;

function ensureSchema(env) {
  schemaReady ??= (async () => {
    const pending = await pendingMigrations(env.DB);
    if (!pending.length) return;
    console.log(`예전 스키마를 옮깁니다: ${pending.join(', ')}`);
    await runMigration(env.DB);
  })().catch((err) => {
    // 실패하면 다음 요청에서 다시 시도한다 (여기서 요청을 막지는 않는다)
    schemaReady = null;
    console.error('스키마 자동 업데이트 실패', err);
  });
  return schemaReady;
}

// 라우트 모듈은 onRequestGet / onRequestPost / onRequestDelete 를 내보낸다.
const HANDLER = {
  GET: 'onRequestGet',
  HEAD: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  DELETE: 'onRequestDelete',
  PATCH: 'onRequestPatch',
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const route = ROUTES.get(pathname.replace(/\/+$/, '') || '/');

    if (!route) {
      return json({ ok: false, error: '없는 경로입니다.' }, { status: 404 });
    }

    const handler = route[HANDLER[request.method]];
    if (!handler) {
      const allowed = Object.entries(HANDLER)
        .filter(([, name]) => route[name])
        .map(([method]) => method);
      return json(
        { ok: false, error: '허용되지 않은 메서드입니다.' },
        { status: 405, headers: { allow: [...new Set(allowed)].join(', ') } },
      );
    }

    try {
      await ensureSchema(env);
      return await handler({ request, env, ctx });
    } catch (err) {
      console.error(`${request.method} ${pathname} 처리 중 오류`, err);
      return json({ ok: false, error: '서버에서 오류가 발생했습니다.' }, { status: 500 });
    }
  },
};
