// 라운드 로직 — 마감 시각, 점수 계산, 정답 확정, 회차 관리.

import { renumberRoundsStatements } from './migrate.js';
import { getSetter } from './setter.js';
import { nowSecondsKST, secondsToHHMMSS, shiftDate, todayKST } from './util.js';

/** 매일 19:00 (KST) 이 지나면 그날 게임은 자동으로 마감된다. */
export const CLOSE_SECONDS = 19 * 3600;
export const CLOSE_LABEL = '19:00';

/** 정답과의 차이(초)로 점수를 매긴다. 동점자도 각자 같은 기준으로 받는다. */
export const SCORE_RULES = [
  { within: 0, score: 3, label: '초까지 정확히' },
  { within: 60, score: 2, label: '60초 이내' },
  { within: 120, score: 1, label: '120초 이내' },
];

export function scoreFor(diffSeconds) {
  for (const rule of SCORE_RULES) {
    if (diffSeconds <= rule.within) return rule.score;
  }
  return 0;
}

/** 그날의 예측 마감 여부 — 오늘이 아니거나, 오늘이라도 19시가 지났으면 마감 */
export function isClosed(gameDate, now = new Date()) {
  const today = todayKST(now);
  if (gameDate !== today) return true;
  return nowSecondsKST(now) >= CLOSE_SECONDS;
}

/** 자동 마감 대상의 마지막 날짜 (이 날짜까지는 더 이상 예측을 받지 않는다) */
function lastClosableDate(now = new Date()) {
  const today = todayKST(now);
  return nowSecondsKST(now) >= CLOSE_SECONDS ? today : shiftDate(today, -1);
}

/**
 * 마감 시각이 지났는데 정답이 안 들어온 날들을 '게임 없음(void)' 으로 정리한다.
 * void 는 회차를 올리지 않는다. 이미 정답이 공개된 날(settled)은 건드리지 않는다.
 *
 * 읽기 라우트마다 불리므로, 정리할 게 있을 때만 쓰기를 한다.
 */
export async function closeExpiredRounds(db, now = new Date()) {
  const limit = lastClosableDate(now);

  const pending = await db
    .prepare(
      `SELECT 1 AS hit FROM rounds WHERE status = 'open' AND game_date <= ?1
       UNION ALL
       SELECT 1 AS hit FROM guesses
        WHERE game_date <= ?1 AND game_date NOT IN (SELECT game_date FROM rounds)
       LIMIT 1`,
    )
    .bind(limit)
    .first();
  if (!pending) return { closed: false };

  await db.batch([
    // 라운드 행이 아예 없는 날(운영자가 아무것도 안 건드린 날)도 기록을 남긴다
    db
      .prepare(
        `INSERT INTO rounds (game_date, status, closed_at)
         SELECT DISTINCT game_date, 'void', datetime('now') FROM guesses
          WHERE game_date <= ? AND game_date NOT IN (SELECT game_date FROM rounds)`,
      )
      .bind(limit),
    db
      .prepare(
        `UPDATE rounds SET status = 'void', closed_at = datetime('now')
          WHERE status = 'open' AND game_date <= ?`,
      )
      .bind(limit),
  ]);

  return { closed: true };
}

