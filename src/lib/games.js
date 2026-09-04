// 하루에 두 판 — 오전 게임과 오후 게임의 정의.
//
// 두 게임은 규칙의 뼈대(초 단위 예측 · 점수 · 회차)를 같이 쓰고, 다른 것은
// 시간대와 "출제자가 정답을 넣는 방식" 뿐이다. 그 차이를 전부 여기 모아 둔다.
//
//   오전  기상시간 맞히기 — 출제자가 '기상했어요' 버튼을 누른 시각이 정답
//         정답 기록 하루 중 언제든 · 예측 마감 10:00
//   오후  퇴근시간 맞히기 — 출제자가 시간을 직접 적어 둔다
//         정답 기록 09:00 ~ 17:59 · 예측 마감 18:00 · '기회' 를 쓴다
//
// 기회 — 오후 게임에만 있다. 한 번에 못 맞히면 그날 기회가 영영 사라지는 게임이라,
// 출제자가 정답을 공개하기 전에 '기회 소진하기' 를 눌러 힌트를 줄 수 있다. 누르면
// 그때까지 예측한 사람 중 정답에 가장 가까운 한 명에게 하이라이트가 들어가고
// (5분 이상 벌어져 있으면 아무도 안 나온다), 남은 기회 수가 참가자에게 알려진다.
// 기회를 다 쓰면 그때부터 정답을 공개할 수 있다. 횟수는 운영자가 /setup 에서 정한다.
//
// 점수 — 규칙의 모양(가까울수록 높은 점수)은 같지만 배점은 게임마다 다르다.
// 오전 게임은 정확히 맞히기가 훨씬 어려워서 정답에 100점을 몰아주고, 그 아래는
// 1시간까지 넓게 잘게 나눈다. 배점표는 게임 정의의 scoreRules 하나에만 있고,
// 서버 채점과 화면의 '점수' 안내가 같은 표를 읽는다.
//
// 두 게임 모두, 출제자가 정답을 넣었는지 여부는 출제자 본인 말고는 아무도 알 수
// 없다 (DB 에만 남고 status 는 공개 전까지 계속 'open' 이다).

export const GAME_KEYS = ['morning', 'evening'];

export const GAMES = {
  morning: {
    key: 'morning',
    label: '기상시간 맞히기',
    short: '오전',
    icon: '🌅',
    title: '기상시간 맞히기',
    subject: '기상시간',
    path: '/morning',
    // 정답을 넣을 수 있는 시간대 (KST, [부터, 까지))
    // 오전은 하루 종일 열려 있다 — 늦게 일어난 날도 그 시각이 그대로 정답이고,
    // 그날 안에는 몇 번이든 다시 누르거나 지울 수 있다.
    answerFrom: 0,
    answerTo: 24 * 3600,
    // 하루 종일이라 화면에서는 이 라벨 대신 '언제든' 으로 안내한다 (answerAllDay)
    answerFromLabel: '00:00',
    answerToLabel: '24:00',
    // 예측 마감 — 예측은 10시에 닫힌다 (정답 기록과는 별개다)
    closeSeconds: 10 * 3600,
    closeLabel: '10:00',
    // 배점 — 위에서부터 처음 걸리는 칸의 점수를 받는다
    scoreRules: [
      { within: 0, score: 100, label: '초까지 정확히' },
      { within: 60, score: 10, label: '1분 이내' },
      { within: 3 * 60, score: 8, label: '3분 이내' },
      { within: 5 * 60, score: 6, label: '5분 이내' },
      { within: 10 * 60, score: 3, label: '10분 이내' },
      { within: 30 * 60, score: 2, label: '30분 이내' },
      { within: 60 * 60, score: 1, label: '1시간 이내' },
    ],
    // 정답을 넣는 방식: 'button' 은 버튼을 누른 시각이 그대로 정답이 된다
    answerMode: 'button',
    answerButton: '기상했어요',
    // 기회는 오후 게임에만 쓴다
    useChances: false,
    defaultChances: 0,
    // 초기 출제자 (계정을 처음 만들 때만 쓴다)
    defaultSetter: 'min',
  },
  evening: {
    key: 'evening',
    label: '퇴근시간 맞히기',
    short: '오후',
    icon: '🌆',
    title: '퇴근시간 맞히기',
    subject: '퇴근시간',
    path: '/evening',
    // 퇴근 시간은 아침에 이미 정해지는 날이 많아, 정답 기록은 오전 9시부터 연다
    answerFrom: 9 * 3600,
    answerTo: 18 * 3600,
    answerFromLabel: '09:00',
    answerToLabel: '18:00',
    closeSeconds: 18 * 3600,
    closeLabel: '18:00',
    scoreRules: [
      { within: 0, score: 3, label: '초까지 정확히' },
      { within: 60, score: 2, label: '60초 이내' },
      { within: 120, score: 1, label: '120초 이내' },
    ],
    // 'time' 은 출제자가 시간을 직접 적어 둔다
    answerMode: 'time',
    answerButton: '퇴근시간 기록하기',
    // 기회 — 운영자가 /setup 에서 바꾸기 전까지의 기본값
    useChances: true,
    defaultChances: 2,
    // 오후 게임의 출제자는 기존 출제자를 그대로 유지한다
    defaultSetter: null,
  },
};

