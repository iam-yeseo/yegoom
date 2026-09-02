-- 기상 · 퇴근시간 맞히기 · 테이블 정의
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:init
-- 전부 IF NOT EXISTS 라 여러 번 실행해도 기존 데이터는 그대로다.

CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT    NOT NULL UNIQUE,
     display_name  TEXT    NOT NULL,
     avatar        TEXT    NOT NULL DEFAULT '🙂',
     photo_version INTEGER NOT NULL DEFAULT 0,
     role          TEXT    NOT NULL CHECK (role IN ('player', 'admin')),
     password_hash TEXT    NOT NULL,
     password_salt TEXT    NOT NULL,
     created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
   );

CREATE TABLE IF NOT EXISTS game_setters (
     game       TEXT    PRIMARY KEY CHECK (game IN ('morning', 'evening')),
     user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   );

CREATE TABLE IF NOT EXISTS user_photos (
     user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     mime       TEXT    NOT NULL,
     size       INTEGER NOT NULL,
     data       TEXT    NOT NULL,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   );

CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT    NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT    NOT NULL
   );

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS rounds (
     game           TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date      TEXT    NOT NULL,
     round_no       INTEGER,
     setter_user_id INTEGER REFERENCES users(id),
     answer_seconds INTEGER,
     answered_at    TEXT,
     status         TEXT    NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'settled', 'void')),
     revealed_at    TEXT,
     closed_at      TEXT,
     created_by     INTEGER REFERENCES users(id),
     created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date)
   );

CREATE TABLE IF NOT EXISTS guesses (
     game          TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date     TEXT    NOT NULL,
     user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     guess_seconds INTEGER NOT NULL CHECK (guess_seconds BETWEEN 0 AND 86399),
     created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date, user_id)
   );

CREATE TABLE IF NOT EXISTS results (
     game         TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date    TEXT    NOT NULL,
     user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     diff_seconds INTEGER NOT NULL,
     score        INTEGER NOT NULL DEFAULT 0,
     is_winner    INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date, user_id)
   );

CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id);
