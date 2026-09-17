// 회차 게임은 날짜별 게임과 독립적으로 저장한다. 기존 기록은 건드리지 않는다.
export const PARTY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS catchmind_questions (
    id TEXT PRIMARY KEY, question TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), used_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS party_rounds (
    id TEXT PRIMARY KEY, game TEXT NOT NULL CHECK(game IN ('catchmind','numberluck')),
    round_no INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'answering'
      CHECK(state IN ('answering','guessing','closed')),
    question_id TEXT REFERENCES catchmind_questions(id), question TEXT,
    deadline INTEGER, created_at INTEGER NOT NULL, closed_at INTEGER,
    UNIQUE(game, round_no)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_party_active ON party_rounds(game) WHERE state <> 'closed'`,
  `CREATE TABLE IF NOT EXISTS party_lobby (
    game TEXT NOT NULL CHECK(game IN ('catchmind','numberluck')),
    user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(game,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS party_players (
    round_id TEXT NOT NULL REFERENCES party_rounds(id), user_id INTEGER NOT NULL REFERENCES users(id),
    answer_id TEXT NOT NULL UNIQUE, answer TEXT, number INTEGER CHECK(number BETWEEN 1 AND 10),
    ready INTEGER NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, place INTEGER,
    PRIMARY KEY(round_id,user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_party_players_user ON party_players(user_id)`,
  `CREATE TABLE IF NOT EXISTS party_guesses (
    round_id TEXT NOT NULL, user_id INTEGER NOT NULL, answer_id TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY(round_id,user_id,answer_id),
    FOREIGN KEY(round_id,user_id) REFERENCES party_players(round_id,user_id),
    FOREIGN KEY(answer_id) REFERENCES party_players(answer_id)
  )`,
];
