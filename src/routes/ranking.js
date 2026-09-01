import { json, requireUser } from '../lib/util.js';
import { formatDiff } from '../lib/game.js';

/** 누적 랭킹 — 우승 횟수 우선, 동률이면 평균 오차가 작은 순 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const { results } = await context.env.DB.prepare(
    `SELECT u.id,
            u.username,
            u.display_name,
            COUNT(r.game_date)                                     AS played,
            COALESCE(SUM(r.is_winner), 0)                          AS wins,
            CAST(ROUND(AVG(r.diff)) AS INTEGER)                    AS avg_diff,
            MIN(r.diff)                                            AS best_diff
       FROM users u
       LEFT JOIN results r ON r.user_id = u.id
      WHERE u.role = 'player'
      GROUP BY u.id
      ORDER BY wins DESC, (avg_diff IS NULL), avg_diff ASC, u.id ASC`,
  ).all();

  let rank = 0;
  let prevKey = null;
  const ranking = (results ?? []).map((row, idx) => {
    const key = `${row.wins}|${row.avg_diff ?? 'x'}`;
    if (key !== prevKey) rank = idx + 1;   // 동률이면 같은 등수
    prevKey = key;
    return {
      rank,
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      played: row.played,
      wins: row.wins,
      winRate: row.played ? Math.round((row.wins / row.played) * 100) : 0,
      avgDiff: row.avg_diff,
      avgDiffText: row.avg_diff === null ? null : formatDiff(row.avg_diff),
      bestDiff: row.best_diff,
      bestDiffText: row.best_diff === null ? null : formatDiff(row.best_diff),
    };
  });

  return json({ ok: true, ranking });
}
