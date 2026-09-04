// 예굼퀴즈대회 — 힌트 열기.
//
// 힌트는 1단계부터 차례로 열리고, 연 사람에게만 보인다. 다른 참가자에게는
// "힌트를 몇 단계까지 썼다" 는 사실만 보이고 내용은 내려가지 않는다.
// 열 때마다 그 단계만큼 점수가 깎인다 (1단계 1점, 2단계 2점, 3단계 3점 — 누적).

import { fail, json, requireUser } from '../lib/util.js';
import { hintsOf, nextHintPenalty, openQuiz, scoreFor, settleExpiredQuiz } from '../lib/quiz.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 힌트를 쓸 수 없습니다.');

  // 시간이 다 된 뒤에 힌트를 열어 점수만 깎이는 일이 없도록 먼저 확인한다
  if (await settleExpiredQuiz(db)) return fail(409, '제한시간이 끝나 마감됐어요.');

  const quiz = await openQuiz(db);
  if (!quiz) return fail(409, '지금은 진행 중인 퀴즈가 없어요.');
  if (quiz.setter_user_id === user.id) return fail(403, '출제자는 힌트를 쓸 수 없어요.');

  const hints = hintsOf(quiz);
  if (!hints.length) return fail(409, '이 문제에는 힌트가 없어요.');

  const mine = await db
    .prepare(`SELECT hints_used, wrongs, solved_at FROM quiz_players
               WHERE quiz_id = ? AND user_id = ?`)
    .bind(quiz.id, user.id)
    .first();
  if (mine?.solved_at) return fail(409, '이미 정답을 맞혀서 힌트가 필요 없어요.');

  const used = mine?.hints_used ?? 0;
  if (used >= hints.length) return fail(409, '힌트를 모두 열었어요.');

  const penalty = nextHintPenalty(used);

  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO quiz_players (quiz_id, user_id) VALUES (?, ?)`)
      .bind(quiz.id, user.id),
    db
      .prepare(
        `UPDATE quiz_players SET hints_used = hints_used + 1, updated_at = datetime('now')
          WHERE quiz_id = ?1 AND user_id = ?2 AND solved_at IS NULL AND hints_used < ?3`,
      )
      .bind(quiz.id, user.id, hints.length),
  ]);

  const row = await db
    .prepare(`SELECT hints_used, wrongs FROM quiz_players WHERE quiz_id = ? AND user_id = ?`)
    .bind(quiz.id, user.id)
    .first();
  const nowUsed = row?.hints_used ?? used + 1;

  const solvedCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM quiz_players WHERE quiz_id = ? AND solved_at IS NOT NULL`)
    .bind(quiz.id)
    .first();

  return json({
    ok: true,
    stage: nowUsed,
    penalty,
    hint: hints[nowUsed - 1] ?? null,
    hints: hints.slice(0, nowUsed),
    hintsLeft: Math.max(0, hints.length - nowUsed),
    nextHintPenalty: nowUsed < hints.length ? nextHintPenalty(nowUsed) : null,
    potentialScore: scoreFor({
      first: (solvedCount?.n ?? 0) === 0,
      hintsUsed: nowUsed,
      wrongs: row?.wrongs ?? 0,
    }),
  });
}
