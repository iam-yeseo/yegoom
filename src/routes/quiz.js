// 예굼퀴즈대회 — 지금 상태를 내려 주고(GET), 새 문제를 받는다(POST).
//
// 날짜 구분이 없는 게임이라 "오늘" 대신 "지금 열려 있는 퀴즈" 하나가 전부다.
// 열린 퀴즈가 없으면 마지막으로 끝난 퀴즈를 그대로 보여 준다 — 다음 문제를
// 기다리는 동안에도 직전 결과가 화면에 남아 있게 하기 위해서다.
//
// 정답과 힌트는 진행 중에 아무에게나 내려가지 않는다.
//   정답  출제자 본인에게만 (끝나면 모두에게)
//   힌트  자기가 연 단계까지만 (끝나면 모두에게)
//
// 제한시간이 걸린 퀴즈는 여기서 먼저 마감을 확인한다. 화면이 15초마다 이 경로를
// 물어보므로, 시간이 지나면 곧 끝난 상태로 바뀌어 내려간다.

import { fail, json, personOf, readJson, requireUser } from '../lib/util.js';
import {
  ANSWER_TYPES, DEFAULT_MODE, DEFAULT_TIME_LIMIT, MAX_HINTS, answerFormOf, answerTypeOf,
  closedCount, formatDuration, getQuizTurn, hintsOf, latestQuiz, modeOf, nextHintPenalty,
  normalizeAnswerText, normalizeHint, normalizeQuestion, normalizeTimeLimit, openQuiz, personById,
  quizInfo, quizModeOf, quizPhotoUrl, quizPlayerRows, roundNumberFor, scoreFor, settleExpiredQuiz,
} from '../lib/quiz.js';
import { normalizeQuizPhoto } from '../lib/image.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  // 시간이 다 된 퀴즈가 있으면 먼저 끝내 놓고, 그 결과를 읽어 내려 준다
  await settleExpiredQuiz(db);

  const [quiz, turn, playersRes, totalsRes] = await Promise.all([
    latestQuiz(db),
    getQuizTurn(db),
    db.prepare(
      `SELECT id, username, display_name, avatar, photo_version FROM users
        WHERE role = 'player' ORDER BY id`,
    ).all(),
    db.prepare(
      `SELECT user_id,
              COALESCE(SUM(score), 0)                                  AS score,
              COALESCE(SUM(CASE WHEN solved_rank = 1 THEN 1 ELSE 0 END), 0) AS firsts
         FROM quiz_players WHERE solved_at IS NOT NULL GROUP BY user_id`,
    ).all(),
  ]);

  const totalByUser = new Map((totalsRes.results ?? []).map((t) => [t.user_id, t]));
  const info = quizInfo();

  // 아직 아무도 문제를 낸 적이 없는 상태
  if (!quiz) {
    return json({
      ok: true,
      game: info,
      roundNo: 1,
      nextRoundNo: 1,
      turn,
      isTurnHolder: turn?.id === user.id,
      canSet: turn?.id === user.id && user.role === 'player',
      quiz: null,
      me: null,
      players: (playersRes.results ?? []).map((p) =>
        personOf(p, {
          isMe: p.id === user.id,
          totalScore: totalByUser.get(p.id)?.score ?? 0,
          totalFirsts: totalByUser.get(p.id)?.firsts ?? 0,
        }),
      ),
      user,
    });
  }

  const [setter, rows, roundNo, closedTotal] = await Promise.all([
    personById(db, quiz.setter_user_id),
    quizPlayerRows(db, quiz.id),
    roundNumberFor(db, quiz),
    closedCount(db),
  ]);

  const isOpen = quiz.status === 'open';
  const isSetter = setter?.id === user.id;
  const hints = hintsOf(quiz);
  const rowByUser = new Map(rows.map((r) => [r.user_id, r]));
  const mine = rowByUser.get(user.id) ?? null;
  const solvedCount = rows.filter((r) => r.solved_at).length;

  // 출제자는 참가자가 아니다 (자기 문제의 답을 아는 사람이다)
  const players = (playersRes.results ?? [])
    .filter((p) => p.id !== setter?.id)
    .map((p) => {
      const row = rowByUser.get(p.id);
      const totals = totalByUser.get(p.id);
      return personOf(p, {
        isMe: p.id === user.id,
        solved: !!row?.solved_at,
        rank: row?.solved_rank ?? null,
        score: row?.solved_at ? row.score : null,
        hintsUsed: row?.hints_used ?? 0,
        wrongs: row?.wrongs ?? 0,
        attempts: row?.attempts ?? 0,
        totalScore: totals?.score ?? 0,
        totalFirsts: totals?.firsts ?? 0,
      });
    });

  // 내가 낸 답들 — 나에게만 보여 준다 (남의 오답은 아무에게도 내려가지 않는다)
  const { results: myAttempts } = mine
    ? await db
        .prepare(
          `SELECT answer, is_correct, created_at FROM quiz_attempts
            WHERE quiz_id = ? AND user_id = ? ORDER BY id ASC`,
        )
        .bind(quiz.id, user.id)
        .all()
    : { results: [] };

  const hintsUsed = mine?.hints_used ?? 0;
  const solved = !!mine?.solved_at;
  const isPlayer = user.role === 'player';

  // 진행 방식 — 제한시간이 걸린 퀴즈면 남은 시간(초)도 함께 내려 준다.
  // 남은 시간은 서버 시계로 잰 값이라, 브라우저 시계가 틀어져 있어도 그대로 쓸 수 있다.
  const mode = modeOf(quiz);
  const secondsLeft = quiz.seconds_left === null || quiz.seconds_left === undefined
    ? null
    : Math.max(0, quiz.seconds_left);

  return json({
    ok: true,
    game: info,
    // roundNo 는 지금 보여 주는 퀴즈의 회차, nextRoundNo 는 다음에 낼 퀴즈의 회차다.
    // 진행 중인 퀴즈가 없을 때는 화면이 nextRoundNo 를 쓴다.
    roundNo,
    nextRoundNo: closedTotal + 1,
    turn,
    isTurnHolder: turn?.id === user.id,
    canSet: turn?.id === user.id && isPlayer && !isOpen,
    quiz: {
      id: quiz.id,
      roundNo,
      status: quiz.status,
      closed: !isOpen,
      setter,
      answerType: quiz.answer_type,
      answerTypeLabel: ANSWER_TYPES[quiz.answer_type]?.label ?? quiz.answer_type,
      answerTypeNote: ANSWER_TYPES[quiz.answer_type]?.note ?? '',
      // 날짜 · 시간 · 금액은 '어떤 칸이 있는지' 만 알려 준다. 값은 여기 담기지 않으므로
      // 진행 중에도 안전하게 내려갈 수 있고, 플레이어는 같은 자리에 답을 채워 넣는다.
      answerForm: answerFormOf(quiz.answer_type, quiz.answer_text),
      mode: mode.key,
      modeLabel: mode.label,
      modeIcon: mode.icon,
      modeNote: mode.playerNote,
      timeLimit: quiz.time_limit_sec ?? null,
      timeLimitLabel: quiz.time_limit_sec ? formatDuration(quiz.time_limit_sec) : null,
      secondsLeft: isOpen ? secondsLeft : null,
      closedReason: !isOpen ? (quiz.closed_reason ?? 'setter') : null,
      question: quiz.question,
      photoUrl: quizPhotoUrl(quiz),
      hintCount: hints.length,
      solvedCount,
      createdAt: quiz.created_at,
      closedAt: quiz.closed_at,
      // 정답은 끝난 뒤에, 또는 출제자 본인에게만
      answer: !isOpen || isSetter ? quiz.answer_text : null,
      // 힌트도 마찬가지 — 진행 중에는 각자 연 만큼만 따로 내려간다 (me.hints)
      hints: !isOpen || isSetter ? hints : null,
    },
    me: {
      isSetter,
      isPlayer,
      solved,
      rank: mine?.solved_rank ?? null,
      score: solved ? mine.score : null,
      hintsUsed,
      wrongs: mine?.wrongs ?? 0,
      attempts: mine?.attempts ?? 0,
      // 내가 연 힌트만 (1단계부터 차례로 열린다)
      hints: hints.slice(0, hintsUsed),
      hintsLeft: Math.max(0, hints.length - hintsUsed),
      nextHintPenalty: hintsUsed < hints.length ? nextHintPenalty(hintsUsed) : null,
      // 지금 맞히면 받을 점수 — 첫 정답이면 10점, 아니면 8점에서 감점을 뺀다
      potentialScore: scoreFor({
        first: solvedCount === 0,
        hintsUsed,
        wrongs: mine?.wrongs ?? 0,
      }),
      wouldBeFirst: solvedCount === 0,
      canAnswer: isOpen && isPlayer && !isSetter && !solved,
      canHint: isOpen && isPlayer && !isSetter && !solved && hintsUsed < hints.length,
      canClose: isOpen && isSetter,
      attemptLog: (myAttempts ?? []).map((a) => ({
        answer: a.answer,
        correct: a.is_correct === 1,
        at: a.created_at,
      })),
    },
    players,
    user,
  });
}

