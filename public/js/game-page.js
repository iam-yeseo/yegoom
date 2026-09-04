// 오전 게임(기상시간) · 오후 게임(퇴근시간) 화면.
//
// 두 게임은 규칙의 뼈대가 같아서 화면도 같은 것을 쓴다.
// 어느 게임인지는 <body data-game="morning|evening"> 하나로만 갈린다.
//
// 정답을 기록하는 쪽은 운영자가 아니라 출제자다. 기록해 둔 정답과 "기록했는지
// 여부" 는 출제자 본인에게만 보이고, 다른 사람 화면에는 흔적조차 남지 않는다.
//
// 되돌리기 어려운 일은 앱 톤에 맞춘 확인 창으로 한 번 묻고, 결과는 화면 아래
// 토스트로 알린다 (public/js/ui.js). 화면 맨 위 안내문은 스크롤하면 놓치기 쉽다.
//
// 화면은 주기적으로 통째로 다시 그린다. 칸을 여닫을 때는 setHidden 을, 목록을
// 채울 때는 setHtml 을 쓴다 — 둘 다 정말 달라졌을 때만 손대므로 등장
// 애니메이션이 갱신 때마다 다시 돌지 않는다.

import {
  GAMES, api, avatarOf, escapeHtml, personChip, renderTabbar, requireLogin, revealChildren,
  roundLabel, setHidden, setHtml, startClock,
} from '/js/common.js';
import { confirmDialog, showToast } from '/js/ui.js';
import { createTimeInput } from '/js/time-input.js';

const gameKey = document.body.dataset.game === 'morning' ? 'morning' : 'evening';
const GAME = GAMES[gameKey];

/** 예측 입력칸의 기본값 — 오전은 아침, 오후는 정시 퇴근 */
const DEFAULT_GUESS = gameKey === 'morning' ? '07:00:00' : '18:00:00';

document.title = `${GAME.label} · ${GAME.title}`;

document.querySelector('[data-app]').innerHTML = `
  <header class="clock">
    <div class="clock__date" data-clock-date>&nbsp;</div>
    <div class="clock__time" data-clock-time>--:--</div>
  </header>

  <div class="round-line">
    <span class="round-badge" id="round-badge">1회차</span>
    <span class="round-line__note" id="round-note">&nbsp;</span>
  </div>

  <h1 class="page-title">
    <span id="title-text" class="page-title__main">오늘의 ${GAME.subject}</span>
    <span id="subtitle">불러오는 중…</span>
  </h1>

  <section id="answer-box" class="answer hidden">
    <div class="answer__label">오늘의 정답</div>
    <div class="answer__time" id="answer-time">--:--:--</div>
    <div class="muted" id="answer-note"></div>
  </section>

  <section id="closed-box" class="card hidden">
    <div class="card__label">마감</div>
    <p id="closed-text" style="margin: 0"></p>
  </section>

  <section id="chance-box" class="card hidden">
    <div class="card__label">기회</div>
    <p class="chance__headline" id="chance-headline">&nbsp;</p>
    <div id="chance-log"></div>
    <p class="muted" id="chance-note" style="font-size: 13px; margin: 10px 0 0"></p>
  </section>

  <section id="guess-box" class="card hidden">
    <div class="card__label">내 예측 · 초까지</div>
    <div id="guess-input"></div>
    <div class="chips chips--single" id="chips"></div>
    <button id="guess-submit" class="btn" type="button" style="margin-top: 12px">확정하기</button>
    <p class="muted center" style="font-size: 13px; margin: 10px 0 0">
      <span id="guess-hint">&nbsp;</span>
    </p>
  </section>

  <section id="setter-box" class="card hidden">
    <div class="card__label" id="setter-label">나만 아는 정답</div>
    <div class="profile-preview" style="margin-bottom: 14px; padding-bottom: 14px">
      <div class="profile-preview__avatar" id="setter-avatar" aria-hidden="true">🙂</div>
      <div>
        <div class="profile-preview__name" id="setter-name">&nbsp;</div>
        <div class="muted" style="font-size: 13px">오늘의 출제자는 나예요</div>
      </div>
    </div>

    <div id="answer-input-wrap" class="hidden" style="margin-bottom: 12px">
      <div id="answer-input"></div>
    </div>

    <div id="secret" class="secret hidden">
      <div class="secret__time" id="secret-time">--:--:--</div>
      <div class="secret__note" id="secret-note"></div>
    </div>

    <div class="btn-row" style="margin-top: 12px">
      <button id="record" class="btn hidden" type="button">기록하기</button>
      <button id="record-clear" class="btn btn--ghost hidden" type="button">기록 지우기</button>
    </div>

    <button id="burn" class="btn hidden" type="button" style="margin-top: 10px">
      기회 소진하기
    </button>

    <button id="reveal" class="btn hidden" type="button" style="margin-top: 10px">
      정답 공개하기
    </button>

    <p class="muted center" id="setter-hint" style="font-size: 13px; margin: 10px 0 0"></p>
  </section>

  <section id="admin-box" class="card hidden">
    <div class="card__label">운영자</div>
    <p style="margin: 0 0 12px">
      정답은 출제자가 직접 기록하고 공개합니다. 운영자에게도 기록 여부는 보이지 않아요.
    </p>
    <a class="btn btn--ghost" href="/admin">운영 화면으로</a>
  </section>

  <!-- 예측을 확정해 두고 정답이 공개되기를 기다리는 동안 -->
  <section id="wait-box" class="card wait hidden" aria-live="polite">
    <p class="wait__title">
      <span class="wait__dots" aria-hidden="true"><i></i><i></i><i></i></span>정답 공개 대기 중
    </p>
    <p class="wait__note" id="wait-note"></p>
  </section>

  <section class="card">
    <div class="card__label" id="players-label">참가자</div>
    <div id="players">
      <div class="skeleton"></div>
      <div class="skeleton" style="width: 70%"></div>
      <div class="skeleton" style="width: 85%"></div>
    </div>
  </section>

  <section class="card">
    <div class="card__label">점수</div>
    <!-- 배점은 게임마다 달라서, 서버가 내려 준 배점표를 그대로 그린다 -->
    <ul class="rules" id="rules"></ul>
    <p class="muted" style="font-size: 13px; margin: 10px 0 0" id="rules-note">&nbsp;</p>
  </section>
`;

