-- 퇴근시간 맞히기 · Cloudflare D1 스키마
-- 적용: npx wrangler d1 execute toigeun-db --remote --file=./schema.sql

DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS guesses;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- 사용자: 플레이어 3명 + 운영자 1명
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('player', 'admin')),
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 로그인 세션 (HttpOnly 쿠키에 담기는 토큰)
CREATE TABLE sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 라운드: 하루에 하나. game_date 는 KST 기준 YYYY-MM-DD
CREATE TABLE rounds (
  game_date      TEXT    PRIMARY KEY,
  answer_minutes INTEGER,                      -- 자정부터의 분. NULL 이면 아직 미공개
  revealed_at    TEXT,                         -- 정답이 공개된 시각 (UTC ISO)
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 플레이어의 예측
CREATE TABLE guesses (
  game_date     TEXT    NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guess_minutes INTEGER NOT NULL CHECK (guess_minutes BETWEEN 0 AND 1439),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_date, user_id)
);

-- 정답 공개 시점에 확정되는 결과 (우승 횟수는 여기서 집계 -> 항상 재계산 가능)
CREATE TABLE results (
  game_date  TEXT    NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diff       INTEGER NOT NULL,                 -- 정답과의 오차(분), 절댓값
  is_winner  INTEGER NOT NULL DEFAULT 0,       -- 동점이면 여러 명이 우승
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_date, user_id)
);
CREATE INDEX idx_results_user ON results(user_id);
