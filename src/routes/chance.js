// 출제자가 '기회' 를 한 번 쓴다 (오후 게임).
//
// 한 번에 못 맞히면 그날 기회가 영영 사라지는 게임이라, 정답을 공개하기 전에
// 힌트를 한 번씩 흘려 준다. 기회를 쓰면 그때까지 예측한 사람 중 정답에 가장
// 가까운 한 명에게 하이라이트가 들어가고, 남은 기회 수가 모두에게 알려진다.
// 5분 이상 벌어져 있으면 가장 가까운 사람이라도 아무도 뽑히지 않는다.

import { fail, json, personOf, readJson, requireUser, todayKST } from '../lib/util.js';
import { burnChance, canBurnChance, chanceStateOf, guessCount } from '../lib/game.js';
import { MIN_PLAYERS_TO_REVEAL, gameOf } from '../lib/games.js';
import { chancesFor, usesChances } from '../lib/config.js';

export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;

  const body = await readJson(context.request);
  const game = gameOf(body.game);
  const db = context.env.DB;
  const gameDate = todayKST();

  if (!usesChances(game.key)) {
    return fail(400, `${game.label}에는 기회가 없습니다.`);
  }

  const round = await db
    .prepare(
      `SELECT setter_user_id, answer_seconds, status, chances_total, chances_used
         FROM rounds WHERE game = ? AND game_date = ?`,
    )
    .bind(game.key, gameDate)
    .first();

  // 정답을 기록해 둔 사람만 기회를 쓸 수 있다
  if (!round || round.setter_user_id !== user.id) {
    return fail(403, '정답을 기록한 출제자만 기회를 쓸 수 있습니다.');
  }
  if (round.status === 'settled') return fail(409, '이미 정답을 공개했어요.');
  if (round.status === 'void') return fail(409, `오늘 ${game.label}은 이미 끝났어요.`);
  if (round.answer_seconds === null || round.answer_seconds === undefined) {
    return fail(409, '아직 정답을 기록하지 않았어요.');
  }

  const [guesses, configured] = await Promise.all([
    guessCount(db, game.key, gameDate),
    chancesFor(db, game.key),
  ]);
  const chances = chanceStateOf(round, configured);

  if (!chances.remaining) return fail(409, '남은 기회가 없어요.');
  if (!canBurnChance({ answerRecorded: true, guesses, status: round.status, ...chances })) {
    return fail(
      409,
      `예측을 낸 사람이 ${MIN_PLAYERS_TO_REVEAL}명 이상이어야 기회를 쓸 수 있어요. (지금 ${guesses}명)`,
    );
  }

  const burned = await burnChance(db, game.key, gameDate, round);

  const closest = burned.userId
    ? await db
        .prepare(`SELECT id, username, display_name, avatar, photo_version FROM users WHERE id = ?`)
        .bind(burned.userId)
        .first()
    : null;

  return json({
    ok: true,
    game: game.key,
    date: gameDate,
    seq: burned.seq,
    used: burned.seq,
    total: chances.total,
    remaining: Math.max(0, chances.total - burned.seq),
    guesses: burned.guesses,
    closest: personOf(closest),
  });
}
