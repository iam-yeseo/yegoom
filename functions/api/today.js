import { json, minutesToHHMM, requireUser, todayKST } from '../_lib/util.js';
import { formatDiff } from '../_lib/game.js';

/** 오늘 라운드의 전체 상태. 정답 공개 전에는 남의 예측이 내려가지 않는다. */
export async function onRequestGet(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const gameDate = url.searchParams.get('date') ?? todayKST();

  const [round, playersRes, guessesRes, resultsRes, winsRes] = await Promise.all([
    db.prepare(`SELECT answer_minutes, revealed_at FROM rounds WHERE game_date = ?`)
      .bind(gameDate).first(),
    db.prepare(
      `SELECT id, username, display_name FROM users WHERE role = 'player' ORDER BY id`,
    ).all(),
    db.prepare(`SELECT user_id, guess_minutes, updated_at FROM guesses WHERE game_date = ?`)
      .bind(gameDate).all(),
    db.prepare(`SELECT user_id, diff, is_winner FROM results WHERE game_date = ?`)
      .bind(gameDate).all(),
    db.prepare(`SELECT user_id, COUNT(*) AS wins FROM results WHERE is_winner = 1 GROUP BY user_id`)
      .all(),
  ]);

  const revealed = !!round?.revealed_at;
  const guessByUser = new Map((guessesRes.results ?? []).map((g) => [g.user_id, g]));
  const resultByUser = new Map((resultsRes.results ?? []).map((r) => [r.user_id, r]));
  const winsByUser = new Map((winsRes.results ?? []).map((w) => [w.user_id, w.wins]));

  const players = (playersRes.results ?? []).map((p) => {
    const guess = guessByUser.get(p.id);
    const result = resultByUser.get(p.id);
    const isMe = user?.id === p.id;
    return {
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      submitted: !!guess,
      totalWins: winsByUser.get(p.id) ?? 0,
      // 공개 전에는 본인 예측만 볼 수 있다
      guess: revealed || isMe ? minutesToHHMM(guess?.guess_minutes ?? null) : null,
      diff: revealed && result ? result.diff : null,
      diffText: revealed && result ? formatDiff(result.diff) : null,
      isWinner: revealed && result ? result.is_winner === 1 : false,
      isMe,
    };
  });

  return json({
    ok: true,
    date: gameDate,
    isToday: gameDate === todayKST(),
    revealed,
    answer: revealed ? minutesToHHMM(round.answer_minutes) : null,
    revealedAt: round?.revealed_at ?? null,
    myGuess: user ? (minutesToHHMM(guessByUser.get(user.id)?.guess_minutes ?? null)) : null,
    players,
    user,
  });
}
