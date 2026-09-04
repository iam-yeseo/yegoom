// 예굼퀴즈대회 — 규칙과 상태를 한자리에 모은 곳.
//
// 오전·오후 게임과 달리 날짜 구분이 없다. 퀴즈는 한 번에 하나만 열려 있고,
// 그 퀴즈가 끝나면 다음 퀴즈가 이어지는 식으로 계속 굴러간다.
//
//   출제 턴  운영자가 처음 한 명을 지정한다 (quiz_turn 표, 한 줄뿐이다).
//            그다음부터는 가장 먼저 정답을 맞힌 사람에게 저절로 넘어간다.
//   출제     턴을 가진 사람이 문제 · 정답 · (선택) 사진 1장 · (선택) 힌트 3단계를 적는다.
//   정답     숫자만 / 텍스트 / OX 세 가지 중 하나로 받는다.
//   힌트     플레이어가 열면 자기에게만 보이고, 열 때마다 얻을 점수가 깎인다.
//   점수     가장 먼저 맞히면 10점, 그 뒤로 맞히면 8점.
//            여기서 힌트 감점(1·2·3단계 누적)과 오답 감점(1회당 1점)을 뺀다. 0점 밑으로는 안 내려간다.
//   종료     출제자가 끝내면 정답이 공개되고, 가장 먼저 맞힌 사람이 다음 출제자가 된다.
//            정답자가 없으면 턴은 그대로 남아, 다시 내거나 다른 사람에게 넘길 수 있다.

import { personOf } from './util.js';

/* ---------------- 게임 정의 ---------------- */

export const QUIZ = {
  key: 'quiz',
  label: '예굼퀴즈대회',
  short: '퀴즈',
  icon: '🧠',
  title: '문제 내고 맞히기',
  path: '/quiz',
};

/** 가장 먼저 맞힌 사람이 받는 점수 */
export const FIRST_SCORE = 10;
/** 그 뒤에 맞힌 사람이 받는 점수 */
export const NEXT_SCORE = 8;
/** 힌트 단계별 감점 — 1단계 1점, 2단계 2점, 3단계 3점. 쓴 만큼 더해진다. */
export const HINT_PENALTIES = [1, 2, 3];
/** 힌트는 3단계까지 */
export const MAX_HINTS = HINT_PENALTIES.length;
/** 오답 한 번당 감점 */
export const WRONG_PENALTY = 1;

/** 글자 수 제한 */
export const QUESTION_MAX = 500;
export const ANSWER_MAX = 100;
export const HINT_MAX = 200;

/* ---------------- 정답 종류 ---------------- */

export const ANSWER_TYPES = {
  number: {
    key: 'number',
    label: '숫자',
    icon: '🔢',
    // 화면의 입력칸과 안내 문구가 이걸 읽는다
    placeholder: '숫자만 입력',
    note: '숫자만 입력할 수 있어요.',
    setterNote: '정답이 여러 개면 쉼표로 나눠 적어 주세요. (예: 3, 3.0)',
    multiple: true,
  },
  text: {
    key: 'text',
    label: '텍스트',
    icon: '✏️',
    placeholder: '정답 입력',
    note: '띄어쓰기와 대소문자는 달라도 맞는 것으로 봐요.',
    setterNote: '정답이 여러 개면 쉼표로 나눠 적어 주세요. (예: 서울, 서울특별시)',
    multiple: true,
  },
  ox: {
    key: 'ox',
    label: 'OX',
    icon: '⭕',
    placeholder: 'O 또는 X',
    note: 'O 와 X 중에서 고르면 돼요.',
    setterNote: '정답을 O 또는 X 중에서 골라 주세요.',
    multiple: false,
  },
};

export const ANSWER_TYPE_KEYS = Object.keys(ANSWER_TYPES);

/** 넘어온 값이 정답 종류가 맞는지. 아니면 null */
export function answerTypeOf(value) {
  const key = String(value ?? '').trim();
  return ANSWER_TYPE_KEYS.includes(key) ? ANSWER_TYPES[key] : null;
}

/* ---------------- 입력값 다듬기 ---------------- */

/** 문제 본문 — 비어 있으면 안 되고 너무 길어도 안 된다 */
export function normalizeQuestion(input) {
  const value = String(input ?? '').normalize('NFC').trim();
  if (!value) return { error: '문제를 입력해 주세요.' };
  if (value.length > QUESTION_MAX) {
    return { error: `문제는 ${QUESTION_MAX}자까지 쓸 수 있어요.` };
  }
  return { value };
}

/** 힌트 한 단계 — 비워 두면 그 단계는 없는 것이 된다 */
export function normalizeHint(input) {
  const value = String(input ?? '').normalize('NFC').trim();
  if (!value) return { value: null };
  if (value.length > HINT_MAX) return { error: `힌트는 ${HINT_MAX}자까지 쓸 수 있어요.` };
  return { value };
}

