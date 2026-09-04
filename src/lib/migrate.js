// 예전 스키마로 만들어진 DB 를 지금 모양으로 옮긴다.
//
// 이미 옮겨진 DB 에 다시 실행해도 안전하다. 각 단계는 "옛 컬럼이 아직 있는가"로
// 판단하기 때문에, 한 번 옮기고 나면 조건이 저절로 거짓이 된다.
//
// 옮기는 내용
//   users        : avatar / photo_version 컬럼 추가
//   사진          : user_photos 표 추가 (프로필 사진 한 사람당 한 장)
//   rounds       : answer_minutes -> answer_seconds, status/round_no/closed_at/setter_user_id 추가
//   guesses      : guess_minutes  -> guess_seconds
//   results      : diff(분)       -> diff_seconds, score 추가
//   게임 분리     : rounds/guesses/results 에 game 컬럼 추가 (기존 기록은 오후 게임으로)
//   game_setters : 게임별 출제자 표 추가 (기존 출제자는 오후, 오전은 min)
//   기회          : rounds 에 chances_total/chances_used 추가 + round_chances / game_config 표
//   계정          : 운영자 전용 admin 계정을 만들고, 기존 운영자는 출제자/플레이어로 옮긴다
//   퀴즈          : quiz_turn / quiz_rounds / quiz_photos / quiz_players / quiz_attempts 표 추가
//                  (표만 새로 만들면 되므로 0단계에서 함께 처리된다)
//   퀴즈 진행 방식 : quiz_rounds 에 mode / time_limit_sec / deadline_at / closed_reason 추가
//                  (기존 퀴즈는 전부 자유 모드가 된다)
//   퀴즈 정답 양식 : answer_type 의 CHECK 를 넓힌다 (날짜 · 시간 · 금액 추가)

import { GAMES } from './games.js';
import { SCHEMA_STATEMENTS } from './schema.js';
import { SEED_USERS } from './seed.js';
import { assignSetterStatements } from './setter.js';

async function columnsOf(db, table) {
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    return (results ?? []).map((c) => c.name);
  } catch {
    return [];
  }
}

/** status='settled' 인 라운드에만 게임별로 날짜 순으로 회차를 다시 매긴다. */
export function renumberRoundsStatements(db) {
  return [
    db.prepare(
      `UPDATE rounds
          SET round_no = (SELECT COUNT(*) FROM rounds r2
                           WHERE r2.game = rounds.game
                             AND r2.status = 'settled'
                             AND r2.game_date <= rounds.game_date)
        WHERE status = 'settled'`,
    ),
    db.prepare(`UPDATE rounds SET round_no = NULL WHERE status <> 'settled'`),
  ];
}

/**
 * 아직 안 옮겨진 게 있는지 쓰기 없이 확인만 한다. /setup 이 "업데이트 필요" 를
 * 알려 주는 데 쓴다. 테이블이 아예 없으면(초기 설정 전) 빈 배열이다.
 */
export async function pendingMigrations(db) {
  const pending = [];

  const users = await columnsOf(db, 'users');
  if (!users.length) return pending;

  if (!users.includes('avatar')) pending.push('users.avatar');
  if (!users.includes('photo_version')) pending.push('users.photo_version');

  const rounds = await columnsOf(db, 'rounds');
  if (rounds.includes('answer_minutes')) pending.push('rounds.answer_seconds');
  else if (rounds.length && !rounds.includes('setter_user_id')) pending.push('rounds.setter_user_id');

  const guesses = await columnsOf(db, 'guesses');
  if (guesses.includes('guess_minutes')) pending.push('guesses.guess_seconds');

  const results = await columnsOf(db, 'results');
  if (results.includes('diff') && !results.includes('diff_seconds')) {
    pending.push('results.diff_seconds');
  }

  // 오전/오후 두 게임으로 나누면서 붙은 것들
  if (rounds.length && !rounds.includes('game')) pending.push('rounds.game');
  if (guesses.length && !guesses.includes('game')) pending.push('guesses.game');
  if (results.length && !results.includes('game')) pending.push('results.game');
  if (!(await columnsOf(db, 'game_setters')).length) pending.push('game_setters');

  // 오후 게임의 '기회'
  if (rounds.length && !rounds.includes('chances_used')) pending.push('rounds.chances');
  if (!(await columnsOf(db, 'round_chances')).length) pending.push('round_chances');
  if (!(await columnsOf(db, 'game_config')).length) pending.push('game_config');

  // 예굼퀴즈대회 — 표가 통째로 새로 생긴다 (0단계에서 만들어진다)
  for (const table of ['quiz_turn', 'quiz_rounds', 'quiz_photos', 'quiz_players', 'quiz_attempts']) {
    if (!(await columnsOf(db, table)).length) {
      pending.push('quiz');
      break;
    }
  }

  // 퀴즈 진행 방식 (자유 · 선착순 · 제한시간) — quiz_rounds 에 컬럼 넷이 붙는다
  const quizCols = await columnsOf(db, 'quiz_rounds');
  if (quizCols.length && !quizCols.includes('mode')) pending.push('quiz_rounds.mode');

  // 정답 양식 (날짜 · 시간 · 금액) — answer_type 의 CHECK 를 넓혀야 한다
  if (quizCols.length && !(await allowsAnswerForms(db))) pending.push('quiz_rounds.answer_type');

  // 운영자 전용 계정이 아직 없으면 계정 정리도 남아 있는 것이다
  const seedAdmin = SEED_USERS.find((u) => u.role === 'admin');
  if (seedAdmin) {
    const admin = await db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .bind(seedAdmin.username)
      .first();
    if (!admin) pending.push('users.admin-account');
  }

  return pending;
}

