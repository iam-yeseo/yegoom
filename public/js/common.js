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

/* ---------------- 게임 (오전 · 오후) ---------------- */

/**
 * 하루에 두 판. 시간이 지나도 둘 다 볼 수 있게 탭바에 나란히 둔다.
 * 서버 규칙은 src/lib/games.js 가 원본이고, 여기에는 화면에 필요한 것만 둔다.
 */
export const GAMES = {
  morning: {
    key: 'morning',
    label: '오전 게임',
    short: '오전',
    icon: '🌅',
    title: '기상시간 맞히기',
    subject: '기상시간',
    path: '/morning',
  },
  evening: {
    key: 'evening',
    label: '오후 게임',
    short: '오후',
    icon: '🌆',
    title: '퇴근시간 맞히기',
    subject: '퇴근시간',
    path: '/evening',
  },
};

/**
 * 예굼퀴즈대회 — 날짜로 나뉘지 않는 세 번째 게임.
 * 규칙과 배점은 서버(src/lib/quiz.js)가 내려 주므로 여기에는 이름표만 둔다.
 * 오전·오후와 달리 /api/today 를 쓰지 않아서 GAMES 와는 따로 둔다.
 */
export const QUIZ = {
  key: 'quiz',
  label: '예굼퀴즈대회',
  short: '퀴즈',
  icon: '🧠',
  title: '문제 내고 맞히기',
  path: '/quiz',
};

/** 지금(KST) 진행 중인 게임 — 오전 게임 마감(10:00) 전이면 오전 */
export function currentGameKey(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false,
    }).format(now),
  );
  return hour % 24 < 10 ? 'morning' : 'evening';
}

/* ---------------- 하단 탭바 ---------------- */

// 탭이 여섯 개까지 늘어나서 이름표는 짧게 둔다 (좁은 화면에서도 한 줄에 들어가야 한다)
const TABS = [
  { href: GAMES.morning.path, icon: GAMES.morning.icon, label: GAMES.morning.short },
  { href: GAMES.evening.path, icon: GAMES.evening.icon, label: GAMES.evening.short },
  { href: QUIZ.path, icon: QUIZ.icon, label: QUIZ.short },
  { href: '/ranking', icon: '🏆', label: '랭킹' },
  { href: '/admin', icon: '🔑', label: '운영', adminOnly: true },
  { href: '/account', icon: '👤', label: '프로필' },
];

export function renderTabbar(user) {
  const nav = document.querySelector('[data-tabbar]');
  if (!nav) return;
  const here = location.pathname.replace(/\.html$/, '') || '/';

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
 * 프로필 칸 안에 넣을 내용.
 * 사진을 올렸으면 사진을, 아니면 정해 둔 한 글자(없으면 닉네임 첫 글자)를 쓴다.
 *
 * 사진은 정방형으로 잘라 저장되지만, 칸 모양이 바뀌어도 찌그러지지 않도록
 * object-fit: cover 로 채운다.
 */
export function avatarOf(person) {
  const photo = String(person?.photoUrl ?? '').trim();
  if (photo) {
    return `<img class="avatar-img" src="${escapeHtml(photo)}" alt="" loading="lazy"
                 decoding="async" />`;
  }
  // avatar 는 서버에서 이미 "한 글자" 로 검사해 저장하므로 그대로 쓴다
  const avatar = String(person?.avatar ?? '').trim();
  if (avatar) return escapeHtml(avatar);
  const name = String(person?.displayName ?? person ?? '?').trim();
  return escapeHtml([...name][0] ?? '?');
}

/**
 * 글 사이에 끼워 넣는 작은 프로필 칸. 출제자 이름 앞처럼 문장 속에 쓴다.
 * @param {string} [modifier] 크기를 바꾸는 덧클래스 (예: 'avatar-chip--lg')
 */
export function avatarChip(person, modifier = '') {
  return `<span class="avatar-chip${modifier ? ` ${modifier}` : ''}" aria-hidden="true">${
    avatarOf(person)
  }</span>`;
}

/** "(사진) 닉네임" 한 덩어리 — 출제자를 문장 속에 적을 때 쓴다. */
export function personChip(person, modifier = '') {
  if (!person) return '';
  return `<span class="person-chip">${avatarChip(person, modifier)}<b>${
    escapeHtml(person.displayName)
  }</b></span>`;
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

/** 역할 이름 — 운영자 / 오전·오후·퀴즈 출제자 / 플레이어 */
export function roleLabel(user) {
  if (user?.role === 'admin') return '운영자';
  const games = user?.setterGames ?? [];
  if (!games.length) return '플레이어';
  return `${games.map((g) => (g === QUIZ.key ? QUIZ.short : GAMES[g]?.short ?? g)).join('·')} 출제자`;
}