const el = Object.fromEntries(
  [
    'round-badge', 'round-note', 'title-text', 'subtitle',
    'answer-box', 'answer-time', 'answer-note', 'closed-box', 'closed-text',
    'guess-box', 'guess-submit', 'guess-hint', 'chips',
    'setter-box', 'setter-label', 'setter-avatar', 'setter-name', 'setter-hint',
    'answer-input-wrap', 'secret', 'secret-time', 'secret-note',
    'record', 'record-clear', 'burn', 'reveal',
    'chance-box', 'chance-headline', 'chance-log', 'chance-note',
    'admin-box', 'wait-box', 'wait-note', 'players', 'players-label', 'rules', 'rules-note',
  ].map((id) => [id.replace(/-(.)/g, (_, c) => c.toUpperCase()), document.getElementById(id)]),
);

startClock();
const user = await requireLogin();
renderTabbar(user);

// 시 · 분 · 초를 숫자 키패드로 직접 찍어 넣는다 (모바일 시계형 선택기는 초를 못 고른다)
const guessInput = createTimeInput(document.getElementById('guess-input'), {
  value: DEFAULT_GUESS,
  label: `예측 ${GAME.subject}`,
  onChange: syncChips,
});

// 오후 게임의 출제자는 정답을 직접 적는다 (오전은 버튼을 누른 시각이 정답이라 안 쓴다)
const answerInput = createTimeInput(document.getElementById('answer-input'), {
  value: DEFAULT_GUESS,
  label: `정답 ${GAME.subject}`,
});

el.chips.innerHTML =
  `<button class="chip" type="button" data-time="${DEFAULT_GUESS}" aria-pressed="false">
     기본값 ${DEFAULT_GUESS.slice(0, 5)}
   </button>`;
el.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) guessInput.value = chip.dataset.time;
});

function syncChips() {
  for (const chip of el.chips.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.time === guessInput.value));
  }
}

/** 마지막으로 받아 온 상태 — 버튼 핸들러가 남은 기회 같은 걸 참고한다. */
let current = null;

/** 버튼을 잠그고 일을 시킨 뒤, 끝나면 화면을 새로 그린다. */
async function run(button, busyText, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  // 서버를 기다리는 동안 버튼 위로 빛이 한 번씩 지나간다 (멈춰 있는 게 아니라는 표시)
  button.classList.add('btn--busy');
  try {
    await work();
    await load();
  } catch (err) {
    showToast(err.message, 'error');
    button.textContent = label;
  } finally {
    button.classList.remove('btn--busy');
    button.disabled = false;
  }
}

