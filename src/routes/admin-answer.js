import { fail, json, normalizeMinutes, readJson, requireAdmin, todayKST } from '../lib/util.js';
import { settleRound } from '../lib/game.js';

/** 운영자가 오늘(또는 지정 날짜)의 정답을 등록하고 라운드를 확정한다. */
export async function onRequestPost(context) {
  const { user, response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const minutes = normalizeMinutes(body.time ?? body.minutes);
  if (minutes === null) return fail(400, '정답 시간을 HH:MM 형식으로 입력해 주세요.');

  const gameDate = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : todayKST();

  const summary = await settleRound(context.env.DB, gameDate, minutes, user.id);
  return json({ ok: true, ...summary });
}

/** 잘못 입력한 정답 취소 — 라운드를 공개 전 상태로 되돌린다 (예측은 유지). */
export async function onRequestDelete(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const gameDate = url.searchParams.get('date') ?? todayKST();
  const db = context.env.DB;

  await db.batch([
    db.prepare(`DELETE FROM results WHERE game_date = ?`).bind(gameDate),
    db.prepare(
      `UPDATE rounds SET answer_minutes = NULL, revealed_at = NULL WHERE game_date = ?`,
    ).bind(gameDate),
  ]);

  return json({ ok: true, date: gameDate });
}