/** 지금까지 정상적으로 끝난 게임 수 */
export async function settledCount(db) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM rounds WHERE status = 'settled'`)
    .first();
  return row?.n ?? 0;
}

/**
 * 화면에 보여 줄 회차 번호.
 * 이미 끝난 라운드는 자기 번호를, 아직 진행 중이면 "다음 회차"를 쓴다 (기본값 1).
 */
export async function roundNumberFor(db, round) {
  if (round?.status === 'settled' && round.round_no) return round.round_no;
  return (await settledCount(db)) + 1;
}

/**
 * 정답을 공개하고 결과를 확정한다.
 * - 오차는 |예측 - 정답| (초)
 * - 점수는 SCORE_RULES 대로, 동점이어도 각자 같은 점수를 받는다
 * - 오차가 가장 작은 사람이 그날의 우승, 동점이면 공동 우승
 * - 예측을 제출하지 않은 사람은 결과에서 제외
 *
 * 그날의 출제자가 누구였는지도 함께 남긴다. 나중에 출제자가 바뀌어도 지난 회차의
 * 기록은 그대로 읽힌다.
 */
export async function settleRound(db, gameDate, answerSeconds, adminId) {
  const [{ results: guesses }, setter] = await Promise.all([
    db.prepare(`SELECT user_id, guess_seconds FROM guesses WHERE game_date = ?`)
      .bind(gameDate).all(),
    getSetter(db),
  ]);

  const scored = (guesses ?? []).map((g) => {
    const diff = Math.abs(g.guess_seconds - answerSeconds);
    return { userId: g.user_id, diff, score: scoreFor(diff) };
  });
  const best = scored.length ? Math.min(...scored.map((s) => s.diff)) : null;

  await db.batch([
    db
      .prepare(
        `INSERT INTO rounds
           (game_date, setter_user_id, answer_seconds, status, revealed_at, closed_at, created_by)
         VALUES (?, ?, ?, 'settled', datetime('now'), datetime('now'), ?)
         ON CONFLICT(game_date) DO UPDATE
           SET setter_user_id = excluded.setter_user_id,
               answer_seconds = excluded.answer_seconds,
               status         = 'settled',
               revealed_at    = excluded.revealed_at,
               closed_at      = excluded.closed_at,
               created_by     = excluded.created_by`,
      )
      .bind(gameDate, setter?.id ?? null, answerSeconds, adminId),
    // 재공개(정답 수정)를 대비해 이전 결과를 지우고 다시 쓴다
    db.prepare(`DELETE FROM results WHERE game_date = ?`).bind(gameDate),
    ...scored.map((s) =>
      db
        .prepare(
          `INSERT INTO results (game_date, user_id, diff_seconds, score, is_winner)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(gameDate, s.userId, s.diff, s.score, s.diff === best ? 1 : 0),
    ),
    ...renumberRoundsStatements(db),
  ]);

  const round = await db
    .prepare(`SELECT round_no FROM rounds WHERE game_date = ?`)
    .bind(gameDate)
    .first();

  return {
    gameDate,
    roundNo: round?.round_no ?? null,
    setter,
    answer: secondsToHHMMSS(answerSeconds),
    answerSeconds,
    participants: scored.length,
    winners: scored.filter((s) => s.diff === best).map((s) => s.userId),
  };
}

/**
 * 정답 공개를 취소한다. 예측은 그대로 두고 라운드만 되돌린다.
 * 마감 시각이 지난 날이면 '게임 없음' 으로, 아직이면 다시 진행 중으로 돌아간다.
 */
export async function unsettleRound(db, gameDate, now = new Date()) {
  const status = isClosed(gameDate, now) ? 'void' : 'open';

  await db.batch([
    db.prepare(`DELETE FROM results WHERE game_date = ?`).bind(gameDate),
    db
      .prepare(
        `UPDATE rounds
            SET answer_seconds = NULL,
                revealed_at    = NULL,
                round_no       = NULL,
                status         = ?,
                closed_at      = CASE WHEN ? = 'void' THEN datetime('now') ELSE NULL END
          WHERE game_date = ?`,
      )
      .bind(status, status, gameDate),
    ...renumberRoundsStatements(db),
  ]);

  return { gameDate, status };
}

/** 오차(초)를 "1분 12초 차이" 같은 한국어 문구로 */
export function formatDiff(diff) {
  if (diff === null || diff === undefined) return null;
  if (diff === 0) return '정확히 맞힘';

  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;

  const parts = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  // 시간 단위까지 벌어지면 초는 굳이 읽어 주지 않는다
  if (s && !h) parts.push(`${s}초`);

  return `${parts.join(' ')} 차이`;
}

/** 점수를 "+3점" 처럼 */
export function formatScore(score) {
  return `${score > 0 ? '+' : ''}${score}점`;
}
