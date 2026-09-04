// 예굼퀴즈대회 화면.
//
// 오전·오후 게임과 달리 날짜로 나뉘지 않는다. 퀴즈는 한 번에 하나만 열려 있고,
// 출제자가 끝내면 가장 먼저 맞힌 사람이 다음 문제를 낸다. 그래서 이 화면은
// 늘 셋 중 하나를 보여 준다.
//
//   출제 대기  내 차례면 출제 폼, 아니면 "누구를 기다리는 중" 안내
//   진행 중    문제 · 힌트 · 정답 제출 (출제자에게는 종료 버튼)
//   끝난 뒤    정답과 결과, 그리고 다음 출제자
//
// 정답과 힌트는 서버가 볼 수 있는 사람에게만 내려 준다. 화면에서 가리는 게 아니라
// 아예 오지 않으므로, 개발자 도구를 열어도 남의 힌트는 보이지 않는다.
//
// 퀴즈가 언제 끝나는지는 출제자가 문제를 내면서 고른다 (진행 방식).
//   🎈 자유       출제자가 끝낼 때까지
//   ⚡ 선착순     첫 정답이 나오면 그 자리에서
//   ⏱️ 타임어택    정해 둔 시간이 지나면 자동으로
// 뒤 둘은 서버가 알아서 끝내므로, 화면은 남은 시간을 세어 보여 주기만 한다.
//
// 눌러서 벌어진 일은 화면 아래 토스트로 알린다. 화면 맨 위에 붙는 안내문은
// 스크롤을 조금만 내려도 보이지 않아서, 답을 낸 결과를 놓치기 쉬웠다.
//
// 화면은 15초마다 통째로 다시 그린다. 그래서 칸을 여닫을 때는 setHidden 을,
// 목록을 채울 때는 setHtml 을 쓴다 — 둘 다 정말 달라졌을 때만 손대므로
// 등장 애니메이션이 15초마다 다시 도는 일이 없다.

import {
  QUIZ, api, avatarOf, escapeHtml, pageTitle, personChip, playOnce, renderTabbar, requireLogin,
  revealChildren, roundLabel, setHidden, setHtml, startClock,
} from '/js/common.js';
import { confirmDialog, showToast } from '/js/ui.js';
import { shrinkPhoto } from '/js/photo-picker.js';

