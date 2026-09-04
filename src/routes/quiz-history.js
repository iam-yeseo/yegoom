// 예굼퀴즈대회 — 지난 퀴즈 기록 (최근 30판).
//
// 끝난 퀴즈만 나온다. 끝난 퀴즈의 정답은 모두에게 공개된 값이라 그대로 담는다.
// 힌트 내용은 담지 않는다 — 지나간 문제라도 굳이 다시 뿌릴 이유가 없다.

import { json, photoUrl, requireUser } from '../lib/util.js';
import { ANSWER_TYPES, formatDuration, modeOf, quizInfo, quizPhotoUrl } from '../lib/quiz.js';

export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const db = context.env.DB;

  const { results: rounds } = await db.prepare(
    `SELECT q.id, q.round_no, q.answer_type, q.mode, q.time_limit_sec, q.closed_reason,
            q.question, q.answer_text, q.has_photo, q.created_at, q.closed_at,
            u.id AS setter_id, u.display_name AS setter_name,
            u.avatar AS setter_avatar, u.photo_version AS setter_photo_version
       FROM quiz_rounds q LEFT JOIN users u ON u.id = q.setter_user_id
      WHERE q.status = 'closed'
      ORDER BY q.round_no DESC, q.id DESC LIMIT 30`,
  ).all();

  const ids = (rounds ?? []).map((r) => r.id);
  const { results: entries } = ids.length
    ? await db.prepare(
        `SELECT p.quiz_id, p.solved_rank, p.score, p.hints_used, p.wrongs,
                u.id, u.display_name, u.avatar, u.photo_version
           FROM quiz_players p JOIN users u ON u.id = p.user_id
          WHERE p.quiz_id IN (${ids.map(() => '?').join(', ')}) AND p.solved_at IS NOT NULL
          ORDER BY p.solved_rank ASC`,
      ).bind(...ids).all()
    : { results: [] };

  const byQuiz = new Map();
  for (const row of entries ?? []) {
    if (!byQuiz.has(row.quiz_id)) byQuiz.set(row.quiz_id, []);
    byQuiz.get(row.quiz_id).push({
      id: row.id,
      displayName: row.display_name,
      avatar: row.avatar ?? '🙂',
      photoUrl: photoUrl(row.id, row.photo_version),
      rank: row.solved_rank,
      score: row.score,
      scoreText: `+${row.score}점`,
      hintsUsed: row.hints_used,
      wrongs: row.wrongs,
      isWinner: row.solved_rank === 1,
    });
  }

  return json({
    ok: true,
    game: quizInfo(),
    history: (rounds ?? []).map((r) => ({
      id: r.id,
      roundNo: r.round_no,
      answerType: r.answer_type,
      answerTypeLabel: ANSWER_TYPES[r.answer_type]?.label ?? r.answer_type,
      // 어떤 방식으로 진행했던 판인지 — 진행 방식이 생기기 전 기록은 모두 자유 모드다
      mode: modeOf(r).key,
      modeLabel: modeOf(r).label,
      modeIcon: modeOf(r).icon,
      timeLimitLabel: r.time_limit_sec ? formatDuration(r.time_limit_sec) : null,
      closedReason: r.closed_reason ?? 'setter',
      question: r.question,
      answer: r.answer_text,
      photoUrl: quizPhotoUrl(r),
      closedAt: r.closed_at,
      setter: r.setter_name
        ? {
            id: r.setter_id,
            displayName: r.setter_name,
            avatar: r.setter_avatar ?? '🙂',
            photoUrl: photoUrl(r.setter_id, r.setter_photo_version),
          }
        : null,
      entries: byQuiz.get(r.id) ?? [],
    })),
  });
}
