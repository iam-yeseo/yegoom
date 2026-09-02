import {
  fail, json, NICKNAME_MAX, normalizeAvatar, normalizeNickname, personOf, readJson, requireUser,
} from '../lib/util.js';
import { MAX_PHOTO_SIDE, normalizePhoto } from '../lib/image.js';
import { userWithSetterGames } from '../lib/setter.js';

/**
 * 닉네임 · 프로필 글자 · 프로필 사진을 바꾼다. 보낸 것만 바뀐다.
 *   displayName  한글/영문/숫자 1~10글자
 *   avatar       딱 한 글자 (이모지 가능) — 사진이 없을 때 프로필 자리에 들어간다
 *   photo        정방형 이미지 data URL. null 을 보내면 사진을 지운다.
 *
 * 사진은 화면에서 정방형으로 잘라 512px 로 줄여 보내지만, API 를 직접 부를 수도
 * 있으니 서버에서도 형식·크기·정방형 여부를 다시 확인한다.
 */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  const body = await readJson(context.request);
  const fields = [];
  const values = [];
  const statements = [];

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

  if (body.photo !== undefined) {
    if (body.photo === null || body.photo === '') {
      // 사진을 지울 때는 판 번호를 0 으로 되돌리지 않고 부호만 뒤집는다.
      // 0 으로 돌리면 다음에 올린 사진이 예전에 쓰던 번호를 다시 쓰게 되고,
      // 그 주소를 캐시해 둔 브라우저는 지운 사진을 계속 보여 준다.
      // 음수는 "사진 없음" 이라 화면에서는 이모지로 돌아간다.
      statements.push(db.prepare(`DELETE FROM user_photos WHERE user_id = ?`).bind(user.id));
      fields.push('photo_version = -ABS(photo_version)');
    } else {
      const photo = normalizePhoto(body.photo);
      if (photo.error) return fail(400, photo.error);
      statements.push(
        db.prepare(
          `INSERT INTO user_photos (user_id, mime, size, data, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE
             SET mime = excluded.mime,
                 size = excluded.size,
                 data = excluded.data,
                 updated_at = excluded.updated_at`,
        ).bind(user.id, photo.mime, photo.size, photo.base64),
      );
      // 판 번호를 하나 올리면 주소가 바뀌어 브라우저가 새 사진을 받아 간다.
      // 지운 뒤(음수)에도 크기는 그대로 이어받으므로 번호가 되돌아가지 않는다.
      fields.push('photo_version = ABS(photo_version) + 1');
    }
  }

  if (!fields.length) return fail(400, '바꿀 내용이 없습니다.');

  statements.push(
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values, user.id),
  );
  await db.batch(statements);

  const row = await db.prepare(
    `SELECT id, username, display_name, avatar, photo_version, role
       FROM users WHERE id = ?`,
  ).bind(user.id).first();

  return json({
    ok: true,
    nicknameMax: NICKNAME_MAX,
    photoMaxSide: MAX_PHOTO_SIDE,
    user: await userWithSetterGames(db, personOf(row, { role: row.role })),
  });
}
