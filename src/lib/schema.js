// 테이블 정의의 단일 출처.
// 여기서 schema.sql 과 부트스트랩 엔드포인트가 함께 만들어지므로 둘이 어긋날 일이 없다.
// 모두 IF NOT EXISTS 라 여러 번 실행해도 기존 데이터를 건드리지 않는다.

export const SCHEMA_STATEMENTS = [
  // 사용자: 플레이어 3명 + 운영자 1명
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT    NOT NULL UNIQUE,
     display_name  TEXT    NOT NULL,
     role          TEXT    NOT NULL CHECK (role IN ('player', 'admin')),
     password_hash TEXT    NOT NULL,
     password_salt TEXT    NOT NULL,
     created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 로그인 세션 (HttpOnly 쿠키에 담기는 토큰)
  `CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT    NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT    NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,

  // 라운드: 하루에 하나. game_date 는 KST 기준 YYYY-MM-DD
  `CREATE TABLE IF NOT EXISTS rounds (
     game_date      TEXT    PRIMARY KEY,
     answer_minutes INTEGER,
     revealed_at    TEXT,
     created_by     INTEGER REFERENCES users(id),
     created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 플레이어의 예측
  `CREATE TABLE IF NOT EXISTS guesses (
     game_date     TEXT    NOT NULL,
     user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     guess_minutes INTEGER NOT NULL CHECK (guess_minutes BETWEEN 0 AND 1439),
     created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game_date, user_id)
   )`,

  // 정답 공개 시점에 확정되는 결과 (우승 횟수는 여기서 집계 -> 항상 재계산 가능)
  `CREATE TABLE IF NOT EXISTS results (
     game_date  TEXT    NOT NULL,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     diff       INTEGER NOT NULL,
     is_winner  INTEGER NOT NULL DEFAULT 0,
     created_at TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game_date, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id)`,
];
