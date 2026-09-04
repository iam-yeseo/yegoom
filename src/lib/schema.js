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

  // 게임별 설정 — 지금은 '기회' 횟수 하나뿐이다. 운영자가 /setup 에서 바꾼다.
  // 행이 없으면 src/lib/games.js 의 defaultChances 를 쓴다.
  `CREATE TABLE IF NOT EXISTS game_config (
     game       TEXT    PRIMARY KEY CHECK (game IN ('morning', 'evening')),
     chances    INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
  //
  // chances_total 은 정답을 기록할 때 game_config 에서 떠 온 그날의 기회 수다.
  // 한 번 시작한 라운드는 운영자가 설정을 바꿔도 그대로 간다.
  // chances_used 는 출제자가 지금까지 쓴 기회 수 — 이건 참가자에게도 보인다
  // (기회를 쓰면 하이라이트가 공개되므로 어차피 드러나는 값이다).
  `CREATE TABLE IF NOT EXISTS rounds (
     game           TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date      TEXT    NOT NULL,
     round_no       INTEGER,
     setter_user_id INTEGER REFERENCES users(id),
     answer_seconds INTEGER,
     answered_at    TEXT,
     chances_total  INTEGER,
     chances_used   INTEGER NOT NULL DEFAULT 0,
     status         TEXT    NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'settled', 'void')),
     revealed_at    TEXT,
     closed_at      TEXT,
     created_by     INTEGER REFERENCES users(id),
     created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date)
   )`,

  // 기회를 한 번 쓸 때마다 남는 기록.
  //   user_id      그때 정답에 가장 가까웠던 사람 (5분 이상 벌어져 있으면 NULL)
  //   diff_seconds 그 사람의 오차 (기록용)
  //   guesses      그때까지 예측을 낸 사람 수
  // 밖으로 나가는 건 "누가 가장 가까운가" 뿐이다. 오차 값은 공개 전까지 아무에게도
  // 내려가지 않는다 — 자기 예측을 아는 사람이 오차를 알면 정답이 그대로 드러난다.
  `CREATE TABLE IF NOT EXISTS round_chances (
     game         TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
     game_date    TEXT    NOT NULL,
     seq          INTEGER NOT NULL,
     user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
     diff_seconds INTEGER,
     guesses      INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (game, game_date, seq)
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
  //   score        = 그 게임의 배점표(src/lib/games.js 의 scoreRules)대로 매긴 점수.
  //                  오전과 오후의 배점이 달라서, 공개 시점의 규칙이 그대로 굳는다.
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

  /* ---------------- 예굼퀴즈대회 ---------------- */

  // 출제 턴 — 지금 문제를 낼 차례인 사람 한 명. 표에는 언제나 한 줄만 있다.
  // 운영자가 처음 지정하고, 그다음부터는 가장 먼저 정답을 맞힌 사람에게 넘어간다.
  // 퀴즈는 날짜로 나뉘지 않으므로 game_setters(오전/오후) 와 따로 둔다.
  `CREATE TABLE IF NOT EXISTS quiz_turn (
     id         INTEGER PRIMARY KEY CHECK (id = 1),
     user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 퀴즈 한 판. 한 번에 하나만 'open' 이고, 출제자가 끝내면 'closed' 가 된다.
  //   answer_type  'number' 숫자만 · 'text' 텍스트 · 'ox' OX
  //   answer_text  출제자가 적은 그대로. 쉼표로 나눈 여러 정답을 모두 인정한다.
  //   hint1~3      단계별 힌트. 비워 두면 그 단계는 없다.
  //   has_photo    사진 한 장을 넣었는지 (사진 자체는 quiz_photos 에 있다)
  //   round_no     끝난 퀴즈에만 순서대로 매겨진다
  //
  // 정답과 힌트는 진행 중에는 출제자 본인에게만 내려간다.
  `CREATE TABLE IF NOT EXISTS quiz_rounds (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     round_no       INTEGER,
     setter_user_id INTEGER REFERENCES users(id),
     answer_type    TEXT    NOT NULL CHECK (answer_type IN ('number', 'text', 'ox')),
     question       TEXT    NOT NULL,
     answer_text    TEXT    NOT NULL,
     hint1          TEXT,
     hint2          TEXT,
     hint3          TEXT,
     has_photo      INTEGER NOT NULL DEFAULT 0,
     status         TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
     closed_at      TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_rounds_status ON quiz_rounds(status)`,

  // 문제에 붙는 사진 — 퀴즈 한 판에 최대 한 장. 프로필 사진과 같은 방식으로
  // base64 문자열을 담아 두고 /api/quiz/photo 가 이미지로 내려 준다.
  // 목록을 읽을 때마다 딸려 오면 응답이 무거워지므로 표를 따로 뒀다.
  `CREATE TABLE IF NOT EXISTS quiz_photos (
     quiz_id    INTEGER PRIMARY KEY REFERENCES quiz_rounds(id) ON DELETE CASCADE,
     mime       TEXT    NOT NULL,
     size       INTEGER NOT NULL,
     data       TEXT    NOT NULL,
     created_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  // 퀴즈별 참가 기록 — 사람마다 한 줄.
  //   hints_used  지금까지 연 힌트 단계 (0~3). 힌트는 연 사람에게만 보인다.
  //   wrongs      틀린 횟수. 한 번 틀릴 때마다 1점씩 깎인다.
  //   solved_rank 맞힌 순서. 1이면 가장 먼저 맞힌 사람이라 다음 출제자가 된다.
  //   score       맞힌 그 순간에 확정된 점수 (10 또는 8에서 감점을 뺀 값)
  `CREATE TABLE IF NOT EXISTS quiz_players (
     quiz_id     INTEGER NOT NULL REFERENCES quiz_rounds(id) ON DELETE CASCADE,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     hints_used  INTEGER NOT NULL DEFAULT 0,
     wrongs      INTEGER NOT NULL DEFAULT 0,
     attempts    INTEGER NOT NULL DEFAULT 0,
     solved_rank INTEGER,
     score       INTEGER,
     solved_at   TEXT,
     updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (quiz_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_players_user ON quiz_players(user_id)`,

  // 제출 기록 — 누가 언제 무엇을 냈는지. 내 오답은 나에게만 보여 준다.
  `CREATE TABLE IF NOT EXISTS quiz_attempts (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     quiz_id    INTEGER NOT NULL REFERENCES quiz_rounds(id) ON DELETE CASCADE,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     answer     TEXT    NOT NULL,
     is_correct INTEGER NOT NULL DEFAULT 0,
     created_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON quiz_attempts(quiz_id, user_id)`,
];
