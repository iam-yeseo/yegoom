import { fail, json, normalizeSeconds, readJson, requireAdmin, todayKST } from '../lib/util.js';
import { closeExpiredRounds, settleRound, unsettleRound } from '../lib/game.js';

/**
 * 운영자가 오늘의 정답을 등록하고 라운드를 확정한다.
 *
 * 19시가 지나면 예측은 자동으로 마감되지만, 실제 퇴근이 그보다 늦을 수 있으니
 * 정답 입력은 그날 안에는 계속 열어 둔다. 그날이 지나도록 정답이 없으면
 * 그 날짜는 '게임 없음' 으로 굳고 회차도 올라가지 않는다.
 */
export async function onRequestPost(context) {
  const { user, response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const seconds = normalizeSeconds(body.time ?? body.seconds);
  if (seconds === null) return fail(400, '정답 시간을 HH:MM:SS 형식으로 입력해 주세요.');

  const gameDate = todayKST();
  if (typeof body.date === 'string' && body.date !== gameDate) {
    return fail(409, '지난 날짜의 정답은 등록할 수 없습니다. 오늘 게임만 확정할 수 있어요.');
  }

  const summary = await settleRound(context.env.DB, gameDate, seconds, user.id);
  return json({ ok: true, ...summary });
}

/** 잘못 입력한 정답 취소 — 라운드를 공개 전 상태로 되돌린다 (예측은 유지). */
export async function onRequestDelete(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const db = context.env.DB;
  const gameDate = todayKST();
  const result = await unsettleRound(db, gameDate);
  await closeExpiredRounds(db);

  return json({ ok: true, date: gameDate, status: result.status });
}
