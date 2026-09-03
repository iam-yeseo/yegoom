// 라운드 로직 — 마감 시각, 점수 계산, 정답 기록과 공개, 회차 관리.
//
// 오전(기상시간)과 오후(퇴근시간) 두 게임이 같은 코드를 쓰고, 시간대만
// src/lib/games.js 의 정의에서 가져온다.

import {
  CLOSE_ENOUGH_SECONDS, GAMES, GAME_KEYS, MIN_PLAYERS_TO_REVEAL, gameOf,
} from './games.js';
import { renumberRoundsStatements } from './migrate.js';
import { nowSecondsKST, secondsToHHMMSS, shiftDate, todayKST } from './util.js';

/** 그 게임의 배점표 (src/lib/games.js 에 게임마다 하나씩 적혀 있다) */
export function scoreRulesOf(game) {
  return gameOf(game).scoreRules;
}

/**
 * 정답과의 차이(초)로 점수를 매긴다. 배점은 게임마다 다르고,
 * 위에서부터 처음 걸리는 칸의 점수를 준다. 동점자도 각자 같은 기준으로 받는다.
 */
export function scoreFor(game, diffSeconds) {
  for (const rule of scoreRulesOf(game)) {
    if (diffSeconds <= rule.within) return rule.score;
  }
  return 0;
}

/** 그날의 예측 마감 여부 — 오늘이 아니거나, 오늘이라도 마감 시각이 지났으면 마감 */
export function isClosed(game, gameDate, now = new Date()) {
  const g = gameOf(game);
  if (gameDate !== todayKST(now)) return true;
  return nowSecondsKST(now) >= g.closeSeconds;
}

/** 출제자가 지금 정답을 넣을 수 있는 시간대인지 (오전 00:00~09:59:59 / 오후 09:00~17:59:59) */
export function canRecordAnswer(game, gameDate, now = new Date()) {
  const g = gameOf(game);
  if (gameDate !== todayKST(now)) return false;
  const sec = nowSecondsKST(now);
  return sec >= g.answerFrom && sec < g.answerTo;
}

/** 정답 기록 시간대가 이미 지났는지 — 지난 날짜이거나, 오늘이라도 기록 마감이 지났으면 */
export function answerWindowOver(game, gameDate, now = new Date()) {
  const g = gameOf(game);
  if (gameDate !== todayKST(now)) return true;
  return nowSecondsKST(now) >= g.answerTo;
}

/**
 * 정답 없이 넘겨 버린 마지막 날짜.
 * 이 날짜까지는 정답이 안 들어왔으면 '게임 없음' 으로 굳는다.
 *
 * 기준은 정답 기록 마감이 아니라 예측 마감이다. 오전 게임은 정답 기록이 두 시간
 * 먼저 끝나는데, 그 시각에 바로 void 로 굳혀 버리면 "출제자가 정답을 안 넣었다" 가
 * 남들에게 새 나간다 — 그건 공개 전까지 아무도 몰라야 하는 것이다.
 */
function answerVoidLimit(game, now = new Date()) {
  const g = gameOf(game);
  const today = todayKST(now);
  return nowSecondsKST(now) >= g.closeSeconds ? today : shiftDate(today, -1);
}

/**
 * 끝난 날들을 '게임 없음(void)' 으로 정리한다. void 는 회차를 올리지 않는다.
 *
 *   1) 정답 기록 시간이 지났는데 출제자가 정답을 넣지 않은 날
 *   2) 정답은 기록됐지만 끝내 공개되지 않은 채 날짜가 바뀐 날
 *
 * 읽기 라우트마다 불리므로, 정리할 게 있을 때만 쓰기를 한다.
 * 정답이 기록돼 있고 아직 오늘이면 건드리지 않는다 — 출제자가 공개하기 전까지는
 * 남들이 정답 기록 여부를 눈치챌 수 없어야 하기 때문이다.
 */
export async function closeExpiredRounds(db, now = new Date()) {
  const today = todayKST(now);
  let closed = false;

  for (const key of GAME_KEYS) {
    const limit = answerVoidLimit(GAMES[key], now);

    const pending = await db
      .prepare(
        `SELECT 1 AS hit FROM rounds
          WHERE game = ?1 AND status = 'open'
            AND ((answer_seconds IS NULL AND game_date <= ?2) OR game_date < ?3)
         UNION ALL
         SELECT 1 AS hit FROM guesses g
          WHERE g.game = ?1 AND g.game_date <= ?2
            AND NOT EXISTS (SELECT 1 FROM rounds r
                             WHERE r.game = g.game AND r.game_date = g.game_date)
         LIMIT 1`,
      )
      .bind(key, limit, today)
      .first();
    if (!pending) continue;

    await db.batch([
      // 라운드 행이 아예 없는 날(출제자가 아무것도 안 건드린 날)도 기록을 남긴다
      db
        .prepare(
          `INSERT INTO rounds (game, game_date, status, closed_at)
           SELECT DISTINCT g.game, g.game_date, 'void', datetime('now') FROM guesses g
            WHERE g.game = ?1 AND g.game_date <= ?2
              AND NOT EXISTS (SELECT 1 FROM rounds r
                               WHERE r.game = g.game AND r.game_date = g.game_date)`,
        )
        .bind(key, limit),
      db
        .prepare(
          `UPDATE rounds SET status = 'void', closed_at = datetime('now')
            WHERE game = ?1 AND status = 'open'
              AND ((answer_seconds IS NULL AND game_date <= ?2) OR game_date < ?3)`,
        )
        .bind(key, limit, today),
    ]);
    closed = true;
  }

  return { closed };
}

