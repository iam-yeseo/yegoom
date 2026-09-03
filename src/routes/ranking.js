import { json, personOf, requireUser } from '../lib/util.js';
import { closeExpiredRounds, formatDiff } from '../lib/game.js';
import { gameInfo, gameKeyOf } from '../lib/games.js';
import { getSetter } from '../lib/setter.js';

/**
 * 누적 랭킹 — 점수 합계 순, 동점이면 정확히 맞힌 횟수 -> 평균 오차 순.
 *
 * ?game=morning|evening 이면 그 게임만, 없으면 두 게임을 합쳐서 센다.
 * 그 게임의 출제자는 자기 게임 랭킹에서 빠지지만, 합산 랭킹에는 남는다
 * (다른 게임에서는 평범한 플레이어이기 때문이다). 운영자는 언제나 빠진다.
 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  await closeExpiredRounds(db);

  const scope = gameKeyOf(new URL(context.request.url).searchParams.get('game'));
  const setter = scope ? await getSetter(db, scope) : null;

  const { results } = await db.prepare(
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
      GROUP BY u.id
      ORDER BY score DESC, exacts DESC, (avg_diff IS NULL), avg_diff ASC, u.id ASC`,
  ).bind(scope, setter?.id ?? null).all();

  let rank = 0;
  let prevKey = null;
  const ranking = (results ?? []).map((row, idx) => {
    const key = `${row.score}|${row.exacts}|${row.avg_diff ?? 'x'}`;
    if (key !== prevKey) rank = idx + 1;   // 동률이면 같은 등수
    prevKey = key;
    return personOf(row, {
      rank,
      played: row.played,
      score: row.score,
      exacts: row.exacts,
      wins: row.wins,
      morningScore: row.morning_score,
      eveningScore: row.evening_score,
      avgDiff: row.avg_diff,
      avgDiffText: formatDiff(row.avg_diff),
      bestDiff: row.best_diff,
      bestDiffText: formatDiff(row.best_diff),
    });
  });

  return json({ ok: true, game: scope ? gameInfo(scope) : null, ranking });
}
