import { json, personOf, requireUser, secondsToHHMMSS, todayKST } from '../lib/util.js';
import {
  answerWindowOver, canBurnChance, canRecordAnswer, canReveal, chanceLog, chanceStateOf,
  closeExpiredRounds, formatDiff, formatScore, isClosed, roundNumberFor,
} from '../lib/game.js';
import { MIN_PLAYERS_TO_REVEAL, gameInfo, gameOf } from '../lib/games.js';
import { chancesFor } from '../lib/config.js';
import { getSetter } from '../lib/setter.js';

/**
 * 한 게임의 오늘 상태. 정답 공개 전에는 남의 예측이 내려가지 않는다.
 *
 * 출제자가 정답을 기록해 두었는지는 출제자 본인에게만(mine) 내려간다.
 * 다른 사람에게는 status 가 계속 'open' 이라 기록 여부를 알 수 없다.
 *
 * '기회' 는 반대로 모두에게 보인다. 기회를 쓰면 가장 가까운 사람에게 하이라이트가
 * 들어가는 게 곧 그 기능이기 때문이다. 다만 오차 값은 누구에게도 내려가지 않는다.
 */
export async function onRequestGet(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const game = gameOf(url.searchParams.get('game'));
  const gameDate = url.searchParams.get('date') ?? todayKST();

  // 정답 없이 끝난 날들을 먼저 '게임 없음' 으로 정리한다
  await closeExpiredRounds(db);

  const [
    round, playersRes, guessesRes, resultsRes, totalsRes, currentSetter, chanceRows, configured,
  ] = await Promise.all([
    db.prepare(
      `SELECT round_no, setter_user_id, answer_seconds, answered_at, status, revealed_at,
              chances_total, chances_used
         FROM rounds WHERE game = ? AND game_date = ?`,
    ).bind(game.key, gameDate).first(),
    db.prepare(
      `SELECT id, username, display_name, avatar, photo_version FROM users
        WHERE role = 'player' ORDER BY id`,
    ).all(),
    db.prepare(
      `SELECT user_id, guess_seconds, updated_at FROM guesses WHERE game = ? AND game_date = ?`,
    ).bind(game.key, gameDate).all(),
    db.prepare(
      `SELECT user_id, diff_seconds, score, is_winner FROM results WHERE game = ? AND game_date = ?`,
    ).bind(game.key, gameDate).all(),
    db.prepare(
      `SELECT user_id, COALESCE(SUM(score), 0) AS score, COALESCE(SUM(is_winner), 0) AS wins
         FROM results WHERE game = ? GROUP BY user_id`,
    ).bind(game.key).all(),
    getSetter(db, game.key),
    chanceLog(db, game.key, gameDate),
    chancesFor(db, game.key),
  ]);

  const status = round?.status ?? (isClosed(game.key, gameDate) ? 'void' : 'open');
  const revealed = status === 'settled';
  const closed = revealed || status === 'void' || isClosed(game.key, gameDate);
  const roundNo = await roundNumberFor(db, game.key, round);

  // 끝난 회차는 그날 기록해 둔 출제자를 쓴다. 진행 중일 때는 언제나 지금 지정된
  // 출제자를 쓴다 — 라운드에 적힌 출제자를 보여 주면 정답이 기록됐다는 게 새 나간다.
  const recordedSetter = revealed && round?.setter_user_id
    ? await db
        .prepare(`SELECT id, username, display_name, avatar, photo_version FROM users WHERE id = ?`)
        .bind(round.setter_user_id)
        .first()
    : null;
  const setter = personOf(recordedSetter) ?? currentSetter;

  const playerById = new Map((playersRes.results ?? []).map((p) => [p.id, p]));
  const guessByUser = new Map((guessesRes.results ?? []).map((g) => [g.user_id, g]));
  const resultByUser = new Map((resultsRes.results ?? []).map((r) => [r.user_id, r]));
  const totalByUser = new Map((totalsRes.results ?? []).map((t) => [t.user_id, t]));

  // 출제자는 자기 시간을 아는 사람이라 참가자 목록에서 뺀다 (다른 게임에는 참가한다)
  const players = (playersRes.results ?? [])
    .filter((p) => p.id !== setter?.id)
    .map((p) => {
      const guess = guessByUser.get(p.id);
      const result = resultByUser.get(p.id);
      const totals = totalByUser.get(p.id);
      const isMe = user?.id === p.id;
      return personOf(p, {
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
      });
    });

  const submitted = players.filter((p) => p.submitted).length;
  const isSetter = !!setter && setter.id === user.id;
  const answerRecorded = round?.answer_seconds !== null && round?.answer_seconds !== undefined;

  // 기회 — 마지막으로 쓴 기회에서 뽑힌 사람이 지금의 하이라이트다
  const chances = chanceStateOf(round, configured);
  const lastChance = chanceRows.at(-1) ?? null;
  const highlightId = revealed ? null : lastChance?.user_id ?? null;
  for (const p of players) p.isClosest = p.id === highlightId;

  return json({
    ok: true,
    game: gameInfo(game),
    date: gameDate,
    isToday: gameDate === todayKST(),
    roundNo,
    setter,
    isSetter,
    status,
    revealed,
    closed,
    closesAt: game.closeLabel,
    submitted,
    answer: revealed ? secondsToHHMMSS(round.answer_seconds) : null,
    revealedAt: round?.revealed_at ?? null,
    myGuess: secondsToHHMMSS(guessByUser.get(user.id)?.guess_seconds ?? null),
    players,
    user,
    // 기회 — 오차는 담지 않는다 (자기 예측을 아는 사람에게 정답이 드러난다)
    chances: {
      ...chances,
      log: chanceRows.map((c) => ({
        seq: c.seq,
        closest: personOf(playerById.get(c.user_id)),
        guesses: c.guesses,
      })),
    },
    // 출제자 본인에게만 내려가는 비공개 상태
    mine: isSetter
      ? {
          answerRecorded,
          answer: secondsToHHMMSS(round?.answer_seconds ?? null),
          answeredAt: round?.answered_at ?? null,
          // 기회를 이미 썼다면 그 힌트가 이 정답을 기준으로 나갔으므로 더는 못 바꾼다
          canRecord:
            status === 'open' && !chances.used && canRecordAnswer(game.key, gameDate),
          // 기록 시간대가 이미 지났는지 — 오전은 10시 정각부터 기록도 수정도 못 한다
          recordClosed: answerWindowOver(game.key, gameDate),
          canBurnChance: canBurnChance({
            answerRecorded, guesses: submitted, status, remaining: chances.remaining,
          }),
          canReveal: canReveal({
            answerRecorded, guesses: submitted, status, remaining: chances.remaining, closed,
          }),
          needMore: Math.max(0, MIN_PLAYERS_TO_REVEAL - submitted),
        }
      : null,
  });
}
