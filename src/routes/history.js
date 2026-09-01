import { json, requireUser, secondsToHHMMSS } from '../lib/util.js';
import { closeExpiredRounds, formatDiff, formatScore } from '../lib/game.js';

/** 지난 라운드 기록 (최근 30일). '게임 없음' 으로 끝난 날도 함께 보여 준다. */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  await closeExpiredRounds(db);

  const [roundsRes, resultsRes] = await Promise.all([
    db.prepare(
      `SELECT r.game_date, r.round_no, r.answer_seconds, r.status,
              u.display_name AS setter_name, u.avatar AS setter_avatar
         FROM rounds r LEFT JOIN users u ON u.id = r.setter_user_id
        WHERE r.status IN ('settled', 'void')
        ORDER BY r.game_date DESC LIMIT 30`,
    ).all(),
    db.prepare(
      `SELECT r.game_date, r.diff_seconds, r.score, r.is_winner, u.display_name, u.avatar
         FROM results r JOIN users u ON u.id = r.user_id
        WHERE r.game_date IN (
          SELECT game_date FROM rounds WHERE status = 'settled'
          ORDER BY game_date DESC LIMIT 30
        )
        ORDER BY r.diff_seconds ASC`,
    ).all(),
  ]);

  const byDate = new Map();
  for (const row of resultsRes.results ?? []) {
    if (!byDate.has(row.game_date)) byDate.set(row.game_date, []);
    byDate.get(row.game_date).push({
      displayName: row.display_name,
      avatar: row.avatar ?? '🙂',
      diff: row.diff_seconds,
      diffText: formatDiff(row.diff_seconds),
      score: row.score,
      scoreText: formatScore(row.score),
      isWinner: row.is_winner === 1,
    });
  }

  return json({
    ok: true,
    history: (roundsRes.results ?? []).map((r) => ({
      date: r.game_date,
      roundNo: r.round_no,
      status: r.status,
      setter: r.setter_name
        ? { displayName: r.setter_name, avatar: r.setter_avatar ?? '🙂' }
        : null,
      answer: r.status === 'settled' ? secondsToHHMMSS(r.answer_seconds) : null,
      entries: byDate.get(r.game_date) ?? [],
    })),
  });
}
