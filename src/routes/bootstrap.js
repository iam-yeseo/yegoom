import { fail, json, timingSafeEqual } from '../lib/util.js';
import { migrate, pendingMigrations } from '../lib/migrate.js';
import { SEED_USERS } from '../lib/seed.js';
import { gameKeyOf } from '../lib/games.js';
import { assignSetterStatements } from '../lib/setter.js';

/**
 * 최초 1회 초기 설정 — 테이블을 만들고 계정 5개(플레이어 4 + 운영자 1)를 넣고,
 * 게임별 출제자(오전 · 오후)를 지정한다.
 *
 * wrangler CLI 없이 브라우저에서 끝낼 수 있게 만든 엔드포인트라, 아무나 못 쓰도록
 * 두 겹으로 막는다.
 *   1) 계정이 이미 하나라도 있으면 거부한다 (한 번 쓰이면 스스로 닫힌다)
 *   2) SETUP_TOKEN 시크릿이 설정돼 있으면 그 토큰까지 맞아야 한다
 *
 * 테이블 생성은 전부 IF NOT EXISTS 라 기존 데이터를 절대 지우지 않는다.
 */

/** 설정이 끝났는지 확인 — /setup 페이지가 상태를 보여주는 데 쓴다. */
export async function onRequestGet(context) {
  const status = await readStatus(context.env.DB);
  // 스키마가 예전 모양이면 /setup 이 "업데이트 필요" 를 띄울 수 있게 알려 준다
  let pending = [];
  try {
    pending = await pendingMigrations(context.env.DB);
  } catch {
    /* 테이블이 아직 없을 수 있다 */
  }
  return json({ ok: true, ...status, pendingMigration: pending });
}

export async function onRequestPost(context) {
  const db = context.env.DB;

  // SETUP_TOKEN 을 설정해 뒀다면 반드시 일치해야 한다
  const expected = context.env.SETUP_TOKEN;
  if (expected) {
    const provided =
      context.request.headers.get('x-setup-token') ??
      new URL(context.request.url).searchParams.get('token') ??
      '';
    if (!timingSafeEqual(provided, expected)) {
      return fail(401, '설정 토큰이 올바르지 않습니다.');
    }
  }

  const before = await readStatus(db);
  if (before.userCount > 0) {
    return fail(409, '이미 초기 설정이 끝났습니다. 다시 실행할 수 없습니다.', {
      users: before.users,
    });
  }

  // 1. 테이블 (이미 있으면 그대로 두고, 예전 스키마면 새 모양으로 옮긴다)
  await migrate(db);

  // 2. 계정
  await db.batch(
    SEED_USERS.map((u) =>
      db
        .prepare(
          `INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(username) DO NOTHING`,
        )
        .bind(u.username, u.displayName, u.avatar, u.role, u.hash, u.salt),
    ),
  );

  // 3. 게임별 출제자 — 시드의 setter 값('morning' / 'evening')대로 지정한다
  const statements = [];
  for (const u of SEED_USERS) {
    const game = gameKeyOf(u.setter);
    if (!game) continue;
    const row = await db.prepare(`SELECT id FROM users WHERE username = ?`).bind(u.username).first();
    if (row) statements.push(...assignSetterStatements(db, game, row.id));
  }
  if (statements.length) await db.batch(statements);

  const after = await readStatus(db);
  return json({ ok: true, created: true, ...after });
}

/** users 테이블이 아직 없을 수도 있으므로 조회 실패를 "설정 전"으로 본다. */
async function readStatus(db) {
  try {
    // avatar 컬럼이 없는 예전 DB 도 상태만은 읽을 수 있게 한다
    const { results } = await db.prepare(`SELECT * FROM users ORDER BY id`).all();

    // game_setters 는 스키마를 옮기기 전이면 아직 없을 수 있다
    let setters = [];
    try {
      const rows = await db.prepare(`SELECT game, user_id FROM game_setters`).all();
      setters = rows.results ?? [];
    } catch {
      /* 아직 표가 없으면 출제자 표시만 비워 둔다 */
    }

    const users = (results ?? []).map((u) => ({
      username: u.username,
      displayName: u.display_name,
      avatar: u.avatar ?? '🙂',
      role: u.role,
      setterGames: setters.filter((s) => s.user_id === u.id).map((s) => s.game),
    }));
    return { ready: users.length > 0, userCount: users.length, users };
  } catch {
    return { ready: false, userCount: 0, users: [] };
  }
}
