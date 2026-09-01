// 모든 페이지가 공유하는 헬퍼 — API 호출, 상단 시계, 하단 탭바, 로그인 가드

/* ---------------- API ---------------- */

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 본문이 없거나 JSON 이 아닐 수 있다 */
  }

  if (!res.ok) {
    const err = new Error(data.error || `요청에 실패했습니다. (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- 시간 표시 (KST 고정) ---------------- */

const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

const timeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const secFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  second: '2-digit',
});

/** 상단 시계를 1초마다 갱신한다. */
export function startClock() {
  const dateEl = document.querySelector('[data-clock-date]');
  const timeEl = document.querySelector('[data-clock-time]');
  if (!dateEl || !timeEl) return;

  const tick = () => {
    const now = new Date();
    dateEl.textContent = dateFmt.format(now);
    timeEl.innerHTML = `${timeFmt.format(now)}<small>:${secFmt.format(now).padStart(2, '0')}</small>`;
  };

  tick();
  setInterval(tick, 1000);
  // 백그라운드에 있다가 돌아왔을 때 바로 맞춘다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

/** "2026-09-01" -> "9월 1일 (화)" */
export function formatShortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}월 ${d}일 (${weekday})`;
}

/* ---------------- 하단 탭바 ---------------- */

const TABS = [
  { href: '/', icon: '🎯', label: '오늘의 게임' },
  { href: '/ranking', icon: '🏆', label: '랭킹' },
  { href: '/admin', icon: '🔑', label: '정답 등록', adminOnly: true },
  { href: '/account', icon: '👤', label: '내 프로필' },
];

export function renderTabbar(user) {
  const nav = document.querySelector('[data-tabbar]');
  if (!nav) return;
  const here = location.pathname === '/index.html' ? '/' : location.pathname;

  nav.innerHTML = TABS.filter((t) => !t.adminOnly || user?.role === 'admin')
    .map(
      (t) => `<a class="tabbar__item" href="${t.href}"${here === t.href ? ' aria-current="page"' : ''}>
        <span class="tabbar__icon" aria-hidden="true">${t.icon}</span>${t.label}
      </a>`,
    )
    .join('');
}

/* ---------------- 로그인 가드 ---------------- */

/**
 * 현재 로그인 사용자를 가져온다.
 * 로그인하지 않았으면 로그인 페이지로 보내고 절대 반환하지 않는다.
 */
export async function requireLogin({ adminOnly = false } = {}) {
  let me;
  try {
    me = await api('/api/me');
  } catch {
    location.replace('/login');
    await new Promise(() => {});
  }

  if (!me.user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login?next=${next}`);
    await new Promise(() => {});
  }

  if (adminOnly && me.user.role !== 'admin') {
    location.replace('/');
    await new Promise(() => {});
  }

  return me.user;
}

/* ---------------- 자잘한 것들 ---------------- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

export function showMessage(el, text, kind = 'error') {
  if (!el) return;
  el.textContent = text;
  el.className = `msg msg--${kind}`;
  el.classList.toggle('hidden', !text);
}

/**
 * 프로필 자리에 넣을 한 글자.
 * 사용자가 정해 둔 avatar 를 쓰고, 없으면 닉네임 첫 글자로 대신한다.
 */
export function avatarOf(person) {
  // avatar 는 서버에서 이미 "한 글자" 로 검사해 저장하므로 그대로 쓴다
  const avatar = String(person?.avatar ?? '').trim();
  if (avatar) return escapeHtml(avatar);
  const name = String(person?.displayName ?? person ?? '?').trim();
  return escapeHtml([...name][0] ?? '?');
}

/** "18:00:00" -> "18:00:00" / "18:00" (초가 0이면 짧게) */
export function formatTime(value, { seconds = true } = {}) {
  if (!value) return '—';
  const [h, m, s = '00'] = String(value).split(':');
  return seconds || s !== '00' ? `${h}:${m}:${s}` : `${h}:${m}`;
}

/** 회차 표기 — "12회차" */
export function roundLabel(no) {
  return `${no ?? 1}회차`;
}