document.title = pageTitle(QUIZ.label);

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
    <span class="page-title__main">${QUIZ.icon} ${QUIZ.label}</span>
    <span id="subtitle">불러오는 중…</span>
  </h1>

  <!-- 지금 누가 문제를 낼 차례인지 -->
  <section id="turn-box" class="card hidden">
    <div class="card__label">출제 차례</div>
    <div class="profile-preview" style="padding-bottom: 0; border: none">
      <div class="profile-preview__avatar" id="turn-avatar" aria-hidden="true">🙂</div>
      <div>
        <div class="profile-preview__name" id="turn-name">&nbsp;</div>
        <div class="muted" style="font-size: 13px" id="turn-note"></div>
      </div>
    </div>
  </section>

  <!-- 문제 카드 (진행 중 · 끝난 뒤 모두) -->
  <section id="question-box" class="card hidden">
    <div class="card__label" id="question-label">문제</div>

    <!-- 제한시간이 걸린 문제에만 나온다 -->
    <div class="quiz-timer hidden" id="question-timer">
      <span class="quiz-timer__label" id="question-timer-label">남은 시간</span>
      <span class="quiz-timer__value" id="question-timer-value">--:--</span>
    </div>

    <img id="question-photo" class="quiz-photo hidden" alt="문제에 붙은 사진" />
    <p class="quiz-question" id="question-text"></p>
    <div class="quiz-meta">
      <span class="tag tag--mode" id="question-mode"></span>
      <span class="tag" id="question-type"></span>
      <span class="muted" id="question-note"></span>
    </div>
    <p class="muted" id="question-mode-note" style="font-size: 13px; margin: 8px 0 0"></p>
  </section>

  <!-- 정답 공개 (퀴즈가 끝난 뒤) -->
  <section id="answer-box" class="answer hidden">
    <div class="answer__label">정답</div>
    <div class="answer__time quiz-answer-text" id="answer-text">—</div>
    <div class="muted" id="answer-note"></div>
  </section>

  <!-- 내 답 내기 -->
  <section id="play-box" class="card hidden">
    <div class="card__label">내 답</div>
    <p class="quiz-score" id="play-score">&nbsp;</p>
    <p class="muted" id="play-score-note" style="font-size: 13px; margin: 0 0 14px"></p>

    <div id="play-input-wrap">
      <input id="play-answer" type="text" autocomplete="off" autocapitalize="none"
             autocorrect="off" spellcheck="false" placeholder="정답 입력" />
    </div>
    <div class="ox-pick hidden" id="play-ox">
      <button class="ox-btn" type="button" data-ox="O" aria-pressed="false">O</button>
      <button class="ox-btn" type="button" data-ox="X" aria-pressed="false">X</button>
    </div>

    <button id="play-submit" class="btn" type="button" style="margin-top: 12px">정답 제출</button>
    <div id="play-log"></div>
  </section>

  <!-- 힌트 -->
  <section id="hint-box" class="card hidden">
    <div class="card__label">힌트</div>
    <div id="hint-list"></div>
    <button id="hint-open" class="btn btn--ghost hidden" type="button" style="margin-top: 12px">
      힌트 열기
    </button>
    <p class="muted" id="hint-note" style="font-size: 13px; margin: 10px 0 0"></p>
  </section>

  <!-- 출제자 카드 -->
  <section id="setter-box" class="card hidden">
    <div class="card__label">나만 아는 정답</div>
    <div class="secret">
      <div class="secret__time quiz-answer-text" id="setter-answer">—</div>
      <div class="secret__note">내가 낸 문제의 정답이에요 · 나만 볼 수 있어요</div>
    </div>
    <div id="setter-hints"></div>
    <button id="close-quiz" class="btn" type="button" style="margin-top: 14px">퀴즈 종료하기</button>
    <button id="drop-quiz" class="btn btn--ghost hidden" type="button" style="margin-top: 10px">
      문제 지우기
    </button>
    <p class="muted center" id="setter-note" style="font-size: 13px; margin: 10px 0 0"></p>
  </section>

  <!-- 문제 출제 폼 (내 차례일 때) -->
  <section id="compose-box" class="card hidden">
    <div class="card__label">문제 내기</div>

    <div class="card__label" style="margin-top: 2px">진행 방식</div>
    <div class="segmented" role="tablist" aria-label="진행 방식" id="mode-pick"></div>
    <div class="chips chips--time hidden" id="time-pick"></div>
    <p class="muted" id="mode-note" style="font-size: 13px; margin: 8px 0 16px"></p>

    <div class="card__label">정답 종류</div>
    <div class="segmented" role="tablist" aria-label="정답 종류" id="type-pick"></div>
    <p class="muted" id="type-note" style="font-size: 13px; margin: -6px 0 14px"></p>

    <label class="field">
      <span>문제</span>
      <textarea id="c-question" rows="3" placeholder="무엇을 맞혀 볼까요?"></textarea>
    </label>

    <div class="photo-row">
      <div class="photo-preview photo-preview--wide" id="c-photo-preview" aria-hidden="true">🖼️</div>
      <div class="photo-actions">
        <button class="btn btn--ghost" type="button" id="c-photo-pick">사진 넣기 (선택)</button>
        <button class="btn btn--ghost hidden" type="button" id="c-photo-clear">사진 빼기</button>
      </div>
      <input class="photo-file" id="c-photo-file" type="file" accept="image/*" />
    </div>

    <label class="field" id="c-answer-field">
      <span>정답</span>
      <input id="c-answer" type="text" autocomplete="off" autocapitalize="none"
             autocorrect="off" spellcheck="false" />
    </label>
    <div class="ox-pick hidden" id="c-ox" style="margin-bottom: 14px">
      <button class="ox-btn" type="button" data-ox="O" aria-pressed="false">O</button>
      <button class="ox-btn" type="button" data-ox="X" aria-pressed="false">X</button>
    </div>

    <div class="card__label" style="margin-top: 4px">힌트 (선택)</div>
    <p class="muted" style="font-size: 13px; margin: 0 0 12px" id="c-hint-note"></p>
    <label class="field"><span id="c-hint1-label">1단계</span><input id="c-hint1" type="text" /></label>
    <label class="field"><span id="c-hint2-label">2단계</span><input id="c-hint2" type="text" /></label>
    <label class="field"><span id="c-hint3-label">3단계</span><input id="c-hint3" type="text" /></label>

    <button id="c-submit" class="btn" type="button">문제 출제하기</button>
    <p class="muted center" style="font-size: 13px; margin: 10px 0 0">
      정답과 힌트는 출제하는 순간부터 나만 볼 수 있어요.
    </p>
  </section>

  <!-- 턴 넘기기 (내 차례인데 문제를 내지 않을 때) -->
  <section id="pass-box" class="card hidden">
    <div class="card__label">다른 사람에게 넘기기</div>
    <p class="muted" style="margin: 0 0 12px; font-size: 14px">
      내가 내지 않고 다른 플레이어에게 출제 차례를 넘길 수 있어요.
    </p>
    <div id="pass-list"></div>
  </section>

  <section class="card">
    <div class="card__label" id="players-label">참가자</div>
    <div id="players">
      <div class="skeleton"></div>
      <div class="skeleton" style="width: 70%"></div>
    </div>
  </section>

  <section class="card">
    <div class="card__label">점수</div>
    <ul class="rules" id="rules"></ul>
    <p class="muted" style="font-size: 13px; margin: 10px 0 0" id="rules-note">&nbsp;</p>
  </section>
