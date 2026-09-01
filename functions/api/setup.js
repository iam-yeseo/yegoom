import { fail, hashPassword, json, readJson, timingSafeEqual } from '../_lib/util.js';

/**
 * 계정 생성 / 비밀번호 재설정용 관리 엔드포인트.
 * `SETUP_TOKEN` 시크릿이 설정돼 있어야 하고, 요청에 같은 토큰을 실어야 동작한다.
 *   npx wrangler pages secret put SETUP_TOKEN
 *
 * body: { users: [{ username, displayName, role: 'player'|'admin', password }] }
 * 이미 있는 아이디면 이름/역할/비밀번호를 덮어쓴다.
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
    const displayName = String(u.displayName ?? u.display_name ?? '').trim();
    const role = u.role === 'admin' ? 'admin' : 'player';
    const password = String(u.password ?? '');

    if (!username || !displayName) return fail(400, 'username 과 displayName 은 필수입니다.');
    if (password.length < 3) return fail(400, `'${username}' 의 비밀번호는 3자 이상이어야 합니다.`);

    const { hash, salt } = await hashPassword(password);
    await context.env.DB.prepare(
      `INSERT INTO users (username, display_name, role, password_hash, password_salt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE
         SET display_name  = excluded.display_name,
             role          = excluded.role,
             password_hash = excluded.password_hash,
             password_salt = excluded.password_salt`,
    )
      .bind(username, displayName, role, hash, salt)
      .run();

    created.push({ username, displayName, role });
  }

  return json({ ok: true, users: created });
}
