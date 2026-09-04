import {
  fail, json, normalizeSeconds, readJson, requireUser, secondsToHHMMSS, todayKST,
} from '../lib/util.js';
import { closeExpiredRounds, isClosed } from '../lib/game.js';
import { gameOf } from '../lib/games.js';
import { getSetter } from '../lib/setter.js';

/**
 * 플레이어가 오늘의 시간을 예측한다 (오전은 기상시간, 오후는 퇴근시간).
 * 마감 전까지는 몇 번이든 바꿀 수 있다.
 */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 예측을 제출할 수 없습니다.');

  const body = await readJson(context.request);
  const game = gameOf(body.game);
  const seconds = normalizeSeconds(body.time ?? body.seconds);
  if (seconds === null) return fail(400, '시간을 HH:MM:SS 형식으로 입력해 주세요.');

  const db = context.env.DB;
  const gameDate = todayKST();

  const setter = await getSetter(db, game.key);
  if (setter?.id === user.id) {
    return fail(403, `출제자는 자기 ${game.subject}을 예측할 수 없습니다.`);
  }

  if (isClosed(game.key, gameDate)) {
    await closeExpiredRounds(db);
    return fail(409, `${game.closeLabel} 이 지나 오늘 ${game.label}는 마감됐어요.`);
  }

  const round = await db.prepare(`SELECT status FROM rounds WHERE game = ? AND game_date = ?`)
    .bind(game.key, gameDate).first();
  if (round?.status === 'settled') {
    return fail(409, '이미 정답이 공개되어 예측을 바꿀 수 없습니다.');
  }
  if (round?.status === 'void') return fail(409, `오늘 ${game.label}는 마감됐어요.`);

  await db
    .prepare(
      `INSERT INTO guesses (game, game_date, user_id, guess_seconds)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(game, game_date, user_id) DO UPDATE
         SET guess_seconds = excluded.guess_seconds,
             updated_at    = datetime('now')`,
    )
    .bind(game.key, gameDate, user.id, seconds)
    .run();

  return json({ ok: true, game: game.key, date: gameDate, guess: secondsToHHMMSS(seconds) });
}
