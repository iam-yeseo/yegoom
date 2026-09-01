import { json, requireUser, secondsToHHMMSS, todayKST } from '../lib/util.js';
import {
  CLOSE_LABEL, closeExpiredRounds, formatDiff, formatScore, isClosed, roundNumberFor,
} from '../lib/game.js';

/** 오늘 라운드의 전체 상태. 정답 공개 전에는 남의 예측이 내려가지 않는다. */
export async function onRequestGet(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const gameDate = url.searchParams.get('date') ?? todayKST();

  // 19시가 지났는데 정답이 안 들어온 날들을 먼저 '게임 없음' 으로 정리한다
  await closeExpiredRounds(db);

  const [round, playersRes, guessesRes, resultsRes, totalsRes] = await Promise.all([
    db.prepare(
      `SELECT round_no, answer_seconds, status, revealed_at FROM rounds WHERE game_date = ?`,
    ).bind(gameDate).first(),
    db.prepare(
      `SELECT id, username, display_name, avatar FROM users WHERE role = 'player' ORDER BY id`,
    ).all(),
    db.prepare(`SELECT user_id, guess_seconds, updated_at FROM guesses WHERE game_date = ?`)
      .bind(gameDate).all(),
    db.prepare(`SELECT user_id, diff_seconds, score, is_winner FROM results WHERE game_date = ?`)
      .bind(gameDate).all(),
    db.prepare(
      `SELECT user_id, COALESCE(SUM(score), 0) AS score, COALESCE(SUM(is_winner), 0) AS wins
         FROM results GROUP BY user_id`,
    ).all(),
  ]);

  const status = round?.status ?? (isClosed(gameDate) ? 'void' : 'open');
  const revealed = status === 'settled';
  const closed = revealed || status === 'void' || isClosed(gameDate);
  const roundNo = await roundNumberFor(db, round);

  const guessByUser = new Map((guessesRes.results ?? []).map((g) => [g.user_id, g]));
  const resultByUser = new Map((resultsRes.results ?? []).map((r) => [r.user_id, r]));
  const totalByUser = new Map((totalsRes.results ?? []).map((t) => [t.user_id, t]));

  const players = (playersRes.results ?? []).map((p) => {
    const guess = guessByUser.get(p.id);
    const result = resultByUser.get(p.id);
    const totals = totalByUser.get(p.id);
    const isMe = user?.id === p.id;
    return {
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatar: p.avatar ?? '🙂',
      submitted: !!guess,
      totalScore: totals?.score ?? 0,
      totalWins: totals?.wins ?? 0,
      // 공개 전에는 본인 예측만 볼 수 있다
      guess: revealed || isMe ? secondsToHHMMSS(guess?.guess_seconds ?? null) : null,
      diff: revealed && result ? result.diff_seconds : null,
      diffText: revealed && result ? formatDiff(result.diff_seconds) : null,
      score: revealed && result ? result.score : null,
      scoreText: revealed && result ? formatScore(result.score) : null,
      isWinner: revealed && result ? result.is_winner === 1 : false,
      isMe,
    };
  });

  return json({
    ok: true,
    date: gameDate,
    isToday: gameDate === todayKST(),
    roundNo,
    status,
    revealed,
    closed,
    closesAt: CLOSE_LABEL,
    answer: revealed ? secondsToHHMMSS(round.answer_seconds) : null,
    revealedAt: round?.revealed_at ?? null,
    myGuess: user ? secondsToHHMMSS(guessByUser.get(user.id)?.guess_seconds ?? null) : null,
    players,
    user,
  });
}