el.guessSubmit.addEventListener('click', () => {
  const time = guessInput.value;
  if (!time) return showToast('예측할 시간을 입력해 주세요.', 'error');
  return run(el.guessSubmit, '확정 중…', async () => {
    const res = await api('/api/guess', { method: 'POST', body: { game: gameKey, time } });
    showToast(`${res.guess} 로 확정했어요.`, 'ok');
  });
});

el.record.addEventListener('click', async () => {
  const isButton = GAME.key === 'morning';
  const time = isButton ? null : answerInput.value;
  if (!isButton && !time) return showToast('정답 시간을 입력해 주세요.', 'error');

  const ok = await confirmDialog({
    icon: GAME.icon,
    title: isButton ? '지금 시각으로 기록할까요?' : '오늘의 정답을 기록할까요?',
    message: '기록한 사실은 아무에게도 보이지 않아요. 공개 전까지 나만 볼 수 있어요.',
    detail: isButton ? '' : `${GAME.subject} ${time}`,
    confirmText: '기록하기',
  });
  if (!ok) return;

  return run(el.record, '기록 중…', async () => {
    const res = await api('/api/answer', {
      method: 'POST',
      body: time ? { game: gameKey, time } : { game: gameKey },
    });
    showToast(`${res.answer} 로 기록했어요. 나만 볼 수 있어요.`, 'ok');
  });
});

el.recordClear.addEventListener('click', async () => {
  const ok = await confirmDialog({
    icon: '🗑️',
    title: '기록해 둔 정답을 지울까요?',
    message: '지우고 나면 다시 기록할 수 있어요.',
    confirmText: '지우기',
    tone: 'danger',
  });
  if (!ok) return;

  return run(el.recordClear, '지우는 중…', async () => {
    await api(`/api/answer?game=${gameKey}`, { method: 'DELETE' });
    showToast('기록을 지웠어요.', 'ok');
  });
});

el.burn.addEventListener('click', async () => {
  const left = current?.chances?.remaining ?? 0;

  const ok = await confirmDialog({
    icon: '🔦',
    title: left > 1 ? '기회를 한 번 쓸까요?' : '마지막 기회를 쓸까요?',
    message: '지금 예측 중 정답에 가장 가까운 사람에게 하이라이트가 들어가요.',
    detail: left > 1 ? `쓰고 나면 ${left - 1}번 남아요` : '쓰고 나면 정답을 공개할 수 있어요',
    confirmText: '기회 쓰기',
  });
  if (!ok) return;

  return run(el.burn, '쓰는 중…', async () => {
    const res = await api('/api/chance', { method: 'POST', body: { game: gameKey } });
    showToast(
      res.closest
        ? `${res.seq}번째 기회 · ${res.closest.displayName} 님이 가장 가까워요. (남은 기회 ${res.remaining}번)`
        : `${res.seq}번째 기회 · 5분 안에 든 사람이 없어요. (남은 기회 ${res.remaining}번)`,
      'ok',
    );
  });
});

el.reveal.addEventListener('click', async () => {
  const ok = await confirmDialog({
    icon: '📣',
    title: '정답을 공개할까요?',
    message: '공개하면 모두의 오차와 점수가 그 자리에서 확정돼요. 되돌리려면 운영자에게 부탁해야 해요.',
    confirmText: '공개하기',
  });
  if (!ok) return;

  return run(el.reveal, '공개 중…', async () => {
    const res = await api('/api/reveal', { method: 'POST', body: { game: gameKey } });
    showToast(
      `${roundLabel(res.roundNo)} 정답 ${res.answer} 공개 완료 · 참가자 ${res.participants}명`,
      'ok',
    );
  });
});

/**
 * 기회 카드 — 참가자와 출제자 모두에게 같은 내용이 보인다.
 * 기회를 쓰면 하이라이트가 공개되므로 어차피 드러나는 정보다.
 * 다만 '누가 가장 가까운가' 만 나오고, 오차 값은 어디에도 내려오지 않는다.
 */
