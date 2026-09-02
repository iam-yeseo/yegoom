import { json, photoUrl, requireUser, secondsToHHMMSS } from '../lib/util.js';
import { closeExpiredRounds, formatDiff, formatScore } from '../lib/game.js';
import { gameInfo, gameKeyOf } from '../lib/games.js';

/**
 * 지난 라운드 기록 (최근 30회). '게임 없음' 으로 끝난 날도 함께 보여 준다.
 * ?game=morning|evening 이면 그 게임만, 없으면 두 게임을 섞어 최신순으로 준다.
 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;
  await closeExpiredRounds(db);

  const scope = gameKeyOf(new URL(context.request.url).searchParams.get('game'));

  const { results: rounds } = await db.prepare(
    `SELECT r.game, r.game_date, r.round_no, r.answer_seconds, r.status,
            u.id AS setter_id, u.display_name AS setter_name,
            u.avatar AS setter_avatar, u.photo_version AS setter_photo_version
       FROM rounds r LEFT JOIN users u ON u.id = r.setter_user_id
      WHERE r.status IN ('settled', 'void') AND (?1 IS NULL OR r.game = ?1)
      ORDER BY r.game_date DESC, r.game ASC LIMIT 30`,
  ).bind(scope).all();

  const keys = (rounds ?? []).map((r) => `${r.game}|${r.game_date}`);
  const { results: entries } = keys.length
    ? await db.prepare(
        `SELECT r.game, r.game_date, r.diff_seconds, r.score, r.is_winner,
                u.id, u.display_name, u.avatar, u.photo_version
           FROM results r JOIN users u ON u.id = r.user_id
          WHERE (r.game || '|' || r.game_date) IN (${keys.map(() => '?').join(', ')})
          ORDER BY r.diff_seconds ASC`,
      ).bind(...keys).all()
    : { results: [] };

  const byRound = new Map();
  for (const row of entries ?? []) {
    const key = `${row.game}|${row.game_date}`;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push({
      id: row.id,
      displayName: row.display_name,
      avatar: row.avatar ?? '🙂',
      photoUrl: photoUrl(row.id, row.photo_version),
      diff: row.diff_seconds,
      diffText: formatDiff(row.diff_seconds),
      score: row.score,
      scoreText: formatScore(row.score),
      isWinner: row.is_winner === 1,
    });
  }

  return json({
    ok: true,
    history: (rounds ?? []).map((r) => ({
      game: gameInfo(r.game),
      date: r.game_date,
      roundNo: r.round_no,
      status: r.status,
      setter: r.setter_name
        ? {
            id: r.setter_id,
            displayName: r.setter_name,
            avatar: r.setter_avatar ?? '🙂',
            photoUrl: photoUrl(r.setter_id, r.setter_photo_version),
          }
        : null,
      answer: r.status === 'settled' ? secondsToHHMMSS(r.answer_seconds) : null,
      entries: byRound.get(`${r.game}|${r.game_date}`) ?? [],
    })),
  });
}
