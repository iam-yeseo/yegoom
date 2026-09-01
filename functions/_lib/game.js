// 라운드 확정 로직 — 정답 공개 시 오차를 계산하고 우승자를 정한다.
import { minutesToHHMM } from './util.js';

/**
 * 정답을 공개하고 결과를 확정한다.
 * - 오차는 |예측 - 정답| (분)
 * - 오차가 가장 작은 사람이 우승, 동점이면 공동 우승
 * - 예측을 제출하지 않은 사람은 결과에서 제외
 */
export async function settleRound(db, gameDate, answerMinutes, adminId) {
  const { results: guesses } = await db
    .prepare(`SELECT user_id, guess_minutes FROM guesses WHERE game_date = ?`)
    .bind(gameDate)
    .all();

  const scored = (guesses ?? []).map((g) => ({
    userId: g.user_id,
    diff: Math.abs(g.guess_minutes - answerMinutes),
  }));
  const best = scored.length ? Math.min(...scored.map((s) => s.diff)) : null;

  const statements = [
    db
      .prepare(
        `INSERT INTO rounds (game_date, answer_minutes, revealed_at, created_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(game_date) DO UPDATE
           SET answer_minutes = excluded.answer_minutes,
               revealed_at    = excluded.revealed_at,
               created_by     = excluded.created_by`,
      )
      .bind(gameDate, answerMinutes, adminId),
    // 재공개(정답 수정)를 대비해 이전 결과를 지우고 다시 쓴다
    db.prepare(`DELETE FROM results WHERE game_date = ?`).bind(gameDate),
    ...scored.map((s) =>
      db
        .prepare(
          `INSERT INTO results (game_date, user_id, diff, is_winner) VALUES (?, ?, ?, ?)`,
        )
        .bind(gameDate, s.userId, s.diff, s.diff === best ? 1 : 0),
    ),
  ];

  await db.batch(statements);

  return {
    gameDate,
    answer: minutesToHHMM(answerMinutes),
    answerMinutes,
    participants: scored.length,
    winners: scored.filter((s) => s.diff === best).map((s) => s.userId),
  };
}

/** 오차(분)를 "1시간 12분 차이" 같은 한국어 문구로 */
export function formatDiff(diff) {
  if (diff === 0) return '정확히 맞힘';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h && m) return `${h}시간 ${m}분 차이`;
  if (h) return `${h}시간 차이`;
  return `${m}분 차이`;
}
