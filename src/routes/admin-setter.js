import { fail, json, personOf, readJson, requireAdmin } from '../lib/util.js';
import { assignSetterStatements, getSetter } from '../lib/setter.js';

/** 출제자 후보(플레이어 전원)와 지금 지정된 출제자 */
export async function onRequestGet(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const db = context.env.DB;
  const [{ results }, setter] = await Promise.all([
    db.prepare(
      `SELECT id, username, display_name, avatar, photo_version, is_setter FROM users
        WHERE role = 'player' ORDER BY id`,
    ).all(),
    getSetter(db),
  ]);

  return json({
    ok: true,
    setter,
    candidates: (results ?? []).map((u) => personOf(u, { isSetter: u.is_setter === 1 })),
  });
}

/**
 * 출제자를 지정한다. 이 사람의 퇴근시간이 그날의 정답이 된다.
 * 운영자는 정답을 등록하는 쪽이라 출제자가 될 수 없다.
 */
export async function onRequestPost(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const userId = Number(body.userId ?? body.id);
  if (!Number.isInteger(userId)) return fail(400, '출제자로 지정할 참가자를 골라 주세요.');

  const db = context.env.DB;
  const target = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first();
  if (!target) return fail(404, '없는 계정입니다.');
  if (target.role === 'admin') return fail(400, '운영자는 출제자가 될 수 없습니다.');

  await db.batch(assignSetterStatements(db, userId));

  return json({ ok: true, setter: await getSetter(db) });
}
