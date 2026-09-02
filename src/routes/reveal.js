// 출제자가 기록해 둔 정답을 공개한다.
//
// 예측을 낸 사람이 두 명 이상 모여야 공개할 수 있다. 공개하는 순간 오차와 점수가
// 확정되고 회차가 하나 올라간다.

import { fail, json, readJson, requireUser, todayKST } from '../lib/util.js';
import { canReveal, guessCount, revealRound } from '../lib/game.js';
import { MIN_PLAYERS_TO_REVEAL, gameOf } from '../lib/games.js';

export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;

  const body = await readJson(context.request);
  const game = gameOf(body.game);
  const db = context.env.DB;
  const gameDate = todayKST();

  const round = await db
    .prepare(
      `SELECT setter_user_id, answer_seconds, status FROM rounds
        WHERE game = ? AND game_date = ?`,
    )
    .bind(game.key, gameDate)
    .first();

  // 정답을 기록해 둔 사람만 공개할 수 있다. 기록이 없으면 출제자에게도
  // "아직 기록 전" 이라고만 알려 준다 (다른 사람은 여기까지 오지도 못한다).
  if (!round || round.setter_user_id !== user.id) {
    return fail(403, '정답을 기록한 출제자만 공개할 수 있습니다.');
  }
  if (round.status === 'settled') return fail(409, '이미 정답을 공개했어요.');
  if (round.status === 'void') return fail(409, `오늘 ${game.label}은 이미 끝났어요.`);
  if (round.answer_seconds === null || round.answer_seconds === undefined) {
    return fail(409, '아직 정답을 기록하지 않았어요.');
  }

  const guesses = await guessCount(db, game.key, gameDate);
  if (!canReveal({ answerRecorded: true, guesses, status: round.status })) {
    return fail(
      409,
      `예측을 낸 사람이 ${MIN_PLAYERS_TO_REVEAL}명 이상이어야 공개할 수 있어요. (지금 ${guesses}명)`,
    );
  }

  const summary = await revealRound(db, game.key, gameDate, round);
  return json({ ok: true, ...summary });
}