/** 그 게임에서 지금까지 정상적으로 끝난 게임 수 */
export async function settledCount(db, game) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM rounds WHERE game = ? AND status = 'settled'`)
    .bind(gameOf(game).key)
    .first();
  return row?.n ?? 0;
}

/**
 * 화면에 보여 줄 회차 번호. 회차는 게임마다 따로 센다.
 * 이미 끝난 라운드는 자기 번호를, 아직 진행 중이면 "다음 회차"를 쓴다 (기본값 1).
 */
export async function roundNumberFor(db, game, round) {
  if (round?.status === 'settled' && round.round_no) return round.round_no;
  return (await settledCount(db, game)) + 1;
}

/** 그 라운드에 들어온 예측 수 */
export async function guessCount(db, game, gameDate) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM guesses WHERE game = ? AND game_date = ?`)
    .bind(gameOf(game).key, gameDate)
    .first();
  return row?.n ?? 0;
}

/** 기회를 쓰거나 정답을 공개하기 위한 공통 조건 */
function readyToAct({ answerRecorded, guesses, status }) {
  return status === 'open' && answerRecorded && guesses >= MIN_PLAYERS_TO_REVEAL;
}

/**
 * 남은 기회 계산.
 * chances_total 은 정답을 기록할 때 떠 온 값이라, 그 뒤 운영자가 설정을 바꿔도
 * 진행 중인 라운드는 흔들리지 않는다. 아직 값이 없으면 지금 설정을 쓴다.
 */
export function chanceStateOf(round, configured) {
  const total = round?.chances_total ?? configured ?? 0;
  const used = round?.chances_used ?? 0;
  return { total, used, remaining: Math.max(0, total - used) };
}

/** 출제자가 기회를 쓸 수 있는 조건 — 공개 조건에 더해 남은 기회가 있어야 한다. */
export function canBurnChance({ answerRecorded, guesses, status, remaining }) {
  return readyToAct({ answerRecorded, guesses, status }) && remaining > 0;
}

/**
 * 출제자가 정답을 공개할 수 있는 조건 — 정답이 기록돼 있고 예측이 2명 이상.
 * 이미 공개됐거나 '게임 없음' 으로 굳은 라운드는 더 이상 공개할 수 없다.
 *
 * 기회가 걸린 게임이라면 기회를 다 써야 공개할 수 있다. 다만 예측이 마감된
 * 뒤에는 더 받을 답이 없으므로 남은 기회와 상관없이 공개할 수 있게 둔다.
 */
export function canReveal({ answerRecorded, guesses, status, remaining = 0, closed = false }) {
  if (!readyToAct({ answerRecorded, guesses, status })) return false;
  return remaining <= 0 || closed;
}

/**
 * 기회를 한 번 쓴다.
 *
 * 그때까지 예측을 낸 사람 중 정답에 가장 가까운 한 명이 하이라이트를 받는다.
 * 5분 이상 벌어져 있으면 가장 가까운 사람이라도 아무도 뽑지 않는다.
 * 오차가 같으면 먼저 낸 사람이 뽑힌다.
 *
 * 나가는 것은 "누가 가장 가까운가" 뿐이다. 오차 값은 남기기만 하고 내보내지 않는다
 * — 자기 예측을 아는 사람이 오차까지 알면 정답이 그대로 드러나기 때문이다.
 */