/**
 * 새 문제 출제 — 출제 턴을 가진 사람만, 그리고 열려 있는 퀴즈가 없을 때만.
 *
 * 사진은 한 장까지 붙일 수 있고, 힌트는 3단계까지 비워 둘 수 있다.
 * 2단계만 적고 1단계를 비우면 순서가 어긋나므로 앞에서부터 채우도록 정리한다.
 */
export async function onRequestPost(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403, '운영자는 문제를 낼 수 없습니다.');

  // 앞 퀴즈의 제한시간이 지났다면 여기서 먼저 마감된다 — 그래야 바로 다음 문제를 낼 수 있다
  await settleExpiredQuiz(db);

  const turn = await getQuizTurn(db);
  if (turn?.id !== user.id) return fail(403, '지금은 출제 차례가 아니에요.');
  if (await openQuiz(db)) return fail(409, '아직 진행 중인 퀴즈가 있어요.');

  const body = await readJson(context.request);

  const answerType = answerTypeOf(body.answerType ?? body.type);
  if (!answerType) return fail(400, '정답 종류를 골라 주세요.');

  const question = normalizeQuestion(body.question);
  if (question.error) return fail(400, question.error);

  // 양식으로 받는 종류는 칸 값이 통째로 오고, 표기 옵션(시간 단위 · 금액 단위)이 함께 온다
  const answer = normalizeAnswerText(answerType.key, body.answer, {
    unit: body.hourUnit,
    currency: body.currency,
  });
  if (answer.error) return fail(400, answer.error);

  // 진행 방식 — 아무것도 보내지 않은 예전 화면은 지금까지처럼 자유 모드가 된다
  const mode = quizModeOf(body.mode ?? DEFAULT_MODE);
  if (!mode) return fail(400, '진행 방식을 골라 주세요.');

  // 제한시간은 'timed' 일 때만 쓴다. 다른 방식이면 마감 시각도 두지 않는다.
  let timeLimit = null;
  if (mode.timed) {
    const picked = normalizeTimeLimit(body.timeLimit ?? DEFAULT_TIME_LIMIT);
    if (picked.error) return fail(400, picked.error);
    timeLimit = picked.value;
  }

  // 비워 둔 단계는 빼고 앞에서부터 채운다 — 힌트는 1단계부터 차례로 열리기 때문이다
  const hints = [];
  for (const raw of (Array.isArray(body.hints) ? body.hints : []).slice(0, MAX_HINTS)) {
    const hint = normalizeHint(raw);
    if (hint.error) return fail(400, hint.error);
    if (hint.value) hints.push(hint.value);
  }

  const photo = body.photo ? normalizeQuizPhoto(body.photo) : null;
  if (photo?.error) return fail(400, photo.error);

  // 제한시간의 시작은 '문제를 낸 순간' 이다. 마감 시각을 서버 시계로 박아 두면
  // 그 뒤로는 누구의 시계도 끼어들 수 없다.
  const created = await db
    .prepare(
      `INSERT INTO quiz_rounds
         (setter_user_id, answer_type, mode, time_limit_sec, deadline_at,
          question, answer_text, hint1, hint2, hint3, status)
       VALUES (?, ?, ?, ?,
               CASE WHEN ? IS NULL THEN NULL
                    ELSE datetime('now', '+' || ? || ' seconds') END,
               ?, ?, ?, ?, ?, 'open')`,
    )
    .bind(
      user.id,
      answerType.key,
      mode.key,
      timeLimit,
      // 마감 시각은 CASE 안에서 두 번 읽히므로 같은 값을 두 번 더 넘긴다
      timeLimit,
      timeLimit,
      question.value,
      answer.value,
      hints[0] ?? null,
      hints[1] ?? null,
      hints[2] ?? null,
    )
    .run();

  const quizId = created.meta?.last_row_id;
  if (!quizId) return fail(500, '문제를 저장하지 못했어요. 다시 시도해 주세요.');

  // 사진은 따로 넣고 나서 has_photo 를 올린다. 사진 저장이 실패해도 문제는 남는다.
  if (photo) {
    await db.batch([
      db
        .prepare(`INSERT INTO quiz_photos (quiz_id, mime, size, data) VALUES (?, ?, ?, ?)`)
        .bind(quizId, photo.mime, photo.size, photo.base64),
      db.prepare(`UPDATE quiz_rounds SET has_photo = 1 WHERE id = ?`).bind(quizId),
    ]);
  }

  return json({
    ok: true,
    quizId,
    roundNo: await roundNumberFor(db, { status: 'open' }),
    answerType: answerType.key,
    answerForm: answerFormOf(answerType.key, answer.value),
    mode: mode.key,
    modeLabel: mode.label,
    timeLimit,
    timeLimitLabel: timeLimit ? formatDuration(timeLimit) : null,
    hintCount: hints.length,
    hasPhoto: !!photo,
  });
}

