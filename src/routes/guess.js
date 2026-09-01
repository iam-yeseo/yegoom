import { fail, json, normalizeSeconds, readJson, requireUser, secondsToHHMMSS, todayKST } from '../lib/util.js';
import { CLOSE_LABEL, closeExpiredRounds, isClosed } from '../lib/game.js';

/** 플레이어가 오늘의 퇴근시간을 예측한다. 마감(19:00) 전까지는 몇 번이든 수정 가능. */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 예측을 제출할 수 없습니다.');

  const body = await readJson(context.request);
  const seconds = normalizeSeconds(body.time ?? body.seconds);
  if (seconds === null) return fail(400, '시간을 HH:MM:SS 형식으로 입력해 주세요.');

  const gameDate = todayKST();
  const db = context.env.DB;

  if (isClosed(gameDate)) {
    await closeExpiredRounds(db);
    return fail(409, `${CLOSE_LABEL} 이 지나 오늘 게임은 마감됐어요.`);
  }

  const round = await db.prepare(`SELECT status FROM rounds WHERE game_date = ?`)
    .bind(gameDate).first();
  if (round?.status === 'settled') {
    return fail(409, '이미 정답이 공개되어 예측을 바꿀 수 없습니다.');
  }
  if (round?.status === 'void') return fail(409, '오늘 게임은 마감됐어요.');

  await db
    .prepare(
      `INSERT INTO guesses (game_date, user_id, guess_seconds)
       VALUES (?, ?, ?)
       ON CONFLICT(game_date, user_id) DO UPDATE
         SET guess_seconds = excluded.guess_seconds,
             updated_at    = datetime('now')`,
    )
    .bind(gameDate, user.id, seconds)
    .run();

  return json({ ok: true, date: gameDate, guess: secondsToHHMMSS(seconds) });
}
