// 예굼퀴즈대회 — 정답 제출.
//
// 가장 먼저 맞힌 사람이 10점, 그 뒤로 맞힌 사람은 8점을 받는다. 거기서
// 그때까지 연 힌트(1·2·3단계 누적)와 틀린 횟수(1회당 1점)만큼 깎인다.
// 0점 밑으로는 내려가지 않는다.
//
// 점수는 맞히는 그 순간에 확정돼 quiz_players 에 박힌다. 그래서 나중에
// 다른 사람이 힌트를 열거나 틀려도 이미 받은 점수는 흔들리지 않는다.
//
// 맞힌 순서는 SQL 안에서 세므로, 두 사람이 같은 순간에 답을 내도 1등은 한 명뿐이다.
//
// 진행 방식에 따라 이 답이 퀴즈를 끝낼 수도 있다.
//   first  맞히는 순간 퀴즈가 끝난다 (선착순 한 명)
//   timed  제한시간이 지났으면 답을 받지 않고 그 자리에서 마감한다
//   free   첫 정답이 나오면 그때부터 15분을 재기 시작한다 (그 뒤로는 시간이 끝낸다)

import { fail, json, readJson, requireUser } from '../lib/util.js';
import {
  FIRST_SCORE, FREE_GRACE_SECONDS, NEXT_SCORE, WRONG_PENALTY, answerFormOf, closeQuizRound,
  formatDuration, hintPenalty, isCorrectAnswer, modeOf, normalizeSubmission, openQuiz, personById,
  scoreFor, settleExpiredQuiz,
} from '../lib/quiz.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 정답을 낼 수 없습니다.');

  // 제한시간이 지났으면 답을 받기 전에 마감한다 — 늦은 답은 한 건도 들어오지 않는다
  const expired = await settleExpiredQuiz(db);
  if (expired) return fail(409, '제한시간이 끝나 마감됐어요.');

  const quiz = await openQuiz(db);
  if (!quiz) return fail(409, '지금은 진행 중인 퀴즈가 없어요.');
  if (quiz.setter_user_id === user.id) return fail(403, '출제자는 자기 문제를 맞힐 수 없어요.');

  const mode = modeOf(quiz);

  const body = await readJson(context.request);
  // 날짜 · 시간 · 금액은 출제자가 정해 둔 칸 모양에 맞춰 받는다
  const submitted = normalizeSubmission(body.answer, {
    type: quiz.answer_type,
    form: answerFormOf(quiz.answer_type, quiz.answer_text),
  });
  if (submitted.error) return fail(400, submitted.error);

  const mine = await db
    .prepare(`SELECT hints_used, wrongs, attempts, solved_at FROM quiz_players
               WHERE quiz_id = ? AND user_id = ?`)
    .bind(quiz.id, user.id)
    .first();
  if (mine?.solved_at) return fail(409, '이미 정답을 맞혔어요.');

  // 선착순 문제는 한 명이 맞히면 그것으로 끝이다. 자동 종료와 거의 동시에 들어온
  // 답까지 막으려면 여기서 한 번 더 확인해야 한다.
  if (mode.key === 'first') {
    const already = await db
      .prepare(`SELECT COUNT(*) AS n FROM quiz_players
                 WHERE quiz_id = ? AND solved_at IS NOT NULL`)
      .bind(quiz.id)
      .first();
    if (already?.n) return fail(409, '한발 늦었어요. 이미 정답자가 나왔어요.');
  }

  const hintsUsed = mine?.hints_used ?? 0;
  const wrongs = mine?.wrongs ?? 0;
  const correct = isCorrectAnswer(quiz.answer_type, quiz.answer_text, submitted.value);

  // 맞혔을 때 깎일 점수 — 힌트 감점 + 지금까지의 오답 감점
  const penalty = hintPenalty(hintsUsed) + wrongs * WRONG_PENALTY;

  const statements = [
    db
      .prepare(`INSERT OR IGNORE INTO quiz_players (quiz_id, user_id) VALUES (?, ?)`)
      .bind(quiz.id, user.id),
    db
      .prepare(
        `INSERT INTO quiz_attempts (quiz_id, user_id, answer, is_correct) VALUES (?, ?, ?, ?)`,
      )
      .bind(quiz.id, user.id, submitted.value, correct ? 1 : 0),
  ];

  if (correct) {
    // 맞힌 순서와 점수를 한 문장 안에서 정한다. 자기 자신은 세지 않으므로
    // 같은 순간에 두 명이 들어와도 두 사람이 나란히 1등이 되지는 않는다.
    statements.push(
      db
        .prepare(
          `UPDATE quiz_players
              SET attempts    = attempts + 1,
                  solved_at   = datetime('now'),
                  solved_rank = 1 + (SELECT COUNT(*) FROM quiz_players p
                                      WHERE p.quiz_id = ?1 AND p.user_id <> ?2
                                        AND p.solved_at IS NOT NULL),
                  score       = MAX(0,
                                    CASE WHEN (SELECT COUNT(*) FROM quiz_players p
                                                WHERE p.quiz_id = ?1 AND p.user_id <> ?2
                                                  AND p.solved_at IS NOT NULL) = 0
                                         THEN ${FIRST_SCORE} ELSE ${NEXT_SCORE} END - ?3),
                  updated_at  = datetime('now')
            WHERE quiz_id = ?1 AND user_id = ?2 AND solved_at IS NULL`,
        )
        .bind(quiz.id, user.id, penalty),
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE quiz_players
              SET attempts = attempts + 1, wrongs = wrongs + 1, updated_at = datetime('now')
            WHERE quiz_id = ?1 AND user_id = ?2 AND solved_at IS NULL`,
        )
        .bind(quiz.id, user.id),
    );
  }

  await db.batch(statements);

  const row = await db
    .prepare(`SELECT hints_used, wrongs, attempts, solved_rank, score FROM quiz_players
               WHERE quiz_id = ? AND user_id = ?`)
    .bind(quiz.id, user.id)
    .first();

  if (correct) {
    // 선착순 문제는 이 답으로 끝난다 — 정답이 공개되고 출제 턴이 나에게 넘어온다
    const finished = mode.key === 'first' ? await closeQuizRound(db, quiz, { reason: 'first' }) : null;

    // 자유 모드는 첫 정답이 나온 순간부터 15분을 잰다. 마감 시각을 서버 시계로 한 번만
    // 박아 두면(아직 비어 있을 때만) 그 뒤에는 제한시간 문제와 똑같이 흘러간다.
    if (mode.key === 'free' && row?.solved_rank === 1) {
      await db
        .prepare(
          `UPDATE quiz_rounds
              SET deadline_at = datetime('now', '+' || ? || ' seconds')
            WHERE id = ? AND status = 'open' AND deadline_at IS NULL`,
        )
        .bind(FREE_GRACE_SECONDS, quiz.id)
        .run();
    }

    return json({
      ok: true,
      correct: true,
      answer: submitted.value,
      rank: row?.solved_rank ?? null,
      first: row?.solved_rank === 1,
      score: row?.score ?? 0,
      hintsUsed: row?.hints_used ?? 0,
      wrongs: row?.wrongs ?? 0,
      mode: mode.key,
      closed: !!finished,
      closedReason: finished?.reason ?? null,
      roundNo: finished?.roundNo ?? null,
      nextTurn: finished ? await personById(db, finished.nextTurnId) : null,
    });
  }

  // 다음에 맞히면 몇 점인지 미리 알려 준다 (오답 감점이 방금 하나 더 붙었다)
  const solvedCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM quiz_players WHERE quiz_id = ? AND solved_at IS NOT NULL`)
    .bind(quiz.id)
    .first();

  return json({
    ok: true,
    correct: false,
    answer: submitted.value,
    wrongs: row?.wrongs ?? 0,
    attempts: row?.attempts ?? 0,
    mode: mode.key,
    closed: false,
    // 제한시간 문제에서는 얼마나 남았는지도 함께 알려 준다
    secondsLeft: quiz.seconds_left === null || quiz.seconds_left === undefined
      ? null
      : Math.max(0, quiz.seconds_left),
    timeLeftLabel: quiz.seconds_left > 0 ? formatDuration(quiz.seconds_left) : null,
    potentialScore: scoreFor({
      first: (solvedCount?.n ?? 0) === 0,
      hintsUsed: row?.hints_used ?? 0,
      wrongs: row?.wrongs ?? 0,
    }),
  });
}