/**
 * 잘못 낸 문제 지우기 — 아직 아무도 답을 내지 않았을 때만 되돌릴 수 있다.
 * 회차로 세지 않고 통째로 사라지므로, 이미 누가 답을 냈다면 '퀴즈 종료' 로 끝내야 한다.
 */
export async function onRequestDelete(context) {
  const db = context.env.DB;
  const { user, response } = await requireUser(context);
  if (response) return response;

  await settleExpiredQuiz(db);

  const quiz = await openQuiz(db);
  if (!quiz) return fail(409, '진행 중인 퀴즈가 없어요.');
  if (quiz.setter_user_id !== user.id) return fail(403, '문제를 낸 사람만 지울 수 있어요.');

  const touched = await db
    .prepare(`SELECT COUNT(*) AS n FROM quiz_attempts WHERE quiz_id = ?`)
    .bind(quiz.id)
    .first();
  if (touched?.n) {
    return fail(409, '이미 답을 낸 사람이 있어서 지울 수 없어요. 퀴즈를 종료해 주세요.');
  }

  await db.batch([
    db.prepare(`DELETE FROM quiz_photos WHERE quiz_id = ?`).bind(quiz.id),
    db.prepare(`DELETE FROM quiz_players WHERE quiz_id = ?`).bind(quiz.id),
    db.prepare(`DELETE FROM quiz_rounds WHERE id = ?`).bind(quiz.id),
  ]);

  return json({ ok: true, quizId: quiz.id });
}
