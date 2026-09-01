// 테이블 정의의 단일 출처.
// 여기서 schema.sql 과 부트스트랩 엔드포인트가 함께 만들어지므로 둘이 어긋날 일이 없다.
// 모두 IF NOT EXISTS 라 여러 번 실행해도 기존 데이터를 건드리지 않는다.
//
// 이미 예전 스키마(분 단위)로 만들어진 DB 는 src/lib/migrate.js 가 새 모양으로 옮긴다.

export const SCHEMA_STATEMENTS = [
  // 사용자: 플레이어 + 운영자
  // display_name 은 본인이 바꿀 수 있는 닉네임(한글/영문/숫자 10글자 이내),
  // avatar 는 프로필 자리에 들어가는 한 글자(이모지 가능).
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT    NOT NULL UNIQUE,
     display_name  TEXT    NOT NULL,
     avatar        TEXT    NOT NULL DEFAULT '🙂',
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
  //   status = 'open'    아직 진행 중 (마감 전)
  //            'settled' 정답이 공개돼 정상적으로 끝난 게임 -> 회차가 올라간다
  //            'void'    정답 없이 끝난 날 (게임 없음) -> 회차를 올리지 않는다
  //   round_no 는 status='settled' 인 라운드에만 날짜 순으로 매겨진다.
  `CREATE TABLE IF NOT EXISTS rounds (
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

  // 플레이어의 예측 (초 단위)
  `CREATE TABLE IF NOT EXISTS guesses (
     game_date     TEXT    NOT NULL,
     user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     guess_seconds INTEGER NOT NULL CHECK (guess_seconds BETWEEN 0 AND 86399),
     created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game_date, user_id)
   )`,

  // 정답 공개 시점에 확정되는 결과.
  //   diff_seconds = |예측 - 정답| (초)
  //   score        = 0초 차이 3점 / 60초 이내 2점 / 120초 이내 1점 / 그 외 0점
  `CREATE TABLE IF NOT EXISTS results (
     game_date    TEXT    NOT NULL,
     user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     diff_seconds INTEGER NOT NULL,
     score        INTEGER NOT NULL DEFAULT 0,
     is_winner    INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game_date, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id)`,
];
