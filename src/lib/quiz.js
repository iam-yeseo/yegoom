// 예굼퀴즈대회 — 규칙과 상태를 한자리에 모은 곳.
//
// 오전·오후 게임과 달리 날짜 구분이 없다. 퀴즈는 한 번에 하나만 열려 있고,
// 그 퀴즈가 끝나면 다음 퀴즈가 이어지는 식으로 계속 굴러간다.
//
//   출제 턴  운영자가 처음 한 명을 지정한다 (quiz_turn 표, 한 줄뿐이다).
//            그다음부터는 가장 먼저 정답을 맞힌 사람에게 저절로 넘어간다.
//   출제     턴을 가진 사람이 문제 · 정답 · (선택) 사진 1장 · (선택) 힌트 3단계를 적는다.
//   정답     숫자만 / 텍스트 / OX 세 가지 중 하나로 받는다.
//   방식     출제자가 셋 중에서 고른다 — 자유 / 선착순 / 타임어택 (QUIZ_MODES).
//   힌트     플레이어가 열면 자기에게만 보이고, 열 때마다 얻을 점수가 깎인다.
//   점수     가장 먼저 맞히면 10점, 그 뒤로 맞히면 8점.
//            여기서 힌트 감점(1·2·3단계 누적)과 오답 감점(1회당 1점)을 뺀다. 0점 밑으로는 안 내려간다.
//   종료     정답이 공개되고, 가장 먼저 맞힌 사람이 다음 출제자가 된다. 끝나는 계기는 방식마다 다르다.
//            정답자가 없으면 턴은 그대로 남아, 다시 내거나 다른 사람에게 넘길 수 있다.

import { personOf } from './util.js';

/* ---------------- 게임 정의 ---------------- */

export const QUIZ = {
  key: 'quiz',
  label: '예굼퀴즈대회',
  short: '퀴즈',
  icon: '🧠',
  title: '문제를 내고 맞혀봐요',
  subject: '퀴즈',
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
  date: {
    key: 'date',
    label: '날짜',
    icon: '📅',
    note: '년 · 월 · 일을 숫자로 채우면 돼요.',
    setterNote: '일만 적어도 되고, 앞에서부터 비워 둘 수 있어요. (예: 3월 7일 / 7일)',
    multiple: false,
    form: 'date',
  },
  duration: {
    key: 'duration',
    label: '시간',
    icon: '⏳',
    note: '시간 · 분 · 초를 숫자로 채우면 돼요.',
    setterNote: '초만 적어도 되고, 앞에서부터 비워 둘 수 있어요. (예: 30분 0초 / 0초)',
    multiple: false,
    form: 'duration',
  },
  money: {
    key: 'money',
    label: '금액',
    icon: '💰',
    note: '숫자만 적으면 단위는 저절로 붙어요.',
    setterNote: '금액과 단위를 고르세요. 단위는 직접 적을 수도 있어요.',
    multiple: false,
    form: 'money',
  },
};

export const ANSWER_TYPE_KEYS = Object.keys(ANSWER_TYPES);

/* ---------------- 정답 양식 ---------------- */
//
// 날짜 · 시간 · 금액은 한 칸에 자유롭게 적는 대신, 숫자 칸 여러 개로 나눠 받는다.
// 칸 순서는 큰 단위부터이고, 앞쪽 칸은 비워 둘 수 있다 — 비운 칸은 아예 표기되지
// 않는다. 마지막 칸(일 · 초 · 금액)은 반드시 채워야 하고, 0 이어도 표기된다.
//
//   25년 3월 7일 / 3월 7일 / 7일
//   1시간 30분 0초 / 30분 0초 / 0초        ('시간' 은 '시' 로도 쓸 수 있다)
//   1,000원 / 500달러 / 3파운드
//
// 출제자가 어디까지 채웠는지가 그 문제의 '모양' 이 되고, 플레이어에게는 같은 모양의
// 칸이 그대로 내려간다. 그래야 서로 같은 자리를 비교하게 된다. 모양은 저장해 둔
// 정답에서 다시 읽어 내므로(answerFormOf) 컬럼을 따로 두지 않는다.

/** 금액에 붙일 수 있는 단위 — 직접 적을 수도 있다 */
export const CURRENCIES = ['원', '엔', '달러', '유로', '위안', '파운드'];
export const DEFAULT_CURRENCY = '원';
/** 직접 적는 단위의 길이 제한 */
export const CURRENCY_MAX = 5;

/** '시간' 자리에 쓸 수 있는 두 가지 표기 */
export const HOUR_UNITS = ['시간', '시'];