export async function migrate(db) {
  const applied = [];

  // 0. 없는 테이블은 새 모양으로 만든다 (있으면 그대로 둔다).
  //    퀴즈 표들은 컬럼을 옮길 게 없어서 이 단계가 전부다 — 만들어졌는지만 남겨 둔다.
  const hadQuiz = (await columnsOf(db, 'quiz_rounds')).length > 0;
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  if (!hadQuiz && (await columnsOf(db, 'quiz_rounds')).length) applied.push('quiz');

  // 1. users — 그냥 컬럼만 붙이면 된다
  const userCols = await columnsOf(db, 'users');
  if (userCols.length && !userCols.includes('avatar')) {
    await db.prepare(`ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '🙂'`).run();
    applied.push('users.avatar');
  }
  // 프로필 사진의 판 번호. 0 이면 아직 사진이 없다는 뜻이라 기존 계정은 그대로 이모지를 쓴다.
  // (사진을 담는 user_photos 표 자체는 0단계에서 이미 만들어졌다.)
  if (userCols.length && !userCols.includes('photo_version')) {
    await db.prepare(`ALTER TABLE users ADD COLUMN photo_version INTEGER NOT NULL DEFAULT 0`).run();
    applied.push('users.photo_version');
  }

  // 2. rounds — 컬럼이 여럿 바뀌므로 새 테이블로 옮겨 담는다
  const roundCols = await columnsOf(db, 'rounds');
  if (roundCols.includes('answer_minutes')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE rounds_new (
           game_date      TEXT    PRIMARY KEY,
           round_no       INTEGER,
           setter_user_id INTEGER REFERENCES users(id),
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
    applied.push('rounds.answer_seconds');
  }

  // 2-1. 이미 초 단위로 옮겨 둔 DB 에는 출제자 컬럼만 더 붙인다
  const roundCols2 = await columnsOf(db, 'rounds');
  if (roundCols2.length && !roundCols2.includes('setter_user_id')) {
    await db.prepare(`ALTER TABLE rounds ADD COLUMN setter_user_id INTEGER`).run();
    applied.push('rounds.setter_user_id');
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
      // 게임이 나뉘기 전 기록이라 전부 오후 게임이 된다 — 오후 배점(3/2/1)으로 다시 센다
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

  // 5. 게임 분리 — 기본키가 (game, game_date) 로 바뀌므로 표를 새로 만들어 옮겨 담는다.
  //    지금까지의 기록은 전부 오후 게임(퇴근시간)이었으므로 game='evening' 이 된다.
  applied.push(...(await migrateGameColumn(db)));

  // 6. 게임별 출제자 — 기존 출제자(users.is_setter)를 오후 게임으로 옮긴다
  applied.push(...(await migrateSetters(db)));

  // 6-1. 기회 — rounds 에 컬럼만 더 붙이면 된다
  //      (round_chances / game_config 표는 0단계에서 이미 만들어졌다)
  const chanceCols = await columnsOf(db, 'rounds');
  if (chanceCols.length && !chanceCols.includes('chances_total')) {
    await db.prepare(`ALTER TABLE rounds ADD COLUMN chances_total INTEGER`).run();
    applied.push('rounds.chances_total');
  }
  if (chanceCols.length && !chanceCols.includes('chances_used')) {
    await db.prepare(
      `ALTER TABLE rounds ADD COLUMN chances_used INTEGER NOT NULL DEFAULT 0`,
    ).run();
    applied.push('rounds.chances_used');
  }

  // 6-2. 퀴즈 진행 방식 — 컬럼만 더 붙이면 된다.
  //      이미 있던 퀴즈는 mode 기본값 'free' 를 받아 지금까지와 똑같이 굴러간다.
  //      (deadline_at 이 NULL 이면 제한시간이 없는 것이므로 자동 마감도 걸리지 않는다.)
  applied.push(...(await migrateQuizModes(db)));

  // 6-3. 정답 양식 — answer_type 이 받는 값의 목록을 넓힌다
  applied.push(...(await migrateAnswerTypes(db)));

  // 7. 계정 — 운영자를 admin 계정 하나로 분리한다
  applied.push(...(await migrateAccounts(db)));

  return { applied, migrated: applied.length > 0 };
}

/**
 * rounds / guesses / results 에 game 컬럼을 붙인다.
 * SQLite 는 기본키를 나중에 바꿀 수 없어서, 새 표로 옮겨 담고 이름을 바꾼다.
 *
 * 옮겨 담을 때 기존 행은 전부 'evening'(퇴근시간) 이 된다. 회차 번호도 게임별로
 * 다시 매기지만, 오후 게임에는 기존 라운드밖에 없으므로 번호는 그대로 유지된다.
 */
async function migrateGameColumn(db) {
  const applied = [];

  if (!(await columnsOf(db, 'rounds')).includes('game')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE rounds_g (
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
      ),
      // 예전에는 정답을 공개할 때 한 번에 넣었으므로, 기록 시각은 공개 시각으로 본다
      db.prepare(
        `INSERT INTO rounds_g
           (game, game_date, round_no, setter_user_id, answer_seconds, answered_at,
            status, revealed_at, closed_at, created_by, created_at)
         SELECT 'evening', game_date, round_no, setter_user_id, answer_seconds, revealed_at,
                status, revealed_at, closed_at, created_by, created_at
           FROM rounds`,
      ),
      db.prepare(`DROP TABLE rounds`),
      db.prepare(`ALTER TABLE rounds_g RENAME TO rounds`),
    ]);
    applied.push('rounds.game');
  }

  if (!(await columnsOf(db, 'guesses')).includes('game')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE guesses_g (
           game          TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
           game_date     TEXT    NOT NULL,
           user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           guess_seconds INTEGER NOT NULL CHECK (guess_seconds BETWEEN 0 AND 86399),
           created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
           updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (game, game_date, user_id)
         )`,
      ),
      db.prepare(
        `INSERT INTO guesses_g (game, game_date, user_id, guess_seconds, created_at, updated_at)
         SELECT 'evening', game_date, user_id, guess_seconds, created_at, updated_at FROM guesses`,
      ),
      db.prepare(`DROP TABLE guesses`),
      db.prepare(`ALTER TABLE guesses_g RENAME TO guesses`),
    ]);
    applied.push('guesses.game');
  }

  if (!(await columnsOf(db, 'results')).includes('game')) {
    await db.batch([
      db.prepare(
        `CREATE TABLE results_g (
           game         TEXT    NOT NULL CHECK (game IN ('morning', 'evening')),
           game_date    TEXT    NOT NULL,
           user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           diff_seconds INTEGER NOT NULL,
           score        INTEGER NOT NULL DEFAULT 0,
           is_winner    INTEGER NOT NULL DEFAULT 0,
           created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (game, game_date, user_id)
         )`,
      ),
      db.prepare(
        `INSERT INTO results_g
           (game, game_date, user_id, diff_seconds, score, is_winner, created_at)
         SELECT 'evening', game_date, user_id, diff_seconds, score, is_winner, created_at
           FROM results`,
      ),
      db.prepare(`DROP TABLE results`),
      db.prepare(`ALTER TABLE results_g RENAME TO results`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id)`),
    ]);
    applied.push('results.game');
  }

  if (applied.length) await db.batch(renumberRoundsStatements(db));
  return applied;
}