`;

const el = Object.fromEntries(
  [
    'round-badge', 'round-note', 'subtitle',
    'turn-box', 'turn-avatar', 'turn-name', 'turn-note',
    'question-box', 'question-label', 'question-photo', 'question-text', 'question-type',
    'question-note', 'question-mode', 'question-mode-note',
    'question-timer', 'question-timer-label', 'question-timer-value',
    'answer-box', 'answer-text', 'answer-note',
    'play-box', 'play-score', 'play-score-note', 'play-input-wrap', 'play-answer', 'play-ox',
    'play-submit', 'play-log',
    'hint-box', 'hint-list', 'hint-open', 'hint-note',
    'setter-box', 'setter-answer', 'setter-hints', 'close-quiz', 'drop-quiz', 'setter-note',
    'compose-box', 'mode-pick', 'mode-note', 'time-pick',
    'type-pick', 'type-note', 'c-question', 'c-photo-preview', 'c-photo-pick',
    'c-photo-clear', 'c-photo-file', 'c-answer-field', 'c-answer', 'c-ox', 'c-hint-note',
    'c-hint1-label', 'c-hint2-label', 'c-hint3-label', 'c-hint1', 'c-hint2', 'c-hint3', 'c-submit',
    'pass-box', 'pass-list',
    'players', 'players-label', 'rules', 'rules-note',
  ].map((id) => [id.replace(/-(.)/g, (_, c) => c.toUpperCase()), document.getElementById(id)]),
);

// 문제 사진은 다 받은 뒤에 드러난다 (.quiz-photo 는 기본이 opacity 0)
el.questionPhoto.addEventListener('load', () => el.questionPhoto.classList.add('is-loaded'));
el.questionPhoto.addEventListener('error', () => el.questionPhoto.classList.add('is-loaded'));

startClock();
const user = await requireLogin();
renderTabbar(user);

/** 마지막으로 받아 온 상태 */
let current = null;
/** 출제 폼에서 고른 정답 종류 · 진행 방식 · 제한시간 · 사진 (화면을 다시 그려도 유지된다) */
let composeType = 'text';
let composeMode = 'free';
let composeTimeLimit = null;
let composePhoto = null;

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
  } finally {
    button.classList.remove('btn--busy');
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------------- 정답 입력칸 ---------------- */

/** OX 문제는 버튼 두 개로, 나머지는 입력칸으로 받는다. */
function setupAnswerInput({ type, input, wrap, ox, placeholder }) {
  const isOx = type === 'ox';
  // 정답 종류를 바꾸면 입력칸과 OX 버튼이 서로 자리를 바꾼다 — 바뀔 때만 움직인다
  setHidden(wrap, isOx);
  setHidden(ox, !isOx);
  if (isOx) return;

  input.placeholder = placeholder ?? '정답 입력';
  // 숫자 문제는 숫자 키패드를 먼저 띄운다 (음수·소수도 칠 수 있어야 해서 text 로 둔다)
  input.inputMode = type === 'number' ? 'decimal' : 'text';
}

/** OX 버튼 묶음에서 지금 고른 값 */
function oxValue(box) {
  return box.querySelector('[aria-pressed="true"]')?.dataset.ox ?? '';
}

function bindOx(box) {
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ox]');
    if (!btn) return;
    for (const b of box.querySelectorAll('[data-ox]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    playOnce(btn, 'is-picked');
  });
}

bindOx(el.playOx);
bindOx(el.cOx);

/* ---------------- 진행 방식 고르기 ---------------- */

el.modePick.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  composeMode = btn.dataset.mode;
  renderComposeMode();
  playOnce(btn, 'is-picked');
});

el.timePick.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-seconds]');
  if (!btn) return;
  composeTimeLimit = Number(btn.dataset.seconds);
  renderComposeMode();
  playOnce(btn, 'is-picked');
});

/** 고른 방식에 맞춰 버튼 선택 상태 · 제한시간 칩 · 안내문을 맞춘다. */
function renderComposeMode() {
  const game = current?.game;
  const modes = game?.modes ?? [];
  const picked = modes.find((m) => m.key === composeMode) ?? modes[0];
  if (picked) composeMode = picked.key;

  for (const btn of el.modePick.querySelectorAll('[data-mode]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.mode === composeMode));
  }

  // 제한시간 칩은 '제한시간' 방식일 때만 나온다
  const timed = !!picked?.timed;
  setHidden(el.timePick, !timed);
  if (timed) {
    composeTimeLimit ??= game?.defaultTimeLimit ?? null;
    for (const btn of el.timePick.querySelectorAll('[data-seconds]')) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.seconds) === composeTimeLimit));
    }
  }

  const limitLabel = timeLimitLabel();
  el.modeNote.textContent = timed && limitLabel
    ? `${picked.setterNote} 지금 고른 시간은 ${limitLabel}이에요.`
    : picked?.setterNote ?? '';
}

/** 지금 고른 제한시간의 이름표 ("5분"). 제한시간 방식이 아니면 null */
function timeLimitLabel() {
  if (composeMode !== 'timed') return null;
  return (current?.game?.timeLimits ?? []).find((t) => t.seconds === composeTimeLimit)?.label ?? null;
}

/* ---------------- 문제 출제 ---------------- */

el.typePick.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  composeType = btn.dataset.type;
  renderComposeType();
  playOnce(btn, 'is-picked');
});

function renderComposeType() {
  const types = current?.game?.answerTypes ?? [];
  const picked = types.find((t) => t.key === composeType) ?? types[0];
  if (picked) composeType = picked.key;

  for (const btn of el.typePick.querySelectorAll('[data-type]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.type === composeType));
  }
  el.typeNote.textContent = picked?.setterNote ?? '';
  setupAnswerInput({
    type: composeType,
    input: el.cAnswer,
    wrap: el.cAnswerField,
    ox: el.cOx,
    placeholder: picked?.placeholder,
  });
}

el.cPhotoPick.addEventListener('click', () => el.cPhotoFile.click());

el.cPhotoFile.addEventListener('change', async () => {
  const file = el.cPhotoFile.files?.[0];
  el.cPhotoFile.value = '';
  if (!file) return;
  try {
    composePhoto = await shrinkPhoto(file);
    renderComposePhoto();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

el.cPhotoClear.addEventListener('click', () => {
  composePhoto = null;
  renderComposePhoto();
});

function renderComposePhoto() {
  setHtml(el.cPhotoPreview, composePhoto
    ? `<img src="${composePhoto}" alt="" />`
    : '🖼️');
  setHidden(el.cPhotoClear, !composePhoto);
  el.cPhotoPick.textContent = composePhoto ? '다른 사진으로' : '사진 넣기 (선택)';
}

el.cSubmit.addEventListener('click', async () => {
  const question = el.cQuestion.value.trim();
  const answer = composeType === 'ox' ? oxValue(el.cOx) : el.cAnswer.value.trim();
  if (!question) return showToast('문제를 입력해 주세요.', 'error');
  if (!answer) return showToast('정답을 입력해 주세요.', 'error');

  const mode = (current?.game?.modes ?? []).find((m) => m.key === composeMode);
  const limitLabel = timeLimitLabel();
  const hints = [el.cHint1.value, el.cHint2.value, el.cHint3.value];
  const filled = hints.filter((h) => h.trim()).length;

  // 한 번 내면 되돌리기 어려우니, 고른 방식과 정답을 눈으로 한 번 더 짚게 한다
  const ok = await confirmDialog({
    icon: mode?.icon ?? '🧠',
    title: '이대로 문제를 낼까요?',
    message: [
      `${mode?.icon ?? ''} ${mode?.label ?? '자유'}${limitLabel ? ` ${limitLabel}` : ''} · ${
        filled ? `힌트 ${filled}단계` : '힌트 없음'
      }`,
      mode?.setterNote ?? '',
    ].filter(Boolean).join('\n'),
    detail: `정답: ${answer}`,
    confirmText: '문제 내기',
  });
  if (!ok) return;

  return run(el.cSubmit, '출제 중…', async () => {
    const res = await api('/api/quiz', {
      method: 'POST',
      body: {
        answerType: composeType,
        mode: composeMode,
        timeLimit: composeTimeLimit,
        question,
        answer,
        hints,
        photo: composePhoto,
      },
    });
    el.cQuestion.value = '';
    el.cAnswer.value = '';
    el.cHint1.value = '';
    el.cHint2.value = '';
    el.cHint3.value = '';
    composePhoto = null;
    renderComposePhoto();
    showToast(
      res.timeLimitLabel
        ? `문제를 냈어요. ${res.timeLimitLabel} 안에 맞혀야 해요!`
        : '문제를 냈어요. 이제 다들 맞혀 보라고 알려 주세요!',
      'ok',
    );
  });
});

/* ---------------- 정답 제출 · 힌트 · 종료 ---------------- */

el.playSubmit.addEventListener('click', () => {
  const type = current?.quiz?.answerType;
  const answer = type === 'ox' ? oxValue(el.playOx) : el.playAnswer.value.trim();
  if (!answer) return showToast('정답을 입력해 주세요.', 'error');

  return run(el.playSubmit, '제출 중…', async () => {
    const res = await api('/api/quiz/answer', { method: 'POST', body: { answer } });
    el.playAnswer.value = '';
    for (const b of el.playOx.querySelectorAll('[data-ox]')) b.setAttribute('aria-pressed', 'false');

    if (!res.correct) {
      return showToast(
        `아쉬워요, 틀렸어요. (오답 ${res.wrongs}회 · 지금 맞히면 ${res.potentialScore}점)`,
        'error',
      );
    }

    // 선착순 문제는 이 답으로 퀴즈가 끝난다 — 그 사실까지 한 줄에 알려 준다
    const head = res.first ? '정답이에요! 가장 먼저 맞혔어요 🏆' : '정답이에요!';
    showToast(
      res.closed
        ? `${head} +${res.score}점 · 선착순으로 맞혀서 퀴즈가 끝났어요.`
        : `${head} +${res.score}점`,
      'ok',
    );
  });
});

el.playAnswer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.playSubmit.click();
});

el.hintOpen.addEventListener('click', async () => {
  const penalty = current?.me?.nextHintPenalty ?? 0;
  const stage = (current?.me?.hintsUsed ?? 0) + 1;

  const ok = await confirmDialog({
    icon: '💡',
    title: `${stage}단계 힌트를 열까요?`,
    message: '한 번 열면 되돌릴 수 없어요. 힌트는 나에게만 보여요.',
    detail: `얻을 수 있는 점수가 ${penalty}점 깎여요`,
    confirmText: '힌트 열기',
  });
  if (!ok) return;

  return run(el.hintOpen, '여는 중…', async () => {
    const res = await api('/api/quiz/hint', { method: 'POST' });
    showToast(
      `${res.stage}단계 힌트를 열었어요. (−${res.penalty}점 · 지금 맞히면 ${res.potentialScore}점)`,
      'ok',
    );
  });
});

el.closeQuiz.addEventListener('click', async () => {
  const solved = current?.quiz?.solvedCount ?? 0;
  const mode = current?.quiz?.mode ?? 'free';

  const ok = await confirmDialog({
    icon: '🏁',
    title: mode === 'free' ? '퀴즈를 끝낼까요?' : '지금 바로 끝낼까요?',
    message: solved
      ? '정답이 공개되고, 가장 먼저 맞힌 사람이 다음 출제자가 돼요.'
      : '아직 맞힌 사람이 없어요. 지금 끝내면 출제 차례는 나에게 그대로 남아요.',
    detail: solved ? `${solved}명이 맞혔어요` : '',
    confirmText: '끝내기',
  });
  if (!ok) return;

  return run(el.closeQuiz, '끝내는 중…', async () => {
    const res = await api('/api/quiz/close', { method: 'POST' });
    showToast(
      res.winner
        ? `${roundLabel(res.roundNo)} 종료 · 정답 ${res.answer} · 다음 출제자는 ${res.winner.displayName} 님이에요.`
        : `${roundLabel(res.roundNo)} 종료 · 정답 ${res.answer} · 맞힌 사람이 없어 출제 차례가 그대로 남았어요.`,
      'ok',
    );
  });
});

el.dropQuiz.addEventListener('click', async () => {
  const ok = await confirmDialog({
    icon: '🗑️',
    title: '낸 문제를 지울까요?',
    message: '회차로 세지 않고 통째로 사라져요. 지우고 나면 다시 낼 수 있어요.',
    confirmText: '지우기',
    tone: 'danger',
  });
  if (!ok) return;

  return run(el.dropQuiz, '지우는 중…', async () => {
    await api('/api/quiz', { method: 'DELETE' });
    showToast('문제를 지웠어요. 다시 낼 수 있어요.', 'ok');
  });
});

el.passList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-pass]');
  if (!btn) return;

  const ok = await confirmDialog({
    icon: '🔁',
    title: '출제 차례를 넘길까요?',
    message: '넘기고 나면 그 사람이 다음 문제를 내요.',
    detail: `${btn.dataset.name ?? ''} 님에게`,
    confirmText: '넘기기',
  });
  if (!ok) return;

  return run(btn, '넘기는 중…', async () => {
    const res = await api('/api/quiz/turn', {
      method: 'POST',
      body: { userId: Number(btn.dataset.pass) },
    });
    showToast(`${res.turn.displayName} 님에게 출제 차례를 넘겼어요.`, 'ok');
  });
});

/* ---------------- 그리기 ---------------- */

/** 점수 안내 — 서버가 내려 준 배점을 그대로 읽는다 */
function renderRules(game) {
  const penalties = game.hintPenalties
    .map((p, i) => `${i + 1}단계 −${p}점`)
    .join(' · ');

  setHtml(el.rules, [
    `<li><b>+${game.firstScore}점</b> 가장 먼저 맞힌 사람</li>`,
    `<li><b>+${game.nextScore}점</b> 그다음부터 맞힌 사람</li>`,
    `<li><b>−힌트</b> ${escapeHtml(penalties)} (쓴 만큼 더해서 깎여요)</li>`,
    `<li><b>−${game.wrongPenalty}점</b> 오답 한 번마다</li>`,
  ].join(''));

  el.rulesNote.textContent =
    '가장 먼저 정답을 낸 사람이 다음 출제자가 돼요. 점수는 맞히는 순간 확정되고, ' +
    '아무리 깎여도 0점 밑으로는 내려가지 않아요. 퀴즈 점수는 랭킹의 전체 합계에도 들어가요. ' +
    '퀴즈가 언제 끝나는지는 출제자가 고른 진행 방식(자유 · 선착순 · 타임어택)을 따라요.';
}

/** 출제 차례 안내 */
function renderTurn(state) {
  const { turn, quiz } = state;
  setHidden(el.turnBox, false);
  setHtml(el.turnAvatar, turn ? avatarOf(turn) : '🙂');
  el.turnName.textContent = turn?.displayName ?? '출제자 없음';

  if (!turn) {
    el.turnNote.textContent = '운영자가 출제자를 지정하면 시작돼요.';
  } else if (quiz?.status === 'open') {
    el.turnNote.textContent = state.me?.isSetter
      ? '내가 낸 문제가 진행 중이에요.'
      : '이 사람이 낸 문제가 진행 중이에요.';
  } else if (state.isTurnHolder) {
    el.turnNote.textContent = '내 차례예요. 아래에서 문제를 내 주세요.';
  } else {
    el.turnNote.textContent = '이 사람이 다음 문제를 낼 차례예요.';
  }
}

/** 문제 카드 */
function renderQuestion(state) {
  const { quiz } = state;
  setHidden(el.questionBox, !quiz);
  if (!quiz) return;

  el.questionLabel.textContent = quiz.closed
    ? `${roundLabel(quiz.roundNo)} 문제 (끝남)`
    : `${roundLabel(quiz.roundNo)} 문제`;

  setHidden(el.questionPhoto, !quiz.photoUrl);
  if (quiz.photoUrl && el.questionPhoto.getAttribute('src') !== quiz.photoUrl) {
    // 다 받아오기 전에는 빈 칸이 덜컥 나타나므로, 받은 뒤에 부드럽게 띄운다
    el.questionPhoto.classList.remove('is-loaded');
    el.questionPhoto.src = quiz.photoUrl;
  }

  el.questionText.textContent = quiz.question;
  el.questionType.textContent = `${quiz.answerTypeLabel} 정답`;
  el.questionNote.textContent = quiz.closed
    ? `${quiz.solvedCount}명이 맞혔어요`
    : quiz.hintCount
      ? `${quiz.answerTypeNote} 힌트 ${quiz.hintCount}단계`
      : `${quiz.answerTypeNote} 힌트 없음`;

  // 진행 방식 이름표 — 제한시간 문제는 몇 분짜리였는지까지 붙인다
  el.questionMode.textContent = `${quiz.modeIcon} ${quiz.modeLabel}${
    quiz.timeLimitLabel ? ` ${quiz.timeLimitLabel}` : ''
  }`;
  el.questionModeNote.textContent = quiz.closed ? closedReasonNote(quiz) : quiz.modeNote;
}

/** 끝난 퀴즈가 어떻게 끝났는지 한 줄로 */
function closedReasonNote(quiz) {
  if (quiz.closedReason === 'first') return '가장 먼저 맞힌 사람이 나와서 끝났어요.';
  if (quiz.closedReason === 'timeup') {
    return `제한시간 ${quiz.timeLimitLabel ?? ''}이 끝나 자동으로 마감됐어요.`.replace('  ', ' ');
  }
  return '출제자가 끝냈어요.';
}

/* ---------------- 남은 시간 ---------------- */

/** 이만큼 남으면 남은 시간 칸이 빨갛게 바뀐다 */
const SOON_SECONDS = 30;
/** 이만큼 남으면 숫자가 초마다 한 번씩 뛴다 */
const COUNT_SECONDS = 10;

/** 제한시간 문제의 마감 시각 (브라우저 시각 기준). 제한시간이 없으면 null */
let deadlineAt = null;
/** 0초가 됐을 때 서버에 한 번만 다시 물어보기 위한 표시 */
let timeupAsked = false;

/** 90 -> "01:30", 3700 -> "1:01:40" */
function clockText(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * 남은 시간 칸.
 *
 * 서버가 "몇 초 남았는지" 를 재서 내려 주므로, 그 값을 받은 순간을 기준으로
 * 마감 시각을 잡아 두고 1초마다 세어 내린다. 브라우저 시계가 틀어져 있어도
 * 남은 시간은 어긋나지 않는다.
 */
function renderTimer(state) {
  const { quiz } = state;
  const on = !!quiz && !quiz.closed && quiz.mode === 'timed' && quiz.secondsLeft !== null;
  setHidden(el.questionTimer, !on);

  if (!on) {
    deadlineAt = null;
    return;
  }
  deadlineAt = Date.now() + quiz.secondsLeft * 1000;
  timeupAsked = false;
  el.questionTimerLabel.textContent = '남은 시간';
  tickTimer();
}

function tickTimer() {
  if (deadlineAt === null) return;

  const left = Math.max(0, Math.round((deadlineAt - Date.now()) / 1000));
  const text = left ? clockText(left) : '종료';
  // 마지막 10초만 숫자가 초마다 한 번씩 뛴다. 30분짜리 퀴즈 내내 뛰면 방해만 된다.
  if (text !== el.questionTimerValue.textContent) {
    el.questionTimerValue.textContent = text;
    if (left > 0 && left <= COUNT_SECONDS) playOnce(el.questionTimerValue, 'is-ticking');
  }
  el.questionTimer.classList.toggle('quiz-timer--soon', left > 0 && left <= SOON_SECONDS);
  el.questionTimer.classList.toggle('quiz-timer--over', left === 0);

  if (left) return;

  // 마감은 서버가 확정한다. 화면은 0초가 되는 순간 한 번만 다시 물어본다.
  el.questionTimerLabel.textContent = '제한시간';
  if (timeupAsked) return;
  timeupAsked = true;
  load()
    .then(() => showToast('제한시간이 끝났어요. 정답이 공개됐어요!', 'ok'))
    .catch(() => {});
}

setInterval(tickTimer, 1000);

/** 정답 공개 (끝난 뒤) */
function renderAnswer(state) {
  const { quiz, me } = state;
  const show = !!quiz?.closed;
  setHidden(el.answerBox, !show);
  if (!show) return;

  el.answerText.textContent = quiz.answer ?? '—';
  el.answerNote.textContent = me?.solved
    ? `나는 ${me.rank}번째로 맞혀서 +${me.score}점을 받았어요.`
    : me?.isSetter
      ? '내가 낸 문제였어요.'
      : quiz.solvedCount
        ? '이번엔 못 맞혔어요. 다음 문제에 도전해 보세요.'
        : '아무도 맞히지 못했어요.';
}

/** 내 답 카드 */
function renderPlay(state) {
  const { quiz, me } = state;
  // 진행 중인 퀴즈에 참가할 수 있는 사람에게만 보인다 (출제자와 운영자는 제외)
  const on = !!quiz && !quiz.closed && !!me?.isPlayer && !me.isSetter;
  setHidden(el.playBox, !on);
  if (!on) return;

  // 이미 맞힌 사람에게는 입력칸 대신 받은 점수를 보여 준다
  const done = me.solved;
  setHidden(el.playInputWrap, done);
  setHidden(el.playOx, done);
  setHidden(el.playSubmit, done);
  if (done) {
    el.playScore.textContent = `${me.rank}번째로 맞혔어요 · +${me.score}점`;
    el.playScoreNote.textContent = me.rank === 1
      ? '가장 먼저 맞혔어요! 이 퀴즈가 끝나면 다음 출제자가 돼요.'
      : quiz.mode === 'timed'
        ? '제한시간이 끝나면 정답이 공개돼요.'
        : '출제자가 퀴즈를 끝내면 정답이 공개돼요.';
    setHtml(el.playLog, '');
    return;
  }

  setupAnswerInput({
    type: quiz.answerType,
    input: el.playAnswer,
    wrap: el.playInputWrap,
    ox: el.playOx,
  });

  el.playScore.textContent = `지금 맞히면 ${me.potentialScore}점`;

  const parts = [];
  if (quiz.mode === 'first') parts.push('선착순 — 맞히면 이 퀴즈가 바로 끝나요');
  parts.push(me.wouldBeFirst
    ? `아직 아무도 못 맞혔어요 (첫 정답 ${state.game.firstScore}점)`
    : `이미 맞힌 사람이 있어요 (${state.game.nextScore}점)`);
  if (me.hintsUsed) parts.push(`힌트 ${me.hintsUsed}단계 −${hintPenaltyOf(state.game, me.hintsUsed)}점`);
  if (me.wrongs) parts.push(`오답 ${me.wrongs}회 −${me.wrongs * state.game.wrongPenalty}점`);
  el.playScoreNote.textContent = parts.join(' · ');

  // 내가 낸 답은 나에게만 보인다
  const wrong = (me.attemptLog ?? []).filter((a) => !a.correct);
  setHtml(el.playLog, wrong.length
    ? `<div class="attempt-log">${wrong
        .map((a) => `<span class="attempt">${escapeHtml(a.answer)}</span>`)
        .join('')}</div>
       <p class="muted" style="font-size: 13px; margin: 8px 0 0">내가 낸 오답이에요 (나만 보여요).</p>`
    : '');
}

function hintPenaltyOf(game, used) {
  return game.hintPenalties.slice(0, used).reduce((sum, p) => sum + p, 0);
}

/** 힌트 카드 */
function renderHints(state) {
  const { quiz, me } = state;
  // 힌트가 없는 문제이거나, 이미 끝났거나, 출제자면 이 카드는 필요 없다.
  // 맞힌 뒤에도 내가 열어 둔 힌트가 있으면 그대로 남겨 둔다.
  const on =
    !!quiz && !quiz.closed && !me?.isSetter && me?.isPlayer && quiz.hintCount > 0 &&
    (me.canHint || (me.hints ?? []).length > 0);
  setHidden(el.hintBox, !on);
  if (!on) return;

  const opened = me.hints ?? [];
  setHtml(el.hintList, opened.length
    ? opened
        .map(
          (h, i) => `<div class="hint-row">
            <span class="hint-row__seq">${i + 1}단계</span>
            <span>${escapeHtml(h)}</span>
          </div>`,
        )
        .join('')
    : '<p class="muted" style="margin: 0">아직 연 힌트가 없어요.</p>');

  setHidden(el.hintOpen, !me.canHint);
  el.hintOpen.textContent = me.nextHintPenalty
    ? `${me.hintsUsed + 1}단계 힌트 열기 (−${me.nextHintPenalty}점)`
    : '힌트 열기';

  el.hintNote.textContent = me.solved
    ? '이미 정답을 맞혀서 힌트는 그만 봐도 돼요.'
    : me.hintsLeft
      ? `힌트는 나에게만 보여요. ${me.hintsLeft}단계 더 남았어요.`
      : '힌트를 모두 열었어요.';
}

/** 출제자 카드 */
function renderSetter(state) {
  const { quiz, me, players } = state;
  const on = !!quiz && !quiz.closed && !!me?.isSetter;
  setHidden(el.setterBox, !on);
  if (!on) return;

  el.setterAnswer.textContent = quiz.answer ?? '—';
  setHtml(el.setterHints, (quiz.hints ?? []).length
    ? `<div class="card__label" style="margin-top: 16px">내가 넣은 힌트</div>${(quiz.hints ?? [])
        .map(
          (h, i) => `<div class="hint-row">
            <span class="hint-row__seq">${i + 1}단계 −${state.game.hintPenalties[i]}점</span>
            <span>${escapeHtml(h)}</span>
          </div>`,
        )
        .join('')}`
    : '<p class="muted" style="font-size: 13px; margin: 14px 0 0">힌트 없이 낸 문제예요.</p>');

  // 아무도 손대지 않았을 때만 문제를 통째로 지울 수 있다
  const untouched = !players.some((p) => p.attempts > 0 || p.hintsUsed > 0);
  setHidden(el.dropQuiz, !untouched);

  // 선착순·제한시간 문제는 서버가 알아서 끝내므로, 버튼은 '먼저 끝내기' 가 된다
  el.closeQuiz.textContent = quiz.mode === 'free' ? '퀴즈 종료하기' : '지금 바로 끝내기';

  const modeNote = quiz.mode === 'first'
    ? '가장 먼저 맞힌 사람이 나오면 저절로 끝나요.'
    : quiz.mode === 'timed'
      ? `제한시간 ${quiz.timeLimitLabel ?? ''}이 지나면 저절로 끝나요.`.replace('  ', ' ')
      : '';
  const solvedNote = quiz.solvedCount
    ? `${quiz.solvedCount}명이 맞혔어요. 끝내면 가장 먼저 맞힌 사람이 다음 출제자가 돼요.`
    : '아직 맞힌 사람이 없어요. 지금 끝내면 출제 차례가 나에게 그대로 남아요.';
  el.setterNote.textContent = [modeNote, solvedNote].filter(Boolean).join(' ');
}

/** 출제 폼 · 턴 넘기기 */
function renderCompose(state) {
  const on = !!state.canSet;
  setHidden(el.composeBox, !on);
  setHidden(el.passBox, !on);
  if (!on) return;

  // 진행 방식과 제한시간 목록도 서버가 내려 준 그대로 만든다
  const modes = state.game.modes ?? [];
  if (el.modePick.childElementCount !== modes.length) {
    composeMode = state.game.defaultMode ?? composeMode;
    el.modePick.innerHTML = modes
      .map(
        (m) => `<button class="segmented__item" type="button" role="tab" data-mode="${m.key}"
                        aria-selected="false">${m.icon} ${escapeHtml(m.label)}</button>`,
      )
      .join('');
  }

  const limits = state.game.timeLimits ?? [];
  if (el.timePick.childElementCount !== limits.length) {
    composeTimeLimit ??= state.game.defaultTimeLimit ?? null;
    el.timePick.innerHTML = limits
      .map(
        (t) => `<button class="chip" type="button" data-seconds="${t.seconds}"
                        aria-pressed="false">${escapeHtml(t.label)}</button>`,
      )
      .join('');
  }
  renderComposeMode();

  // 정답 종류 고르는 줄은 서버가 내려 준 목록대로 만든다
  const types = state.game.answerTypes ?? [];
  if (el.typePick.childElementCount !== types.length) {
    el.typePick.innerHTML = types
      .map(
        (t) => `<button class="segmented__item" type="button" role="tab" data-type="${t.key}"
                        aria-selected="false">${t.icon} ${escapeHtml(t.label)}</button>`,
      )
      .join('');
  }
  renderComposeType();
  renderComposePhoto();

  el.cQuestion.maxLength = state.game.questionMax;
  el.cAnswer.maxLength = state.game.answerMax;
  for (const key of ['cHint1', 'cHint2', 'cHint3']) el[key].maxLength = state.game.hintMax;
  for (const [i, key] of ['cHint1Label', 'cHint2Label', 'cHint3Label'].entries()) {
    el[key].textContent = `${i + 1}단계 힌트 (−${state.game.hintPenalties[i]}점)`;
  }
  el.cHintNote.textContent =
    '비워 두면 그 단계는 없어요. 플레이어가 힌트를 열면 1단계부터 차례로, 그 사람에게만 보여요.';

  // 턴 넘기기 목록 — 나를 뺀 플레이어 전원
  const others = state.players.filter((p) => !p.isMe);
  setHtml(el.passList, others.length
    ? others
        .map(
          (p) => `<div class="player">
            <div class="player__avatar" aria-hidden="true">${avatarOf(p)}</div>
            <div class="player__body">
              <div class="player__name">${escapeHtml(p.displayName)}</div>
              <div class="player__meta">퀴즈 누적 ${p.totalScore}점 · 처음 맞힌 ${p.totalFirsts}회</div>
            </div>
            <button class="chip" type="button" data-pass="${p.id}"
                    data-name="${escapeHtml(p.displayName)}">넘기기</button>
          </div>`,
        )
        .join('')
    : '<p class="muted center" style="margin: 0">넘길 사람이 없어요.</p>');
}

/** 참가자 목록 */
function renderPlayers(state) {
  const { quiz } = state;
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };

  el.playersLabel.textContent = quiz?.closed ? '결과' : '참가자';
  setHtml(el.players, state.players.length
    ? state.players
        .map((p) => {
          const winner = p.rank === 1;
          const tags =
            (p.isMe ? '<span class="tag tag--me">나</span>' : '') +
            (winner ? '<span class="tag tag--win">가장 먼저 🏆</span>' : '');

          let meta;
          if (p.solved) {
            const used = [];
            if (p.hintsUsed) used.push(`힌트 ${p.hintsUsed}단계`);
            if (p.wrongs) used.push(`오답 ${p.wrongs}회`);
            meta = `${p.rank}번째로 맞힘${used.length ? ` · ${used.join(' · ')}` : ''}`;
          } else if (!quiz) {
            meta = '아직 기록이 없어요';
          } else if (quiz.closed) {
            meta = p.attempts || p.hintsUsed ? '못 맞혔어요' : '도전하지 않았어요';
          } else {
            const doing = [];
            if (p.hintsUsed) doing.push(`힌트 ${p.hintsUsed}단계`);
            if (p.wrongs) doing.push(`오답 ${p.wrongs}회`);
            meta = doing.length ? `도전 중 · ${doing.join(' · ')}` : '아직 도전 전';
          }

          const value = p.solved
            ? `<b class="quiz-point">+${p.score}</b>`
            : quiz && !quiz.closed
              ? '<span class="muted">···</span>'
              : '<span class="muted">—</span>';

          return `<div class="player${winner ? ' player--winner' : ''}">
            <div class="player__avatar" aria-hidden="true">${avatarOf(p)}</div>
            <div class="player__body">
              <div class="player__name">${escapeHtml(p.displayName)}${tags}</div>
              <div class="player__meta">${escapeHtml(meta)} · 퀴즈 누적 ${p.totalScore}점</div>
            </div>
            <div class="player__value">${p.solved ? `${medal[p.rank] ?? ''} ` : ''}${value}</div>
          </div>`;
        })
        .join('')
    : '<p class="muted center">참가할 사람이 없어요.</p>');
}

async function load() {
  const state = await api('/api/quiz');
  current = state;
  const { quiz, me } = state;

  // 진행 중인 퀴즈가 있으면 그 회차를, 없으면 다음에 낼 회차를 배지에 쓴다
  const running = !!quiz && !quiz.closed;
  el.roundBadge.textContent = roundLabel(running ? state.roundNo : state.nextRoundNo);
  el.roundNote.textContent = running
    ? `진행 중 · ${quiz.modeLabel}${quiz.timeLimitLabel ? ` ${quiz.timeLimitLabel}` : ''}`
    : quiz ? '다음 문제 준비 중' : '첫 문제를 기다리는 중';

  if (!state.turn && !quiz) {
    el.subtitle.textContent = '운영자가 출제자를 지정하면 시작돼요';
  } else if (quiz && !quiz.closed) {
    setHtml(el.subtitle, `${personChip(quiz.setter)} 님의 문제 · ${quiz.modeIcon} ${
      escapeHtml(quiz.modeLabel)
    } · ${quiz.solvedCount}명이 맞혔어요`);
  } else if (state.isTurnHolder) {
    el.subtitle.textContent = '내가 다음 문제를 낼 차례예요';
  } else {
    setHtml(el.subtitle, `${personChip(state.turn)} 님이 다음 문제를 준비 중`);
  }

  renderTurn(state);
  renderQuestion(state);
  renderTimer(state);
  renderAnswer(state);
  renderPlay(state);
  renderHints(state);
  renderSetter(state);
  renderCompose(state);
  renderPlayers(state);
  renderRules(state.game);

  // 운영자는 구경만 한다
  if (user.role === 'admin' && !state.canSet) {
    setHidden(el.playBox, true);
    setHidden(el.hintBox, true);
  }
}

try {
  await load();
  // 첫 화면만 위 칸부터 차례로 올라온다 (그 뒤의 등장은 setHidden 이 맡는다)
  revealChildren(document.querySelector('[data-app]'));
} catch (err) {
  showToast(`불러오지 못했습니다: ${err.message}`, 'error');
  el.subtitle.textContent = '연결을 확인해 주세요';
  setHtml(el.players, '<p class="muted center">잠시 후 다시 시도합니다.</p>');
}

// 남이 맞혔는지, 다음 문제가 나왔는지 주기적으로 확인한다.
// 입력 중일 때는 화면을 갈아 끼우지 않는다 (쓰던 답이 날아가면 안 된다).
function busyTyping() {
  const active = document.activeElement;
  return !!active && ['INPUT', 'TEXTAREA'].includes(active.tagName);
}

setInterval(() => {
  if (!document.hidden && !busyTyping()) load().catch(() => {});
}, 15000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !busyTyping()) load().catch(() => {});
});