/**
 * 출제자가 적은 정답을 검사한다.
 * 숫자·텍스트는 쉼표로 여러 개를 받을 수 있고, OX 는 하나만 받는다.
 * 저장은 적어 낸 그대로 하고(공개할 때 그 모양으로 보여 준다), 채점할 때 다시 쪼갠다.
 */
export function normalizeAnswerText(type, input) {
  const answerType = answerTypeOf(type);
  if (!answerType) return { error: '정답 종류를 골라 주세요.' };

  const raw = String(input ?? '').normalize('NFC').trim();
  if (!raw) return { error: '정답을 입력해 주세요.' };
  if (raw.length > ANSWER_MAX) return { error: `정답은 ${ANSWER_MAX}자까지 쓸 수 있어요.` };

  const parts = splitAnswers(raw);
  if (!parts.length) return { error: '정답을 입력해 주세요.' };
  if (!answerType.multiple && parts.length > 1) {
    return { error: 'OX 문제의 정답은 하나만 고를 수 있어요.' };
  }

  for (const part of parts) {
    if (compareKey(answerType.key, part) === null) {
      return {
        error: answerType.key === 'number'
          ? '정답은 숫자로만 적어 주세요.'
          : 'OX 문제의 정답은 O 또는 X 로 적어 주세요.',
      };
    }
  }

  // 같은 답을 두 번 적어 두어도 채점에는 영향이 없다 — 보이는 모양만 정리한다
  return { value: parts.join(', ') };
}

/** 플레이어가 낸 답 — 길이만 확인하고, 맞았는지는 isCorrectAnswer 가 본다 */
export function normalizeSubmission(input) {
  const value = String(input ?? '').normalize('NFC').trim();
  if (!value) return { error: '정답을 입력해 주세요.' };
  if (value.length > ANSWER_MAX) return { error: `정답은 ${ANSWER_MAX}자까지 쓸 수 있어요.` };
  return { value };
}

/* ---------------- 채점 ---------------- */