export const ANSWER_FORMS = {
  date: {
    key: 'date',
    fields: [
      { key: 'y', unit: '년', placeholder: 'yy', digits: 2 },
      { key: 'm', unit: '월', placeholder: 'mm', digits: 2 },
      { key: 'd', unit: '일', placeholder: 'dd', digits: 2 },
    ],
  },
  duration: {
    key: 'duration',
    // '시간' 은 출제자가 '시' 로 바꿀 수 있다 (units)
    fields: [
      { key: 'h', unit: '시간', units: HOUR_UNITS, placeholder: 'hh', digits: 2 },
      { key: 'm', unit: '분', placeholder: 'mm', digits: 2 },
      { key: 's', unit: '초', placeholder: 'ss', digits: 2 },
    ],
  },
  money: {
    key: 'money',
    // 단위는 칸 뒤에 붙는다 (currencies 에서 고르거나 직접 적는다)
    fields: [{ key: 'v', unit: DEFAULT_CURRENCY, placeholder: '금액', digits: 12, grow: true }],
    currencies: [...CURRENCIES],
    defaultCurrency: DEFAULT_CURRENCY,
    currencyMax: CURRENCY_MAX,
  },
};

/** 이 종류가 숫자 칸 여러 개로 받는 양식이면 그 정의, 아니면 null */
export function answerFormOfType(type) {
  const key = ANSWER_TYPES[type]?.form;
  return key ? ANSWER_FORMS[key] : null;
}

/* ---------------- 진행 방식 ---------------- */

/**
 * 퀴즈가 언제 끝나는지 — 출제자가 문제를 내면서 고른다.
 *
 *   free   출제자가 '퀴즈 종료' 를 누를 때까지. 다만 첫 정답이 나오면 15분 뒤에 저절로 끝난다
 *   first  첫 정답이 나오는 순간 서버가 알아서 끝낸다 (선착순 한 명)
 *   timed  낸 시각부터 제한시간이 지나면 서버가 알아서 끝낸다
 *
 * 어느 방식이든 끝나는 모양은 같다 — 정답이 공개되고, 가장 먼저 맞힌 사람이
 * 다음 출제자가 된다. 출제자는 언제든 직접 먼저 끝낼 수도 있다.
 */
export const QUIZ_MODES = {
  free: {
    key: 'free',
    label: '자유',
    icon: '🎈',
    summary: '첫 정답 뒤 15분',
    setterNote: '맞힌 사람이 계속 쌓여요. 첫 정답이 나오면 15분 뒤에 저절로 끝나요.',
    playerNote: '첫 정답이 나오면 15분 동안만 더 도전할 수 있어요.',
    timed: false,
  },
  first: {
    key: 'first',
    label: '선착순',
    icon: '⚡',
    summary: '첫 정답이 나오면 끝',
    setterNote: '가장 먼저 맞힌 사람이 나오는 순간 자동으로 끝나요.',
    playerNote: '가장 먼저 맞힌 한 사람이 나오면 바로 끝나요.',
    timed: false,
  },
  timed: {
    key: 'timed',
    label: '타임어택',
    icon: '⏱️',
    summary: '시간이 다 되면 마감',
    setterNote: '정해 둔 시간이 지나면 자동으로 끝나고 정답이 공개돼요.',
    playerNote: '남은 시간 안에 맞혀야 해요.',
    timed: true,
  },
};

export const QUIZ_MODE_KEYS = Object.keys(QUIZ_MODES);

/** 아무것도 고르지 않았을 때 (예전 DB 에 남아 있는 퀴즈도 이것으로 본다) */
export const DEFAULT_MODE = 'free';

/**
 * 자유 모드에서 첫 정답이 나온 뒤 남겨 주는 시간 (초).
 *
 * 늦게 들어온 사람도 따라잡을 틈은 주되, 출제자가 잊고 끝내지 않아 퀴즈가 며칠씩
 * 열려 있는 일은 없게 한다. 이 시간이 지나면 제한시간 문제와 똑같이 마감된다.
 */
export const FREE_GRACE_SECONDS = 900;

/** 제한시간으로 고를 수 있는 값 (초) */
export const TIME_LIMITS = [60, 180, 300, 600, 1800];
export const DEFAULT_TIME_LIMIT = 300;

/** 넘어온 값이 진행 방식이 맞는지. 아니면 null */
export function quizModeOf(value) {
  const key = String(value ?? '').trim();
  return QUIZ_MODE_KEYS.includes(key) ? QUIZ_MODES[key] : null;
}

/** 예전 DB 에 mode 가 없는 퀴즈도 자유 모드로 읽는다 */
export function modeOf(quiz) {
  return QUIZ_MODES[quiz?.mode] ?? QUIZ_MODES[DEFAULT_MODE];
}