/**
 * 게임별 출제자 표를 채운다.
 *   오후(퇴근시간) — 기존 출제자(users.is_setter = 1)를 그대로 유지한다
 *   오전(기상시간) — 기본 출제자(min)가 있으면 지정한다
 *
 * 이미 지정돼 있으면 건드리지 않으므로, 운영자가 나중에 바꿔도 되돌려 놓지 않는다.
 * users.is_setter 컬럼은 더 이상 쓰지 않는다 (예전 DB 에는 남아 있어도 무해하다).
 */
async function migrateSetters(db) {
  const applied = [];
  const already = await db.prepare(`SELECT game FROM game_setters`).all();
  const taken = new Set((already.results ?? []).map((r) => r.game));

  if (!taken.has('evening') && (await columnsOf(db, 'users')).includes('is_setter')) {
    const legacy = await db
      .prepare(`SELECT id FROM users WHERE is_setter = 1 AND role = 'player' ORDER BY id LIMIT 1`)
      .first();
    if (legacy) {
      await db.batch(assignSetterStatements(db, 'evening', legacy.id));
      applied.push('game_setters.evening');
    }
  }

  if (!taken.has('morning') && GAMES.morning.defaultSetter) {
    const fallback = await db
      .prepare(`SELECT id FROM users WHERE username = ? AND role = 'player'`)
      .bind(GAMES.morning.defaultSetter)
      .first();
    if (fallback) {
      await db.batch(assignSetterStatements(db, 'morning', fallback.id));
      applied.push('game_setters.morning');
    }
  }

  return applied;
}

