import { fail, hashPassword, json, readJson, requireUser, timingSafeEqual } from '../_lib/util.js';

/** 로그인한 사용자가 자기 비밀번호를 바꾼다. 바꾸면 다른 기기의 세션은 모두 끊긴다. */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;

  const { currentPassword, newPassword } = await readJson(context.request);
  if (typeof newPassword !== 'string' || newPassword.length < 3) {
    return fail(400, '새 비밀번호는 3자 이상이어야 합니다.');
  }

  const db = context.env.DB;
  const row = await db.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(user.id).first();
  const { hash: currentHash } = await hashPassword(String(currentPassword ?? ''), row.password_salt);
  if (!timingSafeEqual(currentHash, row.password_hash)) {
    return fail(401, '현재 비밀번호가 올바르지 않습니다.');
  }

  const { hash, salt } = await hashPassword(newPassword);
  await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`)
      .bind(hash, salt, user.id),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id),
  ]);

  return json({ ok: true, message: '비밀번호를 변경했습니다. 다시 로그인해 주세요.' });
}
