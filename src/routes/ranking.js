import { json, personOf, requireUser } from '../lib/util.js';
import { closeExpiredRounds, formatDiff } from '../lib/game.js';
import { gameInfo, gameKeyOf } from '../lib/games.js';
import { QUIZ, quizInfo } from '../lib/quiz.js';
import { getSetter } from '../lib/setter.js';

/**
 * 누적 랭킹.
 *
 *   ?game 없음               오전 · 오후 · 퀴즈를 전부 합쳐서 센다
 *   ?game=morning|evening    그 게임만 (점수 합계 -> 정확히 맞힌 횟수 -> 평균 오차 순)
 *   ?game=quiz               예굼퀴즈대회만 (점수 합계 -> 처음 맞힌 횟수 -> 맞힌 횟수 순)
 *
 * 시간 맞히기 게임의 출제자는 자기 게임 랭킹에서 빠지지만 합산 랭킹에는 남는다
 * (다른 게임에서는 평범한 플레이어이기 때문이다). 퀴즈는 출제자가 계속 바뀌므로
 * 아무도 빠지지 않는다. 운영자는 언제나 빠진다.
 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  await closeExpiredRounds(db);

  const raw = new URL(context.request.url).searchParams.get('game');
  const isQuiz = String(raw ?? '').trim() === QUIZ.key;
  const scope = isQuiz ? null : gameKeyOf(raw);

  if (isQuiz) return json({ ok: true, game: quizInfo(), ranking: await quizRanking(db) });

  const setter = scope ? await getSetter(db, scope) : null;

  const [{ results }, quizScores] = await Promise.all([
    db.prepare(
      `SELECT u.id,
              u.username,
              u.display_name,
              u.avatar,
              u.photo_version,
              COUNT(r.game_date)                                          AS played,
              COALESCE(SUM(r.score), 0)                                   AS score,
              COALESCE(SUM(CASE WHEN r.diff_seconds = 0 THEN 1 ELSE 0 END), 0) AS exacts,
              COALESCE(SUM(r.is_winner), 0)                               AS wins,
              CAST(ROUND(AVG(r.diff_seconds)) AS INTEGER)                 AS avg_diff,
              MIN(r.diff_seconds)                                         AS best_diff,
              COALESCE(SUM(CASE WHEN r.game = 'morning' THEN r.score ELSE 0 END), 0) AS morning_score,
              COALESCE(SUM(CASE WHEN r.game = 'evening' THEN r.score ELSE 0 END), 0) AS evening_score
         FROM users u
         LEFT JOIN results r ON r.user_id = u.id AND (?1 IS NULL OR r.game = ?1)
        WHERE u.role = 'player' AND (?2 IS NULL OR u.id <> ?2)
        GROUP BY u.id`,
    ).bind(scope, setter?.id ?? null).all(),
    // 합산으로 볼 때만 퀴즈 점수를 더한다 (오전/오후만 볼 때는 섞지 않는다)
    scope ? Promise.resolve(new Map()) : quizScoreMap(db),
  ]);

  const rows = (results ?? [])
    .map((row) => {
      const quiz = quizScores.get(row.id) ?? { score: 0, solved: 0, firsts: 0, played: 0 };
      return {
        ...row,
        quiz_score: quiz.score,
        quiz_played: quiz.played,
        quiz_firsts: quiz.firsts,
        total_score: row.score + quiz.score,
        total_played: row.played + quiz.played,
      };
    })
    // 점수 합계 -> 정확히 맞힌 횟수 -> 평균 오차 순 (오차가 없는 사람은 뒤로)
    .sort(
      (a, b) =>
        b.total_score - a.total_score ||
        b.exacts - a.exacts ||
        b.quiz_firsts - a.quiz_firsts ||
        (a.avg_diff === null) - (b.avg_diff === null) ||
        (a.avg_diff ?? 0) - (b.avg_diff ?? 0) ||
        a.id - b.id,
    );

  let rank = 0;
  let prevKey = null;
  const ranking = rows.map((row, idx) => {
    const key = `${row.total_score}|${row.exacts}|${row.quiz_firsts}|${row.avg_diff ?? 'x'}`;
    if (key !== prevKey) rank = idx + 1;   // 동률이면 같은 등수
    prevKey = key;
    return personOf(row, {
      rank,
      played: row.total_played,
      // 시간 맞히기와 퀴즈는 세는 단위가 달라서(회차 / 판) 따로도 내려 준다
      timePlayed: row.played,
      quizPlayed: row.quiz_played,
      score: row.total_score,
      exacts: row.exacts,
      wins: row.wins,
      morningScore: row.morning_score,
      eveningScore: row.evening_score,
      quizScore: row.quiz_score,
      quizSolved: quizScores.get(row.id)?.solved ?? 0,
      quizFirsts: row.quiz_firsts,
      avgDiff: row.avg_diff,
      avgDiffText: formatDiff(row.avg_diff),
      bestDiff: row.best_diff,
      bestDiffText: formatDiff(row.best_diff),
    });
  });

  return json({ ok: true, game: scope ? gameInfo(scope) : null, ranking });
}

/** 사람별 퀴즈 점수 — 맞힌 퀴즈만 점수가 된다 */
async function quizScoreMap(db) {
  const { results } = await db.prepare(
    `SELECT user_id,
            COALESCE(SUM(CASE WHEN solved_at IS NOT NULL THEN score ELSE 0 END), 0) AS score,
            COALESCE(SUM(CASE WHEN solved_at IS NOT NULL THEN 1 ELSE 0 END), 0)     AS solved,
            COALESCE(SUM(CASE WHEN solved_rank = 1 THEN 1 ELSE 0 END), 0)           AS firsts,
            COUNT(*)                                                                AS played
       FROM quiz_players GROUP BY user_id`,
  ).all();
  return new Map((results ?? []).map((r) => [r.user_id, r]));
}