function renderChances(state) {
  const { game, chances } = state;
  const on = game.useChances && (chances.total > 0 || chances.used > 0);
  setHidden(el.chanceBox, !on);
  if (!on) return;

  if (state.revealed) {
    el.chanceHeadline.textContent = `기회 ${chances.used}번을 쓰고 정답이 공개됐어요.`;
  } else if (state.status === 'void') {
    el.chanceHeadline.textContent = '정답 없이 끝나 기회도 사라졌어요.';
  } else if (!chances.used) {
    el.chanceHeadline.textContent = `오늘 걸린 기회는 ${chances.total}번이에요.`;
  } else if (chances.remaining === 1) {
    el.chanceHeadline.textContent = '이제 기회는 단 한 번!';
  } else if (chances.remaining > 1) {
    el.chanceHeadline.textContent = `이제 기회는 ${chances.remaining}번 남았어요!`;
  } else {
    el.chanceHeadline.textContent = '기회를 모두 썼어요. 곧 정답이 공개됩니다.';
  }

  setHtml(el.chanceLog, chances.log.length
    ? chances.log
        .map(
          (c) => `<div class="chance-row${
            c.closest ? ' chance-row--hit' : ''
          }"><span class="chance-row__seq">${c.seq}번째 기회</span>${
            c.closest
              ? `${personChip(c.closest)} 님이 가장 가까워요 🔥`
              : '<span class="muted">5분 안에 든 사람이 없었어요</span>'
          }</div>`,
        )
        .join('')
    : '');

  el.chanceNote.textContent = state.revealed
    ? ''
    : `출제자가 기회를 쓰면 그때 정답에 가장 가까운 사람 한 명이 드러나요. 5분 이상 벌어져 있으면 아무도 뽑히지 않아요.`;
}

/** 출제자 전용 카드 — 기록 상태와 공개 버튼 */
function renderSetter(state) {
  const mine = state.mine ?? {};
  const game = state.game;
  const byButton = game.answerMode === 'button';
  const recorded = !!mine.answerRecorded;

  el.setterLabel.textContent = state.revealed ? '오늘의 출제자' : '나만 아는 정답';
  setHtml(el.setterAvatar, avatarOf(state.setter));
  el.setterName.textContent = state.setter?.displayName ?? '';

  // 오후 게임의 시간 입력칸은 기록할 수 있을 때만 꺼내 둔다
  setHidden(el.answerInputWrap, byButton || !mine.canRecord);
  if (recorded && !answerInput.element.contains(document.activeElement)) {
    answerInput.value = mine.answer;
  }

  setHidden(el.secret, !recorded || state.revealed);
  if (recorded) {
    el.secretTime.textContent = mine.answer;
    el.secretNote.textContent = state.chances.used
      ? '이미 기회를 써서 이 정답은 더 바꿀 수 없어요 · 나만 볼 수 있어요'
      : byButton
        ? '기상 시각으로 기록해 뒀어요 · 나만 볼 수 있어요'
        : '정답으로 기록해 뒀어요 · 나만 볼 수 있어요';
  }

  setHidden(el.record, !mine.canRecord);
  el.record.classList.toggle('btn--big', byButton && !recorded);
  el.record.classList.toggle('btn--ghost', recorded);
  el.record.textContent = byButton
    ? (recorded ? '다시 기록하기' : `${game.icon} ${game.answerButton}`)
    : (recorded ? '정답 다시 기록하기' : game.answerButton);

  setHidden(el.recordClear, !(mine.canRecord && recorded));

  // 기회가 걸린 게임은 기회를 다 써야 공개 버튼이 나온다.
  // (예측이 마감된 뒤에는 더 받을 답이 없으므로 남은 기회와 상관없이 공개할 수 있다)
  const chances = state.chances;
  const chancesLeft = game.useChances && chances.remaining > 0 && !state.closed;

  setHidden(el.burn, state.revealed || !recorded || !chancesLeft);
  el.burn.disabled = !mine.canBurnChance;
  el.burn.textContent = chances.remaining === 1
    ? '마지막 기회 소진하기'
    : `기회 소진하기 (${chances.remaining}번 남음)`;

  setHidden(el.reveal, state.revealed || !recorded || chancesLeft);
  el.reveal.disabled = !mine.canReveal;

  if (state.revealed) {
    el.setterHint.textContent = '정답을 공개했어요. 오늘은 내가 출제자였습니다.';
  } else if (state.status === 'void') {
    el.setterHint.textContent = recorded
      ? '공개하지 않은 채 날짜가 지나 오늘은 게임 없음으로 끝났어요.'
      : game.answerAllDay
        ? '정답을 기록하지 않은 채 날짜가 지나 게임 없음으로 끝났어요.'
        : `${game.answerFromLabel} ~ ${game.answerToLabel} 사이에 기록하지 않아 오늘은 게임 없음으로 끝났어요.`;
  } else if (!recorded) {
    el.setterHint.textContent = game.answerAllDay
      ? '오늘 안에 언제든 기록해 두면 돼요. 기록했는지는 아무에게도 보이지 않아요.'
      : `${game.answerFromLabel} ~ ${game.answerToLabel} 사이에 기록해 두면 돼요. 기록했는지는 아무에게도 보이지 않아요.`;
  } else if (mine.needMore > 0) {
    el.setterHint.textContent = `예측이 ${game.minPlayersToReveal}명 이상 모여야 기회를 쓰거나 공개할 수 있어요. (지금 ${state.submitted}명)`;
  } else if (chancesLeft) {
    el.setterHint.textContent = `기회를 쓰면 지금 정답에 가장 가까운 사람이 드러나요. 남은 기회 ${chances.remaining}번을 다 써야 정답을 공개할 수 있어요.`;
  } else if (game.useChances && chances.total > 0) {
    el.setterHint.textContent = state.closed && chances.remaining > 0
      ? '예측이 마감돼서 남은 기회 없이도 공개할 수 있어요.'
      : '기회를 모두 썼어요. 이제 정답을 공개할 수 있어요.';
  } else {
    el.setterHint.textContent = '이제 언제든 정답을 공개할 수 있어요.';
  }
}

