// 하루에 두 판 — 오전 게임과 오후 게임의 정의.
//
// 두 게임은 규칙의 뼈대(초 단위 예측 · 점수 · 회차)를 같이 쓰고, 다른 것은
// 시간대와 "출제자가 정답을 넣는 방식" 뿐이다. 그 차이를 전부 여기 모아 둔다.
//
//   오전  기상시간 맞히기 — 출제자가 '기상했어요' 버튼을 누른 시각이 정답
//         정답 기록 00:00 ~ 11:59 · 예측 마감 12:00
//   오후  퇴근시간 맞히기 — 출제자가 시간을 직접 적어 둔다
//         정답 기록 12:00 ~ 17:59 · 예측 마감 18:00
//
// 두 게임 모두, 출제자가 정답을 넣었는지 여부는 출제자 본인 말고는 아무도 알 수
// 없다 (DB 에만 남고 status 는 공개 전까지 계속 'open' 이다).

export const GAME_KEYS = ['morning', 'evening'];

export const GAMES = {
  morning: {
    key: 'morning',
    label: '오전 게임',
    short: '오전',
    icon: '🌅',
    title: '기상시간 맞히기',
    subject: '기상시간',
    path: '/morning',
    // 정답을 넣을 수 있는 시간대 (KST, [부터, 까지))
    answerFrom: 0,
    answerTo: 12 * 3600,
    answerFromLabel: '00:00',
    answerToLabel: '12:00',
    // 예측 마감 — 정답 기록 마감과 같은 시각이다
    closeSeconds: 12 * 3600,
    closeLabel: '12:00',
    // 정답을 넣는 방식: 'button' 은 버튼을 누른 시각이 그대로 정답이 된다
    answerMode: 'button',
    answerButton: '기상했어요',
    // 초기 출제자 (계정을 처음 만들 때만 쓴다)
    defaultSetter: 'min',
  },
  evening: {
    key: 'evening',
    label: '오후 게임',
    short: '오후',
    icon: '🌆',
    title: '퇴근시간 맞히기',
    subject: '퇴근시간',
    path: '/evening',
    answerFrom: 12 * 3600,
    answerTo: 18 * 3600,
    answerFromLabel: '12:00',
    answerToLabel: '18:00',
    closeSeconds: 18 * 3600,
    closeLabel: '18:00',
    // 'time' 은 출제자가 시간을 직접 적어 둔다
    answerMode: 'time',
    answerButton: '정답 기록하기',
    // 오후 게임의 출제자는 기존 출제자를 그대로 유지한다
    defaultSetter: null,
  },
};

/** 예측을 두 명 이상 받아야 출제자가 정답을 공개할 수 있다. */
export const MIN_PLAYERS_TO_REVEAL = 2;

/** 넘어온 값이 게임 키가 맞는지 확인. 아니면 null */
export function gameKeyOf(value) {
  const key = String(value ?? '').trim();
  return GAME_KEYS.includes(key) ? key : null;
}

/** 게임 정의를 꺼낸다. 값이 이상하면 오후 게임(기본)으로 본다. */
export function gameOf(value) {
  return GAMES[gameKeyOf(value) ?? 'evening'];
}

/** 지금 시각(자정부터의 초)에 해당하는 게임 — 오전 12시 전이면 오전 게임 */
export function gameAt(seconds) {
  return seconds < GAMES.morning.answerTo ? GAMES.morning : GAMES.evening;
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
    answerFromLabel: g.answerFromLabel,
    answerToLabel: g.answerToLabel,
    closeLabel: g.closeLabel,
    minPlayersToReveal: MIN_PLAYERS_TO_REVEAL,
  };
}
