// 공통 유틸 — 라우트 전역에서 사용
// (밑줄로 시작하는 디렉터리는 라우팅되지 않으므로 API 엔드포인트로 노출되지 않습니다)

export const SESSION_COOKIE = 'toigeun_session';
export const SESSION_DAYS = 30;

/* ---------------- 응답 헬퍼 ---------------- */

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function fail(status, message, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status });
}

/* ---------------- 시간 (KST 고정) ---------------- */

const KST_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const KST_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(now = new Date()) {
  return KST_DATE_FMT.format(now);
}

/** "YYYY-MM-DD" 에서 days 만큼 옮긴 날짜 */
export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

/** KST 기준 지금이 자정으로부터 몇 초인지 (0 ~ 86399) */
export function nowSecondsKST(now = new Date()) {
  // en-GB 24시간 표기는 자정을 "24:00:00" 으로 줄 수 있어 나머지 연산으로 접는다
  const [h, m, s] = KST_TIME_FMT.format(now).split(':').map(Number);
  return ((h * 3600 + m * 60 + s) % 86400 + 86400) % 86400;
}

/** 자정부터의 초 -> "HH:MM:SS" */
export function secondsToHHMMSS(sec) {
  if (sec === null || sec === undefined) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** "HH:MM" 또는 "HH:MM:SS" -> 자정부터의 초. 형식이 틀리면 null */
export function hhmmssToSeconds(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/** 입력값을 초 단위 정수로 정규화. 잘못된 값이면 null */
export function normalizeSeconds(input) {
  if (typeof input === 'number' && Number.isInteger(input)) {
    return input >= 0 && input <= 86399 ? input : null;
  }
  return hhmmssToSeconds(input);
}

/* ---------------- 프로필 (닉네임 · 아바타) ---------------- */

export const NICKNAME_MAX = 10;
/** 한글(완성형/자모) · 영문 · 숫자만. 공백과 기호는 받지 않는다. */
const NICKNAME_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]+$/u;

/** 눈에 보이는 글자 수 (이모지 한 개는 1글자로 센다) */
export function graphemeLength(value) {
  const text = String(value ?? '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length; // Segmenter 가 없으면 코드 포인트로 근사
}

/**
 * 닉네임을 검사해 다듬는다.
 * @returns {{ value: string } | { error: string }}
 */
export function normalizeNickname(input) {
  // 맥/iOS 에서 붙여넣은 한글은 자모가 분리된(NFD) 상태로 올 수 있어 먼저 합쳐 준다
  const value = String(input ?? '').normalize('NFC').trim();
  if (!value) return { error: '닉네임을 입력해 주세요.' };
  if (!NICKNAME_RE.test(value)) {
    return { error: '닉네임은 한글, 영문, 숫자만 쓸 수 있어요.' };
  }
  if (graphemeLength(value) > NICKNAME_MAX) {
    return { error: `닉네임은 ${NICKNAME_MAX}글자까지 가능해요.` };
  }
  return { value };
}

/**
 * 프로필 글자(아바타)를 검사한다. 딱 한 글자, 이모지도 된다.
 * @returns {{ value: string } | { error: string }}
 */
export function normalizeAvatar(input) {
  const value = String(input ?? '').normalize('NFC').trim();
  if (!value) return { error: '프로필에 넣을 글자를 하나 입력해 주세요.' };
  if (graphemeLength(value) !== 1) return { error: '프로필 글자는 딱 한 글자만 넣을 수 있어요.' };
  return { value };
}

/* ---------------- 프로필 사진 ---------------- */

/**
 * 프로필 사진 주소. 아직 사진을 올리지 않았으면 null 이라 화면은 이모지로 돌아간다.
 * 판 번호(v)를 붙여 두면 사진을 바꿨을 때 브라우저가 알아서 새로 받아 간다.
 */
export function photoUrl(userId, version) {
  const v = Number(version ?? 0);
  return Number.isFinite(v) && v > 0 ? `/api/avatar?u=${userId}&v=${v}` : null;
}

/**
 * users 행을 화면에 내려 줄 모양으로 다듬는다.
 * 사진 주소까지 한자리에서 붙이므로 라우트마다 규칙이 갈리지 않는다.
 */
export function personOf(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ?? '🙂',
    photoUrl: photoUrl(row.id, row.photo_version),
    ...extra,
  };
}

/* ---------------- 비밀번호 해싱 (PBKDF2-SHA256) ---------------- */

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password, saltHex) {
  const salt = saltHex ?? randomHex(16);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return { hash: toHex(bits), salt };
}

/** 타이밍 공격을 피하기 위한 상수 시간 비교 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 쿠키 / 세션 ---------------- */

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

/** 요청의 세션 쿠키로 로그인 사용자를 조회. 없거나 만료면 null */
export async function getUser(context) {
  const token = readCookie(context.request, SESSION_COOKIE);
  if (!token) return null;
  // u.* 로 받는 이유: avatar 컬럼이 아직 없는 예전 DB 에서도 로그인은 되어야
  // 운영자가 /api/migrate 로 스키마를 옮길 수 있다.
  const row = await context.env.DB.prepare(
    `SELECT u.*, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`,
  )
    .bind(token)
    .first();
  if (!row) return null;
  return personOf(row, { role: row.role, isSetter: row.is_setter === 1 });
}

/** 로그인 필수 라우트용. 미로그인이면 401 Response 를 반환 */
export async function requireUser(context) {
  const user = await getUser(context);
  if (!user) return { user: null, response: fail(401, '로그인이 필요합니다.') };
  return { user, response: null };
}

export async function requireAdmin(context) {
  const { user, response } = await requireUser(context);
  if (response) return { user: null, response };
  if (user.role !== 'admin') return { user: null, response: fail(403, '운영자만 사용할 수 있습니다.') };
  return { user, response: null };
}

/** 요청 본문을 JSON 으로 파싱. 실패하면 빈 객체 */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}
