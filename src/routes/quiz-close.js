// 예굼퀴즈대회 — 출제자가 퀴즈를 끝낸다.
//
// 끝내는 순간 정답이 모두에게 공개되고 회차가 하나 올라간다.
// 그리고 출제 턴이 넘어간다.
//   정답자가 있으면  가장 먼저 맞힌 사람이 다음 출제자가 된다
//   정답자가 없으면  턴은 출제자에게 그대로 남는다 (다시 내거나 남에게 넘길 수 있다)

import { fail, json, requireUser } from '../lib/util.js';
import {
  closedCount, firstSolverId, openQuiz, personById, setQuizTurnStatements,
} from '../lib/quiz.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  const quiz = await openQuiz(db);
  if (!quiz) return fail(409, '지금은 진행 중인 퀴즈가 없어요.');
  if (quiz.setter_user_id !== user.id) {
    return fail(403, '문제를 낸 사람만 퀴즈를 끝낼 수 있어요.');
  }

  const [winnerId, closed] = await Promise.all([firstSolverId(db, quiz.id), closedCount(db)]);
  const nextTurnId = winnerId ?? quiz.setter_user_id;
  const roundNo = closed + 1;

  await db.batch([
    db
      .prepare(
        `UPDATE quiz_rounds
            SET status = 'closed', closed_at = datetime('now'), round_no = ?
          WHERE id = ? AND status = 'open'`,
      )
      .bind(roundNo, quiz.id),
    ...setQuizTurnStatements(db, nextTurnId),
  ]);

  const solved = await db
    .prepare(`SELECT COUNT(*) AS n FROM quiz_players WHERE quiz_id = ? AND solved_at IS NOT NULL`)
    .bind(quiz.id)
    .first();

  return json({
    ok: true,
    quizId: quiz.id,
    roundNo,
    answer: quiz.answer_text,
    solvedCount: solved?.n ?? 0,
    winner: await personById(db, winnerId),
    nextTurn: await personById(db, nextTurnId),
  });
}