/** 제한시간 — 고를 수 있는 값 중 하나여야 한다 */
export function normalizeTimeLimit(input) {
  const seconds = Number(input);
  if (!Number.isInteger(seconds) || !TIME_LIMITS.includes(seconds)) {
    return { error: '제한시간을 골라 주세요.' };
  }
  return { value: seconds };
}

/** 300 -> "5분", 90 -> "1분 30초", 3600 -> "1시간" */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  if (s || !parts.length) parts.push(`${s}초`);
  return parts.join(' ');
}

/** 넘어온 값이 정답 종류가 맞는지. 아니면 null */
export function answerTypeOf(value) {
  const key = String(value ?? '').trim();
  return ANSWER_TYPE_KEYS.includes(key) ? ANSWER_TYPES[key] : null;
}

/* ---------------- 정답 양식 다루기 ---------------- */

/** 칸 하나에 적힌 값 — 숫자만, 자릿수 안에서. 비었으면 null, 잘못됐으면 undefined */
function fieldValue(raw, digits) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (!new RegExp(`^\\d{1,${digits}}$`).test(text)) return undefined;
  return String(Number(text));   // 앞의 0 을 떼어 낸다 ("07" -> "7")
}

/** 단위 이름표 — '시간' 처럼 고를 수 있는 칸은 고른 값을, 아니면 정해진 값을 쓴다 */
function unitOf(field, picked) {
  if (!field.units) return field.unit;
  const want = String(picked ?? '').trim();
  return field.units.includes(want) ? want : field.unit;
}

