import {
  fail, json, NICKNAME_MAX, normalizeAvatar, normalizeNickname, readJson, requireUser,
} from '../lib/util.js';

/**
 * 닉네임과 프로필 글자를 바꾼다.
 *   닉네임      한글/영문/숫자 1~10글자
 *   프로필 글자  딱 한 글자 (이모지 가능)
 * 둘 중 보낸 것만 바뀐다.
 */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;

  const body = await readJson(context.request);
  const fields = [];
  const values = [];

  if (body.displayName !== undefined) {
    const nickname = normalizeNickname(body.displayName);
    if (nickname.error) return fail(400, nickname.error);
    fields.push('display_name = ?');
    values.push(nickname.value);
  }

  if (body.avatar !== undefined) {
    const avatar = normalizeAvatar(body.avatar);
    if (avatar.error) return fail(400, avatar.error);
    fields.push('avatar = ?');
    values.push(avatar.value);
  }

  if (!fields.length) return fail(400, '바꿀 내용이 없습니다.');

  await context.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values, user.id)
    .run();

  const row = await context.env.DB.prepare(
    `SELECT id, username, display_name, avatar, role FROM users WHERE id = ?`,
  ).bind(user.id).first();

  return json({
    ok: true,
    nicknameMax: NICKNAME_MAX,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar ?? '🙂',
      role: row.role,
    },
  });
}