/**
 * quiz_rounds 에 진행 방식 컬럼을 붙인다.
 *
 *   mode           'free' | 'first' | 'timed' — 없던 퀴즈는 전부 'free'
 *   time_limit_sec 'timed' 일 때 고른 제한시간 (초)
 *   deadline_at    'timed' 일 때 마감 시각. NULL 이면 자동 마감이 걸리지 않는다.
 *   closed_reason  끝난 계기 — 예전에 끝난 퀴즈는 모두 출제자가 직접 끝낸 것이다
 *
 * ADD COLUMN 은 새 컬럼에 CHECK 를 걸 수 없어서, mode 의 값 검사는 코드
 * (src/lib/quiz.js 의 quizModeOf) 가 맡는다. 새로 만드는 DB 는 schema.js 의
 * 정의대로 CHECK 까지 함께 걸린다.
 */
async function migrateQuizModes(db) {
  const cols = await columnsOf(db, 'quiz_rounds');
  if (!cols.length || cols.includes('mode')) return [];

  await db.prepare(`ALTER TABLE quiz_rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'free'`).run();
  await db.prepare(`ALTER TABLE quiz_rounds ADD COLUMN time_limit_sec INTEGER`).run();
  await db.prepare(`ALTER TABLE quiz_rounds ADD COLUMN deadline_at TEXT`).run();
  await db.prepare(`ALTER TABLE quiz_rounds ADD COLUMN closed_reason TEXT`).run();
  await db.prepare(`UPDATE quiz_rounds SET closed_reason = 'setter' WHERE status = 'closed'`).run();

  return ['quiz_rounds.mode'];
}

/** quiz_rounds 가 새 정답 종류(날짜 · 시간 · 금액)를 받아 주는지 — CHECK 문구로 본다 */
async function allowsAnswerForms(db) {
  try {
    const row = await db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quiz_rounds'`)
      .first();
    // CHECK 가 아예 없으면 무엇이든 들어가므로 옮길 것도 없다
    if (!row?.sql || !/answer_type[^,]*CHECK/i.test(row.sql)) return true;
    return row.sql.includes("'date'");
  } catch {
    return true;
  }
}

/**
 * answer_type 의 CHECK 를 넓힌다 — 'date' · 'duration' · 'money' 를 받을 수 있게.
 *
 * SQLite 는 CHECK 를 나중에 고칠 수 없어서 표를 다시 만들어야 하는데, quiz_rounds 를
 * 그냥 DROP 하면 quiz_players · quiz_attempts · quiz_photos 가 ON DELETE CASCADE 로
 * 함께 지워진다. 지난 퀴즈 기록이 통째로 날아가는 것이다.
 *
 * 그래서 순서를 이렇게 잡는다.
 *   1. 네 표를 제약 없는 임시 표에 그대로 옮겨 담는다
 *   2. 자식부터 지운다 — 부모를 가리키는 것이 없어진다
 *   3. 부모를 지운다 (이제 딸려 지워질 자식이 없다)
 *   4. schema.js 의 정의대로 새로 만들고 값을 되돌려 놓는다
 *
 * D1 은 batch 를 한 트랜잭션으로 처리하므로, 중간에 실패하면 통째로 되돌아간다.
 */