export async function burnChance(db, game, gameDate, round) {
  const key = gameOf(game).key;
  const seq = (round.chances_used ?? 0) + 1;

  const [closest, counted] = await Promise.all([
    db
      .prepare(
        `SELECT user_id, ABS(guess_seconds - ?) AS diff FROM guesses
          WHERE game = ? AND game_date = ?
          ORDER BY diff ASC, updated_at ASC, user_id ASC LIMIT 1`,
      )
      .bind(round.answer_seconds, key, gameDate)
      .first(),
    guessCount(db, key, gameDate),
  ]);

  const hit = closest && closest.diff < CLOSE_ENOUGH_SECONDS ? closest : null;

  await db.batch([
    db
      .prepare(
        `INSERT INTO round_chances (game, game_date, seq, user_id, diff_seconds, guesses)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(game, game_date, seq) DO UPDATE
           SET user_id      = excluded.user_id,
               diff_seconds = excluded.diff_seconds,
               guesses      = excluded.guesses,
               created_at   = datetime('now')`,
      )
      .bind(key, gameDate, seq, hit?.user_id ?? null, closest?.diff ?? null, counted),
    db
      .prepare(
        `UPDATE rounds SET chances_used = ? WHERE game = ? AND game_date = ?`,
      )
      .bind(seq, key, gameDate),
  ]);

  return { seq, userId: hit?.user_id ?? null, guesses: counted };
}

/** 그 라운드에서 지금까지 쓴 기회들 (오차는 담지 않는다) */
export async function chanceLog(db, game, gameDate) {
  const { results } = await db
    .prepare(
      `SELECT seq, user_id, guesses, created_at FROM round_chances
        WHERE game = ? AND game_date = ? ORDER BY seq ASC`,
    )
    .bind(gameOf(game).key, gameDate)
    .all();
  return results ?? [];
}

/**
 * 기록해 둔 정답을 공개하고 결과를 확정한다.
 * - 오차는 |예측 - 정답| (초)
 * - 점수는 그 게임의 배점표(scoreRules)대로, 동점이어도 각자 같은 점수를 받는다
 * - 오차가 가장 작은 사람이 그날의 우승, 동점이면 공동 우승
 * - 예측을 제출하지 않은 사람은 결과에서 제외
 *
 * 그날의 출제자가 누구였는지는 정답을 기록할 때 이미 라운드에 남겨 두었다.
 * 나중에 출제자가 바뀌어도 지난 회차의 기록은 그대로 읽힌다.
 */
export async function revealRound(db, game, gameDate, round) {
  const key = gameOf(game).key;
  const answerSeconds = round.answer_seconds;

  const { results: guesses } = await db
    .prepare(`SELECT user_id, guess_seconds FROM guesses WHERE game = ? AND game_date = ?`)
    .bind(key, gameDate)
    .all();

  const scored = (guesses ?? []).map((g) => {
    const diff = Math.abs(g.guess_seconds - answerSeconds);
    return { userId: g.user_id, diff, score: scoreFor(key, diff) };
  });
  const best = scored.length ? Math.min(...scored.map((s) => s.diff)) : null;

  await db.batch([
    db
      .prepare(
        `UPDATE rounds
            SET status = 'settled', revealed_at = datetime('now'), closed_at = datetime('now')
          WHERE game = ? AND game_date = ?`,
      )
      .bind(key, gameDate),
    // 재공개(정답 수정)를 대비해 이전 결과를 지우고 다시 쓴다
    db.prepare(`DELETE FROM results WHERE game = ? AND game_date = ?`).bind(key, gameDate),
    ...scored.map((s) =>
      db
        .prepare(
          `INSERT INTO results (game, game_date, user_id, diff_seconds, score, is_winner)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(key, gameDate, s.userId, s.diff, s.score, s.diff === best ? 1 : 0),
    ),
    ...renumberRoundsStatements(db),
  ]);

  const settled = await db
    .prepare(`SELECT round_no FROM rounds WHERE game = ? AND game_date = ?`)
    .bind(key, gameDate)
    .first();

  return {
    game: key,
    gameDate,
    roundNo: settled?.round_no ?? null,
    answer: secondsToHHMMSS(answerSeconds),
    answerSeconds,
    participants: scored.length,
    winners: scored.filter((s) => s.diff === best).map((s) => s.userId),
  };
}

/**
 * 정답 공개를 취소한다. 예측과 기록해 둔 정답은 그대로 두고 라운드만 되돌린다.
 * 마감 시각이 지난 날이면 '게임 없음' 으로, 아직이면 다시 진행 중으로 돌아간다.
 */
export async function unsettleRound(db, game, gameDate, now = new Date()) {
  const key = gameOf(game).key;
  const status = isClosed(key, gameDate, now) ? 'void' : 'open';

  await db.batch([
    db.prepare(`DELETE FROM results WHERE game = ? AND game_date = ?`).bind(key, gameDate),
    db
      .prepare(
        `UPDATE rounds
            SET revealed_at = NULL,
                round_no    = NULL,
                status      = ?,
                closed_at   = CASE WHEN ? = 'void' THEN datetime('now') ELSE NULL END
          WHERE game = ? AND game_date = ?`,
      )
      .bind(status, status, key, gameDate),
    ...renumberRoundsStatements(db),
  ]);

  return { game: key, gameDate, status };
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
