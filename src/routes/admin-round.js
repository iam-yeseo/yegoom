// 운영자용 라운드 되돌리기.
//
// 정답을 기록하고 공개하는 일은 출제자 몫이라 운영자는 손대지 않는다.
// 다만 잘못 공개된 회차는 되돌릴 수 있어야 해서 이 하나만 남겨 둔다.
// (공개 전 라운드는 손댈 수 없다 — 정답이 기록됐는지는 운영자도 알 수 없다.)

import { fail, json, readJson, requireAdmin, todayKST } from '../lib/util.js';
import { closeExpiredRounds, unsettleRound } from '../lib/game.js';
import { gameOf } from '../lib/games.js';

/** 정답 공개 취소 — 라운드를 공개 전 상태로 되돌린다 (예측과 기록해 둔 정답은 유지). */
export async function onRequestDelete(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const url = new URL(context.request.url);
  const game = gameOf(body.game ?? url.searchParams.get('game'));

  const db = context.env.DB;
  const gameDate = body.date ?? url.searchParams.get('date') ?? todayKST();

  const round = await db
    .prepare(`SELECT status FROM rounds WHERE game = ? AND game_date = ?`)
    .bind(game.key, gameDate)
    .first();
  if (round?.status !== 'settled') {
    return fail(409, '공개된 회차만 되돌릴 수 있습니다.');
  }

  const result = await unsettleRound(db, game.key, gameDate);
  await closeExpiredRounds(db);

  return json({ ok: true, game: game.key, date: gameDate, status: result.status });
}
