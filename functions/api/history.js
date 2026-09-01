import { json, minutesToHHMM, requireUser } from '../_lib/util.js';

/** 지난 라운드 기록 (최근 30일) */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  const [roundsRes, resultsRes] = await Promise.all([
    db.prepare(
      `SELECT game_date, answer_minutes FROM rounds
        WHERE revealed_at IS NOT NULL
        ORDER BY game_date DESC LIMIT 30`,
    ).all(),
    db.prepare(
      `SELECT r.game_date, r.diff, r.is_winner, u.display_name
         FROM results r JOIN users u ON u.id = r.user_id
        WHERE r.game_date IN (
          SELECT game_date FROM rounds WHERE revealed_at IS NOT NULL
          ORDER BY game_date DESC LIMIT 30
        )
        ORDER BY r.diff ASC`,
    ).all(),
  ]);

  const byDate = new Map();
  for (const row of resultsRes.results ?? []) {
    if (!byDate.has(row.game_date)) byDate.set(row.game_date, []);
    byDate.get(row.game_date).push({
      displayName: row.display_name,
      diff: row.diff,
      isWinner: row.is_winner === 1,
    });
  }

  return json({
    ok: true,
    history: (roundsRes.results ?? []).map((r) => ({
      date: r.game_date,
      answer: minutesToHHMM(r.answer_minutes),
      entries: byDate.get(r.game_date) ?? [],
    })),
  });
}