/** 예측을 두 명 이상 받아야 출제자가 기회를 쓰거나 정답을 공개할 수 있다. */
export const MIN_PLAYERS_TO_REVEAL = 2;

/**
 * 기회를 쓸 때 하이라이트가 들어가는 한계.
 * 정답과 5분 이상 벌어져 있으면 가장 가까운 사람이라도 아무 표시가 없다.
 */
export const CLOSE_ENOUGH_SECONDS = 5 * 60;

/** 운영자가 정할 수 있는 기회 횟수의 범위 */
export const MAX_CHANCES = 10;

/** 기회 횟수로 쓸 수 있는 값인지 확인. 아니면 null */
export function normalizeChances(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CHANCES) return null;
  return n;
}

/** 넘어온 값이 게임 키가 맞는지 확인. 아니면 null */
export function gameKeyOf(value) {
  const key = String(value ?? '').trim();
  return GAME_KEYS.includes(key) ? key : null;
}

/** 게임 정의를 꺼낸다. 값이 이상하면 오후 게임(기본)으로 본다. */
export function gameOf(value) {
  return GAMES[gameKeyOf(value) ?? 'evening'];
}

/** 지금 시각(자정부터의 초)에 해당하는 게임 — 오전 게임이 마감되기 전이면 오전 */
export function gameAt(seconds) {
  return seconds < GAMES.morning.closeSeconds ? GAMES.morning : GAMES.evening;
}

/**
 * 정답을 하루 종일 넣을 수 있는 게임인지.
 * 오전 게임은 기록 시간대가 따로 없어서, 화면과 안내 문구가 이 값으로 갈린다.
 */
export function answersAllDay(game) {
  const g = typeof game === 'string' ? gameOf(game) : game;
  return g.answerFrom === 0 && g.answerTo >= 24 * 3600;
}

/** 화면에 내려 줄 게임 정보 (서버 내부용 필드는 빼고) */
export function gameInfo(game) {
  const g = typeof game === 'string' ? gameOf(game) : game;
  return {
    key: g.key,
    label: g.label,
    short: g.short,
    icon: g.icon,
    title: g.title,
    subject: g.subject,
    path: g.path,
    answerMode: g.answerMode,
    answerButton: g.answerButton,
    useChances: g.useChances,
    answerFromLabel: g.answerFromLabel,
    answerToLabel: g.answerToLabel,
    answerAllDay: answersAllDay(g),
    closeLabel: g.closeLabel,
    // 화면의 '점수' 안내가 서버와 같은 배점표를 읽도록 그대로 내려 준다
    scoreRules: g.scoreRules.map((r) => ({ ...r })),
    minPlayersToReveal: MIN_PLAYERS_TO_REVEAL,
    closeEnoughSeconds: CLOSE_ENOUGH_SECONDS,
  };
}
