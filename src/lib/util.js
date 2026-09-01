// 공통 유틸 — Pages Functions 전역에서 사용
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

const KST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(now = new Date()) {
  return KST_FMT.format(now);
}

/** 자정부터의 분 -> "HH:MM" */
export function minutesToHHMM(m) {
  if (m === null || m === undefined) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "HH:MM" -> 자정부터의 분. 형식이 틀리면 null */
export function hhmmToMinutes(s) {
  if (typeof s !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 입력값을 분 단위 정수로 정규화. 잘못된 값이면 null */
export function normalizeMinutes(input) {
  if (typeof input === 'number' && Number.isInteger(input)) {
    return input >= 0 && input <= 1439 ? input : null;
  }
  return hhmmToMinutes(input);
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
  const row = await context.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`,
  )
    .bind(token)
    .first();
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
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
