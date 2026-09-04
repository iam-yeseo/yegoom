// 예굼퀴즈대회 — 출제 턴 넘기기.
//
// 정답자가 없어서 턴이 그대로 남았을 때, 출제자가 다시 문제를 내는 대신
// 다른 플레이어에게 차례를 넘길 수 있다. 진행 중인 퀴즈가 있으면 넘기지 못한다
// (먼저 그 퀴즈를 끝내야 한다).

import { fail, json, readJson, requireUser } from '../lib/util.js';
import {
  getQuizTurn, openQuiz, personById, setQuizTurnStatements, settleExpiredQuiz,
} from '../lib/quiz.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  // 제한시간이 끝난 퀴즈가 남아 있으면 먼저 마감된다 (그래야 턴을 넘길 수 있다)
  await settleExpiredQuiz(db);

  const turn = await getQuizTurn(db);
  if (turn?.id !== user.id) return fail(403, '출제 차례인 사람만 턴을 넘길 수 있어요.');
  if (await openQuiz(db)) return fail(409, '진행 중인 퀴즈를 먼저 끝내 주세요.');

  const body = await readJson(context.request);
  const userId = Number(body.userId ?? body.id);
  if (!Number.isInteger(userId)) return fail(400, '턴을 넘길 사람을 골라 주세요.');
  if (userId === user.id) return fail(400, '이미 내 차례예요.');

  const target = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first();
  if (!target) return fail(404, '없는 계정입니다.');
  if (target.role !== 'player') return fail(400, '운영자에게는 턴을 넘길 수 없어요.');

  await db.batch(setQuizTurnStatements(db, userId));

  return json({ ok: true, turn: await personById(db, userId) });
}