/** 1000 -> "1,000" (금액은 자릿수를 끊어 읽기 쉽게 적는다) */
function withCommas(digitsOnly) {
  return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 양식에 채운 값을 저장·표시용 한 줄로 만든다.
 *
 * 앞쪽 빈 칸은 통째로 빠지고, 한 번 값이 나오면 그 뒤로는 모두 채워야 한다
 * (25년 __ 7일 처럼 가운데가 빈 답은 받지 않는다). 마지막 칸은 필수다.
 *
 * @param {object} parts  칸 값 ({ y, m, d } 등)
 * @param {object} [opts] { unit: '시', currency: '달러' }
 */
export function formatAnswerForm(type, parts, opts = {}) {
  const form = answerFormOfType(type);
  if (!form) return { error: '정답 종류를 골라 주세요.' };
  const given = parts && typeof parts === 'object' ? parts : {};

  // 금액은 칸이 하나뿐이라 단위만 따로 확인하면 된다
  if (form.key === 'money') {
    const currency = normalizeCurrency(opts.currency);
    if (currency.error) return currency;
    const digits = String(given.v ?? '').trim().replace(/,/g, '');
    if (!digits) return { error: '금액을 입력해 주세요.' };
    if (!/^\d{1,12}$/.test(digits)) return { error: '금액은 숫자로만 적어 주세요.' };
    return { value: `${withCommas(String(Number(digits)))}${currency.value}` };
  }

  const values = [];
  for (const field of form.fields) {
    const value = fieldValue(given[field.key], field.digits);
    if (value === undefined) return { error: `${field.unit} 칸은 숫자로만 적어 주세요.` };
    values.push(value);
  }

  const last = values.length - 1;
  if (values[last] === null) {
    return { error: `${form.fields[last].unit} 칸은 반드시 채워 주세요.` };
  }
  // 앞에서부터 비운 칸은 건너뛰고, 값이 시작된 뒤로는 빈 칸이 있으면 안 된다
  const start = values.findIndex((v) => v !== null);
  for (let i = start; i <= last; i += 1) {
    if (values[i] === null) {
      return { error: `${form.fields[i].unit} 칸도 함께 채워 주세요.` };
    }
  }

  const text = form.fields
    .slice(start)
    .map((field, i) => `${values[start + i]}${unitOf(field, opts.unit)}`)
    .join(' ');
  return { value: text };
}

/** 직접 적은 단위까지 받아 주는 금액 단위 검사 */
export function normalizeCurrency(input) {
  const value = String(input ?? '').normalize('NFC').trim() || DEFAULT_CURRENCY;
  if ([...value].length > CURRENCY_MAX) {
    return { error: `단위는 ${CURRENCY_MAX}글자까지 쓸 수 있어요.` };
  }
  // 숫자·쉼표가 섞이면 금액과 단위를 다시 나눌 수 없게 된다
  if (/[\d,\s]/.test(value)) return { error: '단위에는 숫자와 공백을 넣을 수 없어요.' };
  return { value };
}

/**
 * 저장해 둔 정답에서 그 문제의 '모양' 을 다시 읽어 낸다.
 *
 * 플레이어에게는 값이 아니라 이 모양만 내려간다 — 어떤 칸이 있는지, 단위를 무엇으로
 * 적었는지까지만 알려 주면 같은 자리에 답을 채워 넣을 수 있다.
 */
export function answerFormOf(type, answerText) {
  const form = answerFormOfType(type);
  if (!form) return null;
  const text = String(answerText ?? '').trim();

  if (form.key === 'money') {
    const currency = text.replace(/^[\d,]+\s*/, '').trim() || DEFAULT_CURRENCY;
    return { key: 'money', fields: [{ ...form.fields[0], unit: currency }], currency };
  }

  // 뒤에서부터 몇 칸이 쓰였는지 센다 (앞쪽 칸만 빠질 수 있다)
  const unit = form.key === 'duration'
    ? (HOUR_UNITS.find((u) => new RegExp(`\\d\\s*${u}(\\s|$)`).test(text)) ?? form.fields[0].unit)
    : null;
  const used = form.fields.filter((field) => {
    const names = field.units ? field.units : [field.unit];
    return names.some((n) => new RegExp(`\\d\\s*${n}(\\s|$)`).test(text));
  });
  const fields = (used.length ? form.fields.slice(form.fields.length - used.length) : form.fields)
    .map((field) => ({ ...field, unit: unitOf(field, unit) }));
  return { key: form.key, fields, unit: unit ?? undefined };
}

/** 양식으로 받은 답을 비교용 값으로 (단위 표기는 무시하고 숫자만 본다) */
function formCompareKey(type, text) {
  const form = answerFormOfType(type);
  if (!form) return null;
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  if (form.key === 'money') {
    const digits = raw.replace(/[^\d]/g, '');
    return digits ? String(Number(digits)) : null;
  }
  // "3월 7일" -> { m: 3, d: 7 } — 단위 이름으로 자리를 찾는다
  const found = {};
  for (const field of form.fields) {
    for (const name of field.units ?? [field.unit]) {
      const m = raw.match(new RegExp(`(\\d+)\\s*${name}(\\s|$)`));
      if (m) found[field.key] = String(Number(m[1]));
    }
  }
  const keys = form.fields.map((f) => f.key);
  if (found[keys[keys.length - 1]] === undefined) return null;
  return keys.map((k) => found[k] ?? '').join('|');
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
export function normalizeAnswerText(type, input, opts = {}) {
  const answerType = answerTypeOf(type);
  if (!answerType) return { error: '정답 종류를 골라 주세요.' };

  // 날짜 · 시간 · 금액은 칸 여러 개로 들어오므로 쉼표로 쪼개지 않는다
  if (answerType.form) return formatAnswerForm(answerType.key, input, opts);

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

/**
 * 플레이어가 낸 답 — 길이만 확인하고, 맞았는지는 isCorrectAnswer 가 본다.
 *
 * 양식으로 받는 종류(날짜 · 시간 · 금액)는 칸 값이 통째로 들어오므로, 출제자가
 * 정해 둔 모양(form)에 맞춰 같은 한 줄로 만들어 둔다. 그래야 같은 자리끼리 비교된다.
 */
export function normalizeSubmission(input, { type, form } = {}) {
  if (answerFormOfType(type)) {
    const opts = form?.key === 'money'
      ? { currency: form.currency }
      : { unit: form?.unit };
    // 출제자가 쓰지 않은 칸에 답을 채워 넣어도 무시한다
    const allowed = new Set((form?.fields ?? []).map((f) => f.key));
    const parts = Object.fromEntries(
      Object.entries(input && typeof input === 'object' ? input : {})
        .filter(([k]) => !allowed.size || allowed.has(k)),
    );
    return formatAnswerForm(type, parts, opts);
  }

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

  // 양식으로 받는 종류는 단위 표기를 빼고 칸의 숫자만 본다
  if (answerFormOfType(type)) return formCompareKey(type, text);

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
  // 양식으로 받는 종류는 쉼표가 값의 일부일 수 있어(1,000원) 쪼개지 않는다
  if (answerFormOfType(type)) return compareKey(type, stored) === given;
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

// seconds_left 는 제한시간이 걸린 퀴즈에만 값이 들어간다 (deadline_at 이 NULL 이면 NULL).
// 남은 시간을 서버 시계로 재서 내려 주므로, 브라우저 시계가 틀어져 있어도 상관없다.
const QUIZ_COLUMNS = `id, round_no, setter_user_id, answer_type, mode, time_limit_sec, deadline_at,
                      question, answer_text, hint1, hint2, hint3, has_photo, status,
                      closed_reason, created_at, closed_at,
                      CAST(strftime('%s', deadline_at) AS INTEGER)
                        - CAST(strftime('%s', 'now') AS INTEGER) AS seconds_left`;

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

/* ---------------- 퀴즈 끝내기 ---------------- */

/**
 * 퀴즈를 끝낸다 — 정답이 모두에게 공개되고 회차가 하나 올라가며, 출제 턴이 넘어간다.
 *   정답자가 있으면  가장 먼저 맞힌 사람이 다음 출제자가 된다
 *   정답자가 없으면  턴은 출제자에게 그대로 남는다
 *
 * 출제자가 직접 끝낼 때(/api/quiz/close)와, 선착순·제한시간이 저절로 끝날 때 모두
 * 이 함수 하나를 지난다. 그래서 어떤 방식으로 끝나도 뒷정리가 똑같다.
 *
 * UPDATE 는 status='open' 인 줄만 건드리므로, 같은 퀴즈를 두 번 끝내려 해도
 * 회차가 두 번 올라가지는 않는다.
 *
 * @param {'setter'|'first'|'timeup'} reason 끝난 계기 (화면 안내 문구에 쓴다)
 */
export async function closeQuizRound(db, quiz, { reason = 'setter' } = {}) {
  const [winnerId, closed] = await Promise.all([firstSolverId(db, quiz.id), closedCount(db)]);
  const nextTurnId = winnerId ?? quiz.setter_user_id;
  const roundNo = closed + 1;

  await db.batch([
    db
      .prepare(
        `UPDATE quiz_rounds
            SET status = 'closed', closed_at = datetime('now'), round_no = ?, closed_reason = ?
          WHERE id = ? AND status = 'open'`,
      )
      .bind(roundNo, reason, quiz.id),
    ...setQuizTurnStatements(db, nextTurnId),
  ]);

  const solved = await db
    .prepare(`SELECT COUNT(*) AS n FROM quiz_players WHERE quiz_id = ? AND solved_at IS NOT NULL`)
    .bind(quiz.id)
    .first();

  return {
    quizId: quiz.id,
    roundNo,
    reason,
    answer: quiz.answer_text,
    solvedCount: solved?.n ?? 0,
    winnerId,
    nextTurnId,
  };
}

/**
 * 제한시간이 다 된 퀴즈를 마감한다. 마감했으면 그 결과를, 마감할 게 없으면 null.
 *
 * 워커에는 타이머가 없으므로 "누군가 퀴즈를 건드릴 때" 확인한다. 화면이 15초마다
 * 상태를 물어보기 때문에 시간이 지나면 곧 마감되고, 그 사이에 답을 내려 해도
 * 정답 제출이 먼저 이 함수를 지나므로 늦은 답이 받아들여지지는 않는다.
 */
export async function settleExpiredQuiz(db) {
  let quiz;
  try {
    quiz = await db
      .prepare(
        `SELECT ${QUIZ_COLUMNS} FROM quiz_rounds
          WHERE status = 'open' AND deadline_at IS NOT NULL AND deadline_at <= datetime('now')
          ORDER BY id DESC LIMIT 1`,
      )
      .first();
  } catch {
    // 아직 컬럼이 없는 예전 DB — 마감할 것도 없다
    return null;
  }
  if (!quiz) return null;
  return closeQuizRound(db, quiz, { reason: 'timeup' });
}

/* ---------------- 화면에 내려 줄 정보 ---------------- */

/** 규칙과 이름표 — 화면이 서버와 같은 값을 읽도록 그대로 내려 준다 */
export function quizInfo() {
  return {
    ...QUIZ,
    answerTypes: ANSWER_TYPE_KEYS.map((key) => ({ ...ANSWER_TYPES[key] })),
    // 날짜 · 시간 · 금액의 칸 구성 — 출제 폼이 이걸 읽어 칸을 만든다
    answerForms: Object.fromEntries(
      Object.entries(ANSWER_FORMS).map(([key, form]) => [key, JSON.parse(JSON.stringify(form))]),
    ),
    modes: QUIZ_MODE_KEYS.map((key) => ({ ...QUIZ_MODES[key] })),
    defaultMode: DEFAULT_MODE,
    // 화면은 초 단위를 직접 다루지 않고 여기 이름표를 그대로 쓴다
    timeLimits: TIME_LIMITS.map((seconds) => ({ seconds, label: formatDuration(seconds) })),
    defaultTimeLimit: DEFAULT_TIME_LIMIT,
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
