import { json, requireUser } from '../lib/util.js';
import { closeExpiredRounds, formatDiff } from '../lib/game.js';

/**
 * 누적 랭킹 — 점수 합계 순, 동점이면 정확히 맞힌 횟수 -> 평균 오차 순.
 * 운영자와 출제자는 게임에 참여하지 않으므로 빠진다.
 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  await closeExpiredRounds(db);

  const { results } = await db.prepare(
    `SELECT u.id,
            u.username,
            u.display_name,
            u.avatar,
            COUNT(r.game_date)                                          AS played,
            COALESCE(SUM(r.score), 0)                                   AS score,
            COALESCE(SUM(CASE WHEN r.score = 3 THEN 1 ELSE 0 END), 0)   AS exacts,
            COALESCE(SUM(r.is_winner), 0)                               AS wins,
            CAST(ROUND(AVG(r.diff_seconds)) AS INTEGER)                 AS avg_diff,
            MIN(r.diff_seconds)                                         AS best_diff
       FROM users u
       LEFT JOIN results r ON r.user_id = u.id
      WHERE u.role = 'player' AND u.is_setter = 0
      GROUP BY u.id
      ORDER BY score DESC, exacts DESC, (avg_diff IS NULL), avg_diff ASC, u.id ASC`,
  ).all();

  let rank = 0;
  let prevKey = null;
  const ranking = (results ?? []).map((row, idx) => {
    const key = `${row.score}|${row.exacts}|${row.avg_diff ?? 'x'}`;
    if (key !== prevKey) rank = idx + 1;   // 동률이면 같은 등수
    prevKey = key;
    return {
      rank,
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar ?? '🙂',
      played: row.played,
      score: row.score,
      exacts: row.exacts,
      wins: row.wins,
      avgDiff: row.avg_diff,
      avgDiffText: formatDiff(row.avg_diff),
      bestDiff: row.best_diff,
      bestDiffText: formatDiff(row.best_diff),
    };
  });

  return json({ ok: true, ranking });
}
