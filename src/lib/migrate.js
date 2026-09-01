// 예전 스키마(분 단위 · 프로필 없음)로 만들어진 DB 를 지금 모양으로 옮긴다.
//
// 이미 옮겨진 DB 에 다시 실행해도 안전하다. 각 단계는 "옛 컬럼이 아직 있는가"로
// 판단하기 때문에, 한 번 옮기고 나면 조건이 저절로 거짓이 된다.
//
// 옮기는 내용
//   users   : avatar 컬럼 추가
//   rounds  : answer_minutes -> answer_seconds, status/round_no/closed_at 추가
//   guesses : guess_minutes  -> guess_seconds
//   results : diff(분)       -> diff_seconds, score 추가

import { SCHEMA_STATEMENTS } from './schema.js';

async function columnsOf(db, table) {
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    return (results ?? []).map((c) => c.name);
  } catch {
    return [];
  }
}

/** status='settled' 인 라운드에만 날짜 순으로 회차를 다시 매긴다. */
export function renumberRoundsStatements(db) {
  return [
    db.prepare(
      `UPDATE rounds
          SET round_no = (SELECT COUNT(*) FROM rounds r2
                           WHERE r2.status = 'settled' AND r2.game_date <= rounds.game_date)
        WHERE status = 'settled'`,
    ),
    db.prepare(`UPDATE rounds SET round_no = NULL WHERE status <> 'settled'`),
  ];
}

export async function migrate(db) {
  const applied = [];

  // 0. 없는 테이블은 새 모양으로 만든다 (있으면 그대로 둔다)
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));

  // 1. users.avatar — 그냥 컬럼만 붙이면 된다
  const userCols = await columnsOf(db, 'users');
  if (userCols.length && !userCols.includes('avatar')) {
    await db.prepare(`ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '🙂'`).run();
    applied.push('users.avatar');
  }

  // 2. rounds — 컬럼이 여럿 바뀌므로 새 테이블로 옮겨 담는다
  const roundCols = await columnsOf(db, 'rounds');
  if (roundCols.includes('answer_minutes')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE rounds_new (
           game_date      TEXT    PRIMARY KEY,
           round_no       INTEGER,
           answer_seconds INTEGER,
           status         TEXT    NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'settled', 'void')),
           revealed_at    TEXT,
           closed_at      TEXT,
           created_by     INTEGER REFERENCES users(id),
           created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
         )`,
      ),
      db.prepare(
        `INSERT INTO rounds_new
           (game_date, answer_seconds, status, revealed_at, created_by, created_at)
         SELECT game_date,
                answer_minutes * 60,
                CASE WHEN revealed_at IS NOT NULL THEN 'settled' ELSE 'open' END,
                revealed_at,
                created_by,
                created_at
           FROM rounds`,
      ),
      db.prepare(`DROP TABLE rounds`),
      db.prepare(`ALTER TABLE rounds_new RENAME TO rounds`),
    ]);
    await db.batch(renumberRoundsStatements(db));
    applied.push('rounds.answer_seconds');
  }

  // 3. guesses — 분 -> 초
  const guessCols = await columnsOf(db, 'guesses');
  if (guessCols.includes('guess_minutes')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE guesses_new (
           game_date     TEXT    NOT NULL,
           user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           guess_seconds INTEGER NOT NULL CHECK (guess_seconds BETWEEN 0 AND 86399),
           created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
           updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (game_date, user_id)
         )`,
      ),
      db.prepare(
        `INSERT INTO guesses_new (game_date, user_id, guess_seconds, created_at, updated_at)
         SELECT game_date, user_id, guess_minutes * 60, created_at, updated_at FROM guesses`,
      ),
      db.prepare(`DROP TABLE guesses`),
      db.prepare(`ALTER TABLE guesses_new RENAME TO guesses`),
    ]);
    applied.push('guesses.guess_seconds');
  }

  // 4. results — 분 오차 -> 초 오차 + 점수
  const resultCols = await columnsOf(db, 'results');
  if (resultCols.includes('diff') && !resultCols.includes('diff_seconds')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE results_new (
           game_date    TEXT    NOT NULL,
           user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           diff_seconds INTEGER NOT NULL,
           score        INTEGER NOT NULL DEFAULT 0,
           is_winner    INTEGER NOT NULL DEFAULT 0,
           created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (game_date, user_id)
         )`,
      ),
      db.prepare(
        `INSERT INTO results_new (game_date, user_id, diff_seconds, score, is_winner, created_at)
         SELECT game_date,
                user_id,
                diff * 60,
                CASE WHEN diff * 60 = 0   THEN 3
                     WHEN diff * 60 <= 60 THEN 2
                     WHEN diff * 60 <= 120 THEN 1
                     ELSE 0 END,
                is_winner,
                created_at
           FROM results`,
      ),
      db.prepare(`DROP TABLE results`),
      db.prepare(`ALTER TABLE results_new RENAME TO results`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id)`),
    ]);
    applied.push('results.diff_seconds');
  }

  return { applied, migrated: applied.length > 0 };
}
