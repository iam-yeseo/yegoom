import { fail, json, minutesToHHMM, normalizeMinutes, readJson, requireUser, todayKST } from '../_lib/util.js';

/** 플레이어가 오늘의 퇴근시간을 예측한다. 정답 공개 전까지는 수정 가능. */
export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 예측을 제출할 수 없습니다.');

  const body = await readJson(context.request);
  const minutes = normalizeMinutes(body.time ?? body.minutes);
  if (minutes === null) return fail(400, '시간을 HH:MM 형식으로 입력해 주세요.');

  const gameDate = todayKST();
  const db = context.env.DB;

  const round = await db.prepare(`SELECT revealed_at FROM rounds WHERE game_date = ?`)
    .bind(gameDate).first();
  if (round?.revealed_at) return fail(409, '이미 정답이 공개되어 예측을 바꿀 수 없습니다.');

  await db
    .prepare(
      `INSERT INTO guesses (game_date, user_id, guess_minutes)
       VALUES (?, ?, ?)
       ON CONFLICT(game_date, user_id) DO UPDATE
         SET guess_minutes = excluded.guess_minutes,
             updated_at    = datetime('now')`,
    )
    .bind(gameDate, user.id, minutes)
    .run();

  return json({ ok: true, date: gameDate, guess: minutesToHHMM(minutes) });
}