async function migrateAnswerTypes(db) {
  const cols = await columnsOf(db, 'quiz_rounds');
  if (!cols.length || (await allowsAnswerForms(db))) return [];

  const TABLES = ['quiz_rounds', 'quiz_players', 'quiz_attempts', 'quiz_photos'];
  // 표 정의는 schema.js 가 원본이다 — 여기서 다시 적지 않는다
  const creates = TABLES.map((name) => {
    const sql = SCHEMA_STATEMENTS.find((q) =>
      new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`).test(q));
    if (!sql) throw new Error(`${name} 정의를 찾지 못했습니다`);
    return sql;
  });
  const indexes = SCHEMA_STATEMENTS.filter((q) =>
    /CREATE INDEX/i.test(q) && /ON quiz_(players|attempts)/.test(q));

  // 옮겨 담을 때는 양쪽에 다 있는 컬럼만 쓴다 (컬럼이 더 붙은 DB 도 있다)
  const columnsByTable = Object.fromEntries(
    await Promise.all(TABLES.map(async (t) => [t, await columnsOf(db, t)])),
  );

  await db.batch([
    ...TABLES.map((t) => db.prepare(`CREATE TABLE _mv_${t} AS SELECT * FROM ${t}`)),
    // 자식부터 지워야 부모를 지울 때 CASCADE 가 걸리지 않는다
    db.prepare(`DROP TABLE quiz_photos`),
    db.prepare(`DROP TABLE quiz_attempts`),
    db.prepare(`DROP TABLE quiz_players`),
    db.prepare(`DROP TABLE quiz_rounds`),
    ...creates.map((sql) => db.prepare(sql)),
    ...indexes.map((sql) => db.prepare(sql)),
    ...TABLES.map((t) => {
      const names = columnsByTable[t].join(', ');
      return db.prepare(`INSERT INTO ${t} (${names}) SELECT ${names} FROM _mv_${t}`);
    }),
    ...TABLES.map((t) => db.prepare(`DROP TABLE _mv_${t}`)),
  ]);

  return ['quiz_rounds.answer_type'];
}

/**
 * 예전에는 운영자가 곧 출제자였다(퇴근하는 사람이 정답도 등록했다).
 * 이제는 운영자 전용 admin 계정을 따로 두므로, 그 계정이 아직 없으면
 *   1) 시드의 admin 계정을 만들고
 *   2) 기존 운영자들은 플레이어로 내린 뒤, 그중 가장 오래된 한 명을 오후 출제자로 둔다.
 *
 * admin 계정이 생기고 나면 조건이 거짓이 되므로 다시 실행해도 아무 일도 없다.
 * (운영자가 나중에 /setup 에서 출제자를 바꿔도 되돌려 놓지 않는다.)
 */
async function migrateAccounts(db) {
  const seedAdmin = SEED_USERS.find((u) => u.role === 'admin');
  if (!seedAdmin) return [];

  const total = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first();
  if (!total?.n) return []; // 계정이 하나도 없으면 초기 설정이 알아서 넣는다

  const exists = await db
    .prepare(`SELECT id FROM users WHERE username = ?`)
    .bind(seedAdmin.username)
    .first();
  if (exists) return [];

  const { results: legacyAdmins } = await db
    .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id`)
    .all();

  const statements = [
    db
      .prepare(
        `INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
         VALUES (?, ?, ?, 'admin', ?, ?)`,
      )
      .bind(seedAdmin.username, seedAdmin.displayName, seedAdmin.avatar, seedAdmin.hash, seedAdmin.salt),
  ];

  if (legacyAdmins?.length) {
    statements.push(
      db.prepare(
        `UPDATE users SET role = 'player' WHERE role = 'admin' AND username <> ?`,
      ).bind(seedAdmin.username),
      ...assignSetterStatements(db, 'evening', legacyAdmins[0].id),
    );
  }

  await db.batch(statements);
  return ['users.admin-account'];
}