async function load() {
  const state = await api(`/api/today?game=${gameKey}`);
  current = state;
  const game = state.game;
  const isPlayer = user.role === 'player';

  el.roundBadge.textContent = roundLabel(state.roundNo);
  el.roundNote.textContent = state.revealed
    ? '정답 공개'
    : state.closed ? '마감됨' : `${state.closesAt} 마감`;

  // 누구의 시간을 맞히는 게임인지 — 출제자 프로필 사진과 함께 보여 준다
  setHtml(el.titleText, state.setter
    ? `${personChip(state.setter, 'avatar-chip--lg')} 님의 ${escapeHtml(game.subject)}`
    : `오늘의 ${escapeHtml(game.subject)}`);

  if (state.revealed) {
    const winners = state.players.filter((p) => p.isWinner);
    el.subtitle.textContent = winners.length
      ? `오늘의 1등 · ${winners.map((w) => w.displayName).join(', ')}`
      : '정답이 공개됐어요 (참가자 없음)';
  } else if (state.status === 'void') {
    el.subtitle.textContent = '게임 없음 · 회차는 올라가지 않아요';
  } else {
    el.subtitle.textContent =
      `정답 공개 대기 중 · ${state.submitted}/${state.players.length}명 확정`;
  }

  // 정답 카드
  setHidden(el.answerBox, !state.revealed);
  if (state.revealed) {
    el.answerTime.textContent = state.answer;
    const me = state.players.find((p) => p.isMe);
    el.answerNote.textContent = me?.diffText
      ? `내 예측 ${me.guess} · ${me.diffText} · ${me.scoreText}`
      : '';
  }

  // 마감 안내 (정답 없이 끝난 날)
  const voided = state.status === 'void';
  setHidden(el.closedBox, !voided);
  if (voided) {
    el.closedText.textContent = state.isToday
      ? `오늘 ${game.label}은 없던 일이 됐어요. 출제자가 정답을 기록하지 않은 날은 회차도 올라가지 않아요.`
      : '정답 없이 끝난 날이에요 (게임 없음).';
  }

  // 입력 카드 / 출제자 카드 / 운영자 카드
  const canGuess = isPlayer && !state.isSetter && !state.closed;
  setHidden(el.guessBox, !canGuess);
  setHidden(el.setterBox, !state.isSetter);
  setHidden(el.adminBox, user.role !== 'admin');

  renderChances(state);
  if (state.isSetter) renderSetter(state);

  if (canGuess) {
    // 입력 중인 값을 덮어쓰지 않도록, 아직 손대지 않았을 때만 서버 값을 넣는다
    if (!guessInput.element.contains(document.activeElement)) {
      guessInput.value = state.myGuess ?? DEFAULT_GUESS;
    }
    el.guessSubmit.textContent = state.myGuess ? '다시 확정하기' : '확정하기';
    // 기회가 걸린 게임에서는 남은 기회를 예측칸 바로 아래에도 적어 준다
    const left = game.useChances ? state.chances.remaining : 0;
    el.guessHint.textContent = game.useChances && state.chances.used
      ? (left === 1
          ? '이제 기회는 단 한 번! 예측을 다시 확정해 보세요.'
          : left > 1
            ? `기회가 ${left}번 남았어요. 예측을 다시 확정해 보세요.`
            : '기회를 모두 썼어요. 곧 정답이 공개됩니다.')
      : `${state.closesAt} 마감 전까지 몇 번이든 바꿀 수 있어요.`;
  }

  // 배점표 — 위에서부터 처음 걸리는 칸의 점수를 받는다
  el.rules.innerHTML =
    (game.scoreRules ?? [])
      .map((r) => `<li><b>+${r.score}점</b> ${escapeHtml(r.label)}${r.within === 0 ? ' 맞힘' : ''}</li>`)
      .join('') + '<li><b>0점</b> 그 외</li>';

  el.rulesNote.textContent =
    '동점이어도 각자 같은 기준으로 점수를 받아요. 배점은 게임마다 달라요. ' +
    '오전 게임과 오후 게임은 회차를 따로 세고, 랭킹에서는 합쳐서도 볼 수 있어요.';

  // 정답 공개 대기 — 내 예측을 확정해 둔 참가자에게만 뜬다.
  // 출제자가 정답을 기록했는지는 아무에게도 알릴 수 없으므로, 여기서 기다리는 것은
  // '기록' 이 아니라 '공개' 다. (출제자 본인은 자기 카드에서 상태를 본다)
  const waiting = !state.revealed && state.status === 'open' && !state.isSetter && !!state.myGuess;
  setHidden(el.waitBox, !waiting);
  if (waiting) {
    el.waitNote.textContent =
      `내 예측 ${state.myGuess} · 출제자가 정답을 공개하면 오차와 점수가 바로 확정돼요.`;
  }

  // 참가자 목록
  el.playersLabel.textContent = state.revealed ? '결과' : '참가자';
  setHtml(el.players, state.players
    .map((p) => {
      const winner = p.isWinner ? ' player--winner' : p.isClosest ? ' player--closest' : '';
      const tags =
        (p.isMe ? '<span class="tag tag--me">나</span>' : '') +
        (p.isWinner ? '<span class="tag tag--win">1등 🏆</span>' : '') +
        (p.isClosest ? '<span class="tag tag--close">가장 가까워요 🔥</span>' : '');

      let meta;
      if (state.revealed) meta = p.submitted ? `${p.diffText} · ${p.scoreText}` : '예측 없음';
      else if (p.submitted) meta = p.isMe ? `내 예측 ${p.guess}` : '확정 완료 🔒';
      else meta = state.closed ? '예측 없음' : '아직 확정 전';

      const value = state.revealed || p.isMe ? (p.guess ?? '—') : '···';

      return `<div class="player${winner}">
        <div class="player__avatar" aria-hidden="true">${avatarOf(p)}</div>
        <div class="player__body">
          <div class="player__name">${escapeHtml(p.displayName)}${tags}</div>
          <div class="player__meta">${escapeHtml(meta)} · 누적 ${p.totalScore}점</div>
        </div>
        <div class="player__value">${escapeHtml(value)}</div>
      </div>`;
    })
    .join(''));
}

try {
  await load();
  // 첫 화면만 위 칸부터 차례로 올라온다 (그 뒤의 등장은 setHidden 이 맡는다)
  revealChildren(document.querySelector('[data-app]'));
} catch (err) {
  // 네트워크가 끊기면 스켈레톤만 남으므로 상태를 알려 준다
  showToast(`불러오지 못했습니다: ${err.message}`, 'error');
  el.subtitle.textContent = '연결을 확인해 주세요';
  setHtml(el.players, '<p class="muted center">잠시 후 다시 시도합니다.</p>');
}

// 다른 참가자의 확정이나 정답 공개를 반영하기 위해 주기적으로 새로고침
// (실패했더라도 계속 돌면서 연결이 돌아오면 알아서 복구된다)
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load().catch(() => {});
});