/** "서울, 서울특별시" -> ["서울", "서울특별시"] */
function splitAnswers(stored) {
  return String(stored ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 비교용으로 다듬은 값. 종류에 맞지 않으면 null.
 *   숫자   "07" 과 "7.0" 과 "7" 은 같은 답이다
 *   텍스트 대소문자와 띄어쓰기는 무시한다
 *   OX     o / x 는 대문자로 본다
 */
export function compareKey(type, value) {
  const text = String(value ?? '').normalize('NFC').trim();
  if (!text) return null;

  if (type === 'number') {
    if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? String(n) : null;
  }
  if (type === 'ox') {
    const upper = text.toUpperCase();
    if (upper === 'O' || upper === '⭕') return 'O';
    if (upper === 'X' || upper === '❌') return 'X';
    return null;
  }
  return text.toLowerCase().replace(/\s+/g, '');
}

/** 출제자가 적어 둔 정답 중 하나라도 맞으면 정답이다 */
export function isCorrectAnswer(type, stored, submitted) {
  const given = compareKey(type, submitted);
  if (given === null) return false;
  return splitAnswers(stored).some((one) => compareKey(type, one) === given);
}

/* ---------------- 점수 ---------------- */

/** 힌트를 n단계까지 열었을 때의 총 감점 (1 -> 1, 2 -> 3, 3 -> 6) */
export function hintPenalty(used) {
  const n = Math.max(0, Math.min(MAX_HINTS, Number(used) || 0));
  return HINT_PENALTIES.slice(0, n).reduce((sum, p) => sum + p, 0);
}

/** 다음 힌트를 열면 몇 점이 깎이는지. 더 열 게 없으면 null */
export function nextHintPenalty(used) {
  const n = Number(used) || 0;
  return n < MAX_HINTS ? HINT_PENALTIES[n] : null;
}

/** 지금 맞히면 받을 점수 — 0점 밑으로는 내려가지 않는다 */
export function scoreFor({ first, hintsUsed = 0, wrongs = 0 }) {
  const base = first ? FIRST_SCORE : NEXT_SCORE;
  return Math.max(0, base - hintPenalty(hintsUsed) - wrongs * WRONG_PENALTY);
}

/* ---------------- 출제 턴 ---------------- */

const PERSON_COLUMNS = 'u.id, u.username, u.display_name, u.avatar, u.photo_version';

/** 지금 출제 턴을 가진 사람. 아직 없으면 null */
export async function getQuizTurn(db) {
  try {
    const row = await db
      .prepare(
        `SELECT ${PERSON_COLUMNS} FROM quiz_turn t JOIN users u ON u.id = t.user_id
          WHERE t.id = 1 AND u.role = 'player'`,
      )
      .first();
    return personOf(row);
  } catch {
    // quiz_turn 이 아직 없는 예전 DB — 스키마를 옮기기 전에도 화면은 떠야 한다
    return null;
  }
}

/** 출제 턴을 옮긴다. userId 가 null 이면 턴을 가진 사람이 없는 상태가 된다. */
export function setQuizTurnStatements(db, userId) {
  if (userId === null || userId === undefined) {
    return [db.prepare(`DELETE FROM quiz_turn WHERE id = 1`)];
  }
  return [
    db
      .prepare(
        `INSERT INTO quiz_turn (id, user_id) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
      )
      .bind(userId),
  ];
}

/** 이 사람이 출제 턴을 가지고 있는지 */
export async function hasQuizTurn(db, userId) {
  if (!userId) return false;
  const turn = await getQuizTurn(db);
  return turn?.id === userId;
}

/* ---------------- 퀴즈 읽기 ---------------- */

const QUIZ_COLUMNS = `id, round_no, setter_user_id, answer_type, question, answer_text,
                      hint1, hint2, hint3, has_photo, status, created_at, closed_at`;

/** 지금 열려 있는 퀴즈. 없으면 null */
export async function openQuiz(db) {
  return db
    .prepare(`SELECT ${QUIZ_COLUMNS} FROM quiz_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1`)
    .first();
}

/**
 * 화면에 보여 줄 퀴즈 — 열려 있는 게 있으면 그것, 없으면 마지막으로 끝난 퀴즈.
 * 다음 문제를 기다리는 동안에도 직전 결과가 남아 있게 된다.
 */
export async function latestQuiz(db) {
  return (
    (await openQuiz(db)) ??
    (await db
      .prepare(
        `SELECT ${QUIZ_COLUMNS} FROM quiz_rounds WHERE status = 'closed'
          ORDER BY closed_at DESC, id DESC LIMIT 1`,
      )
      .first())
  );
}

/** 지금까지 끝난 퀴즈 수 */
export async function closedCount(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM quiz_rounds WHERE status = 'closed'`).first();
  return row?.n ?? 0;
}

/** 회차 번호 — 끝난 퀴즈는 자기 번호를, 진행 중이면 "다음 회차" 를 쓴다 */
export async function roundNumberFor(db, quiz) {
  if (quiz?.status === 'closed' && quiz.round_no) return quiz.round_no;
  return (await closedCount(db)) + 1;
}

/** 퀴즈에 적힌 힌트들 (비워 둔 단계는 빠진다) */
export function hintsOf(quiz) {
  return [quiz?.hint1, quiz?.hint2, quiz?.hint3].filter((h) => h !== null && h !== undefined && h !== '');
}

/** 한 퀴즈의 참가 기록 — 사람별로 한 줄 */
export async function quizPlayerRows(db, quizId) {
  const { results } = await db
    .prepare(
      `SELECT user_id, hints_used, wrongs, attempts, solved_rank, score, solved_at
         FROM quiz_players WHERE quiz_id = ?`,
    )
    .bind(quizId)
    .all();
  return results ?? [];
}

/** 이 퀴즈에서 가장 먼저 맞힌 사람의 user_id. 아직 없으면 null */
export async function firstSolverId(db, quizId) {
  const row = await db
    .prepare(
      `SELECT user_id FROM quiz_players
        WHERE quiz_id = ? AND solved_at IS NOT NULL
        ORDER BY solved_rank ASC, solved_at ASC, user_id ASC LIMIT 1`,
    )
    .bind(quizId)
    .first();
  return row?.user_id ?? null;
}

/* ---------------- 화면에 내려 줄 정보 ---------------- */

/** 규칙과 이름표 — 화면이 서버와 같은 값을 읽도록 그대로 내려 준다 */
export function quizInfo() {
  return {
    ...QUIZ,
    answerTypes: ANSWER_TYPE_KEYS.map((key) => ({ ...ANSWER_TYPES[key] })),
    maxHints: MAX_HINTS,
    hintPenalties: [...HINT_PENALTIES],
    firstScore: FIRST_SCORE,
    nextScore: NEXT_SCORE,
    wrongPenalty: WRONG_PENALTY,
    questionMax: QUESTION_MAX,
    answerMax: ANSWER_MAX,
    hintMax: HINT_MAX,
  };
}

/** 퀴즈 사진 주소. 사진을 안 넣었으면 null */
export function quizPhotoUrl(quiz) {
  return quiz?.has_photo ? `/api/quiz/photo?q=${quiz.id}` : null;
}

/** 사람 한 명을 화면에 내려 줄 모양으로 꺼낸다. 없으면 null */
export async function personById(db, id) {
  if (!id) return null;
  const row = await db
    .prepare(`SELECT ${PERSON_COLUMNS} FROM users u WHERE u.id = ?`)
    .bind(id)
    .first();
  return personOf(row);
}
