import {
  fail, hashPassword, json, normalizeAvatar, normalizeNickname, readJson, timingSafeEqual,
} from '../lib/util.js';
import { gameKeyOf } from '../lib/games.js';
import { assignSetterStatements } from '../lib/setter.js';

/**
 * 계정 생성 / 비밀번호 재설정용 관리 엔드포인트.
 * `SETUP_TOKEN` 시크릿이 설정돼 있어야 하고, 요청에 같은 토큰을 실어야 동작한다.
 *   npx wrangler pages secret put SETUP_TOKEN
 *
 * body: { users: [{ username, displayName, avatar, role: 'player'|'admin', setter, password }] }
 * 이미 있는 아이디면 이름/역할/비밀번호를 덮어쓴다.
 * setter 에 'morning' 또는 'evening' 을 적으면 그 게임의 출제자가 된다
 * (게임마다 한 명이므로 같은 게임을 여럿이 적었으면 마지막 하나만 남는다).
 */
export async function onRequestPost(context) {
  const expected = context.env.SETUP_TOKEN;
  if (!expected) return fail(503, 'SETUP_TOKEN 이 설정되지 않았습니다.');

  const provided = context.request.headers.get('x-setup-token') ?? '';
  if (!timingSafeEqual(provided, expected)) return fail(401, '토큰이 올바르지 않습니다.');

  const body = await readJson(context.request);
  const users = Array.isArray(body.users) ? body.users : [];
  if (!users.length) return fail(400, 'users 배열이 비어 있습니다.');

  const created = [];
  for (const u of users) {
    const username = String(u.username ?? '').trim().toLowerCase();
    const role = u.role === 'admin' ? 'admin' : 'player';
    const password = String(u.password ?? '');

    if (!username) return fail(400, 'username 은 필수입니다.');

    const nickname = normalizeNickname(u.displayName ?? u.display_name ?? username);
    if (nickname.error) return fail(400, `'${username}': ${nickname.error}`);
    const displayName = nickname.value;

    const avatarInput = normalizeAvatar(u.avatar ?? displayName.charAt(0));
    if (avatarInput.error) return fail(400, `'${username}': ${avatarInput.error}`);
    const avatar = avatarInput.value;

    if (password.length < 3) return fail(400, `'${username}' 의 비밀번호는 3자 이상이어야 합니다.`);

    const setterGame = gameKeyOf(u.setter);
    if (u.setter && !setterGame) {
      return fail(400, `'${username}': setter 는 'morning' 또는 'evening' 이어야 합니다.`);
    }
    if (setterGame && role === 'admin') {
      return fail(400, `'${username}': 운영자는 출제자가 될 수 없습니다.`);
    }

    const { hash, salt } = await hashPassword(password);
    await context.env.DB.prepare(
      `INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE
         SET display_name  = excluded.display_name,
             avatar        = excluded.avatar,
             role          = excluded.role,
             password_hash = excluded.password_hash,
             password_salt = excluded.password_salt`,
    )
      .bind(username, displayName, avatar, role, hash, salt)
      .run();

    created.push({ username, displayName, avatar, role, setter: setterGame });
  }

  // 게임마다 출제자는 한 명 — 마지막으로 지정된 계정으로 갈아 끼운다
  const statements = [];
  for (const game of ['morning', 'evening']) {
    const name = created.filter((u) => u.setter === game).at(-1)?.username;
    if (!name) continue;
    const row = await context.env.DB.prepare(`SELECT id FROM users WHERE username = ?`)
      .bind(name).first();
    if (row) statements.push(...assignSetterStatements(context.env.DB, game, row.id));
  }
  if (statements.length) await context.env.DB.batch(statements);

  return json({ ok: true, users: created });
}
