// 출제자가 자기 게임의 정답을 서버에만 적어 두는 곳.
//
// 오전 게임은 '기상했어요' 버튼을 누른 시각이 곧 정답이고,
// 오후 게임은 출제자가 퇴근할 시간을 직접 적는다.
//
// 여기 적힌 정답은 공개 전까지 출제자 본인 말고 아무에게도 내려가지 않는다.
// 라운드 status 도 'open' 그대로라, 남들은 정답이 기록됐는지조차 알 수 없다.

import {
  fail, json, normalizeSeconds, nowSecondsKST, readJson, requireUser, secondsToHHMMSS, todayKST,
} from '../lib/util.js';
import { canRecordAnswer } from '../lib/game.js';
import { gameOf } from '../lib/games.js';
import { chancesFor } from '../lib/config.js';
import { getSetter } from '../lib/setter.js';

/** 이 게임의 출제자인지 확인하고, 오늘 라운드를 함께 돌려준다. */
async function requireSetter(context, game) {
  const { user, response } = await requireUser(context);
  if (response) return { response };

  const db = context.env.DB;
  const setter = await getSetter(db, game.key);
  if (!setter || setter.id !== user.id) {
    return { response: fail(403, `${game.label}의 출제자만 정답을 기록할 수 있습니다.`) };
  }

  const gameDate = todayKST();
  const round = await db
    .prepare(
      `SELECT status, answer_seconds, chances_total, chances_used FROM rounds
        WHERE game = ? AND game_date = ?`,
    )
    .bind(game.key, gameDate)
    .first();

  if (round?.status === 'settled') {
    return { response: fail(409, '이미 정답을 공개해서 바꿀 수 없습니다.') };
  }
  if (round?.status === 'void') {
    return { response: fail(409, `오늘 ${game.label}은 이미 끝났어요.`) };
  }
  // 기회를 한 번이라도 썼다면 그 힌트가 이 정답을 기준으로 나간 뒤다.
  // 이제 와서 정답을 바꾸면 앞의 힌트가 거짓말이 되므로 잠근다.
  if (round?.chances_used) {
    return { response: fail(409, '이미 기회를 써서 정답을 바꿀 수 없어요.') };
  }

  return { user, db, gameDate, round };
}

/** 정답 기록 — 오전은 버튼을 누른 시각, 오후는 적어 낸 시각이 정답이 된다. */
export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const game = gameOf(body.game);

  const { user, db, gameDate, round, response } = await requireSetter(context, game);
  if (response) return response;

  if (!canRecordAnswer(game.key, gameDate)) {
    return fail(
      409,
      `${game.label} 정답은 ${game.answerFromLabel} ~ ${game.answerToLabel} 사이에만 기록할 수 있어요.`,
    );
  }

  const seconds = game.answerMode === 'button'
    ? nowSecondsKST()                                  // 버튼을 누른 '지금'이 정답
    : normalizeSeconds(body.time ?? body.seconds);
  if (seconds === null) return fail(400, '정답 시간을 HH:MM:SS 형식으로 입력해 주세요.');

  // 그날의 기회 수는 정답을 기록하는 순간 라운드에 박아 둔다. 그래야 운영자가
  // 도중에 설정을 바꿔도 이미 시작된 게임이 흔들리지 않는다.
  const chances = round?.chances_total ?? (await chancesFor(db, game.key));

  await db
    .prepare(
      `INSERT INTO rounds
         (game, game_date, setter_user_id, answer_seconds, answered_at,
          chances_total, status, created_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?, 'open', ?)
       ON CONFLICT(game, game_date) DO UPDATE
         SET setter_user_id = excluded.setter_user_id,
             answer_seconds = excluded.answer_seconds,
             answered_at    = excluded.answered_at,
             chances_total  = excluded.chances_total,
             created_by     = excluded.created_by`,
    )
    .bind(game.key, gameDate, user.id, seconds, chances, user.id)
    .run();

  return json({
    ok: true,
    game: game.key,
    date: gameDate,
    answer: secondsToHHMMSS(seconds),
    recordedAt: secondsToHHMMSS(nowSecondsKST()),
    chances,
  });
}

/** 잘못 누른 정답 지우기 — 공개 전이고 기록 시간대 안이라면 되돌릴 수 있다. */
export async function onRequestDelete(context) {
  const body = await readJson(context.request);
  const url = new URL(context.request.url);
  const game = gameOf(body.game ?? url.searchParams.get('game'));

  const { db, gameDate, response } = await requireSetter(context, game);
  if (response) return response;

  if (!canRecordAnswer(game.key, gameDate)) {
    return fail(409, `${game.answerToLabel} 이 지나 기록을 되돌릴 수 없어요.`);
  }

  await db
    .prepare(
      `UPDATE rounds SET answer_seconds = NULL, answered_at = NULL
        WHERE game = ? AND game_date = ? AND status = 'open'`,
    )
    .bind(game.key, gameDate)
    .run();

  return json({ ok: true, game: game.key, date: gameDate });
}
