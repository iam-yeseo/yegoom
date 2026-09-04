// 예굼퀴즈대회 — 출제자가 퀴즈를 끝낸다.
//
// 끝내는 순간 정답이 모두에게 공개되고 회차가 하나 올라간다.
// 그리고 출제 턴이 넘어간다.
//   정답자가 있으면  가장 먼저 맞힌 사람이 다음 출제자가 된다
//   정답자가 없으면  턴은 출제자에게 그대로 남는다 (다시 내거나 남에게 넘길 수 있다)
//
// 선착순·제한시간 문제는 서버가 알아서 끝내지만, 출제자가 그전에 직접 끝내는 것도
// 언제든 된다. 뒷정리는 어느 쪽이든 closeQuizRound() 하나가 맡는다.

import { fail, json, requireUser } from '../lib/util.js';
import { closeQuizRound, openQuiz, personById, settleExpiredQuiz } from '../lib/quiz.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  // 제한시간이 지나 이미 끝난 퀴즈라면 그 결과를 그대로 돌려준다 —
  // 버튼을 누른 출제자에게 "없는 퀴즈" 라고 하는 것보다 낫다
  const expired = await settleExpiredQuiz(db);
  if (expired) {
    return json({
      ok: true,
      quizId: expired.quizId,
      roundNo: expired.roundNo,
      reason: expired.reason,
      answer: expired.answer,
      solvedCount: expired.solvedCount,
      winner: await personById(db, expired.winnerId),
      nextTurn: await personById(db, expired.nextTurnId),
    });
  }

  const quiz = await openQuiz(db);
  if (!quiz) return fail(409, '지금은 진행 중인 퀴즈가 없어요.');
  if (quiz.setter_user_id !== user.id) {
    return fail(403, '문제를 낸 사람만 퀴즈를 끝낼 수 있어요.');
  }

  const closed = await closeQuizRound(db, quiz, { reason: 'setter' });

  return json({
    ok: true,
    quizId: closed.quizId,
    roundNo: closed.roundNo,
    reason: closed.reason,
    answer: closed.answer,
    solvedCount: closed.solvedCount,
    winner: await personById(db, closed.winnerId),
    nextTurn: await personById(db, closed.nextTurnId),
  });
}
