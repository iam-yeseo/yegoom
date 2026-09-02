// 테이블 정의의 단일 출처.
// 여기서 schema.sql 과 부트스트랩 엔드포인트가 함께 만들어지므로 둘이 어긋날 일이 없다.
// 모두 IF NOT EXISTS 라 여러 번 실행해도 기존 데이터를 건드리지 않는다.
//
// 이미 예전 스키마(분 단위 · 사진 없음 · 게임 하나)로 만들어진 DB 는
// src/lib/migrate.js 가 새 모양으로 옮긴다.

export const SCHEMA_STATEMENTS = [
  // 사용자: 플레이어 + 운영자
  //   role 권한. 'admin' 은 게임에 참여하지 않는 운영자 계정이다.
  // 출제자는 게임마다 다르므로 users 가 아니라 game_setters 에 적는다.
  // display_name 은 본인이 바꿀 수 있는 닉네임(한글/영문/숫자 10글자 이내),
  // avatar 는 사진을 넣지 않았을 때 프로필 자리에 들어가는 한 글자(이모지 가능).
  // photo_version 은 프로필 사진의 판 번호다. 0 이면 사진이 없다는 뜻이고,
  // 사진을 새로 올릴 때마다 1씩 올라가 브라우저 캐시를 자연스럽게 갈아 끼운다.
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT    NOT NULL UNIQUE,
     display_name  TEXT    NOT NULL,
     avatar        TEXT    NOT NULL DEFAULT '🙂',
     photo_version INTEGER NOT NULL DEFAULT 0,
     role          TEXT    NOT NULL CHECK (role IN ('player', 'admin')),
     password_hash TEXT    NOT NULL,
     password_salt TEXT    NOT NULL,
     created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 게임별 출제자 — 한 게임에 한 명.
  //   morning 이 사람의 기상시간을 맞힌다
  //   evening 이 사람의 퇴근시간을 맞힌다
  // 출제자 본인은 자기 게임에 예측을 낼 수 없고 그 게임 랭킹에도 들어가지 않지만,
  // 다른 게임에는 평범한 플레이어로 참가한다.
  `CREATE TABLE IF NOT EXISTS game_setters (
     game       TEXT    PRIMARY KEY CHECK (game IN ('morning', 'evening')),
     user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 프로필 사진 — 사람마다 최대 한 장. 정방형으로 잘라 올린 것만 들어온다.
  // 사진은 목록 조회 때마다 딸려 오면 응답이 무거워지므로 users 와 분리해 두고,
  // /api/avatar 가 이 표에서 꺼내 이미지로 내려 준다. data 는 base64 문자열이다.
  `CREATE TABLE IF NOT EXISTS user_photos (
     user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     mime       TEXT    NOT NULL,
     size       INTEGER NOT NULL,
     data       TEXT    NOT NULL,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
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

  // 라운드: 게임마다 하루에 하나. game_date 는 KST 기준 YYYY-MM-DD
  //   status = 'open'    아직 진행 중 (공개 전)
  //            'settled' 정답이 공개돼 정상적으로 끝난 게임 -> 회차가 올라간다
  //            'void'    정답 없이 끝난 날 (게임 없음) -> 회차를 올리지 않는다
  //   round_no 는 status='settled' 인 라운드에만 게임별로 날짜 순으로 매겨진다.
  //
  // answer_seconds 는 출제자가 기록한 정답이고, answered_at 은 기록한 시각이다.
  // 공개 전까지 이 두 값은 출제자 본인에게만 내려간다. 정답을 넣어 두어도
  // status 는 'open' 그대로라, 남들은 정답이 기록됐는지조차 알 수 없다.
  `CREATE TABLE IF NOT EXISTS rounds (
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
   )`,

  // 플레이어의 예측 (초 단위)
  `CREATE TABLE IF NOT EXISTS guesses (
     game          TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date     TEXT    NOT NULL,
     user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     guess_seconds INTEGER NOT NULL CHECK (guess_seconds BETWEEN 0 AND 86399),
     created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date, user_id)
   )`,

  // 정답 공개 시점에 확정되는 결과.
  //   diff_seconds = |예측 - 정답| (초)
  //   score        = 0초 차이 3점 / 60초 이내 2점 / 120초 이내 1점 / 그 외 0점
  `CREATE TABLE IF NOT EXISTS results (
     game         TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date    TEXT    NOT NULL,
     user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     diff_seconds INTEGER NOT NULL,
     score        INTEGER NOT NULL DEFAULT 0,
     is_winner    INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id)`,
];
