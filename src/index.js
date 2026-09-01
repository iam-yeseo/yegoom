// Worker 진입점.
//
// 정적 파일(public/)은 Cloudflare 의 assets 레이어가 먼저 처리하고,
// 거기서 매칭되지 않은 요청만 이 Worker 로 넘어온다. 즉 여기서는 사실상
// /api/* 만 다루면 된다.

import * as adminAnswer from './routes/admin-answer.js';
import * as adminSetter from './routes/admin-setter.js';
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
import { json } from './lib/util.js';

const ROUTES = new Map([
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/me', me],
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
      return await handler({ request, env, ctx });
    } catch (err) {
      console.error(`${request.method} ${pathname} 처리 중 오류`, err);
      return json({ ok: false, error: '서버에서 오류가 발생했습니다.' }, { status: 500 });
    }
  },
};