/**
 * 예굼퀴즈대회만 따로 본 랭킹.
 * 점수 합계 -> 처음 맞힌 횟수 -> 맞힌 횟수 순이고, 출제 횟수도 함께 보여 준다.
 */
async function quizRanking(db) {
  const { results } = await db.prepare(
    `SELECT u.id,
            u.username,
            u.display_name,
            u.avatar,
            u.photo_version,
            COUNT(p.quiz_id)                                                         AS played,
            COALESCE(SUM(CASE WHEN p.solved_at IS NOT NULL THEN p.score ELSE 0 END), 0) AS score,
            COALESCE(SUM(CASE WHEN p.solved_at IS NOT NULL THEN 1 ELSE 0 END), 0)    AS solved,
            COALESCE(SUM(CASE WHEN p.solved_rank = 1 THEN 1 ELSE 0 END), 0)          AS firsts,
            COALESCE(SUM(p.hints_used), 0)                                           AS hints,
            COALESCE(SUM(p.wrongs), 0)                                               AS wrongs,
            (SELECT COUNT(*) FROM quiz_rounds q
              WHERE q.setter_user_id = u.id AND q.status = 'closed')                 AS made
       FROM users u
       LEFT JOIN quiz_players p ON p.user_id = u.id
      WHERE u.role = 'player'
      GROUP BY u.id
      ORDER BY score DESC, firsts DESC, solved DESC, u.id ASC`,
  ).all();

  let rank = 0;
  let prevKey = null;
  return (results ?? []).map((row, idx) => {
    const key = `${row.score}|${row.firsts}|${row.solved}`;
    if (key !== prevKey) rank = idx + 1;
    prevKey = key;
    return personOf(row, {
      rank,
      played: row.played,
      score: row.score,
      quizScore: row.score,
      solved: row.solved,
      firsts: row.firsts,
      hintsUsed: row.hints,
      wrongs: row.wrongs,
      made: row.made,
    });
  });
}
