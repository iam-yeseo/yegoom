import {
  fail, hashPassword, json, personOf, randomHex, readJson,
  sessionCookie, SESSION_DAYS, timingSafeEqual,
} from '../lib/util.js';

export async function onRequestPost(context) {
  const { username, password } = await readJson(context.request);

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return fail(400, '아이디와 비밀번호를 모두 입력해 주세요.');
  }

  // avatar 컬럼이 없는 예전 DB 에서도 로그인은 되어야 스키마를 옮길 수 있어 u.* 로 받는다
  const user = await context.env.DB.prepare(
    `SELECT * FROM users WHERE username = ?`,
  )
    .bind(username.trim().toLowerCase())
    .first();

  // 아이디가 없을 때도 해싱 비용을 치러 응답 시간으로 계정 존재 여부가 새지 않게 한다
  const salt = user?.password_salt ?? randomHex(16);
  const { hash } = await hashPassword(password, salt);

  if (!user || !timingSafeEqual(hash, user.password_hash)) {
    return fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  const token = randomHex(32);
  await context.env.DB.batch([
    // 만료된 세션 정리
    context.env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),
    context.env.DB.prepare(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES (?, ?, datetime('now', ?))`,
    ).bind(token, user.id, `+${SESSION_DAYS} days`),
  ]);

  return json(
    {
      ok: true,
      user: personOf(user, { role: user.role, isSetter: user.is_setter === 1 }),
    },
    { headers: { 'set-cookie': sessionCookie(token, context.request) } },
  );
}
