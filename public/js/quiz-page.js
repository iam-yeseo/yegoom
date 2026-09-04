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

import {
  QUIZ, api, avatarOf, escapeHtml, personChip, renderTabbar, requireLogin, roundLabel,
  showMessage, startClock,
} from '/js/common.js';
import { shrinkPhoto } from '/js/photo-picker.js';

document.title = QUIZ.label;

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

  <p id="msg" class="msg hidden" role="status"></p>

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
    <img id="question-photo" class="quiz-photo hidden" alt="문제에 붙은 사진" />
    <p class="quiz-question" id="question-text"></p>
    <div class="quiz-meta">
      <span class="tag" id="question-type"></span>
      <span class="muted" id="question-note"></span>
    </div>
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
    'round-badge', 'round-note', 'subtitle', 'msg',
    'turn-box', 'turn-avatar', 'turn-name', 'turn-note',
    'question-box', 'question-label', 'question-photo', 'question-text', 'question-type',
    'question-note',
    'answer-box', 'answer-text', 'answer-note',
    'play-box', 'play-score', 'play-score-note', 'play-input-wrap', 'play-answer', 'play-ox',
    'play-submit', 'play-log',
    'hint-box', 'hint-list', 'hint-open', 'hint-note',
    'setter-box', 'setter-answer', 'setter-hints', 'close-quiz', 'drop-quiz', 'setter-note',
    'compose-box', 'type-pick', 'type-note', 'c-question', 'c-photo-preview', 'c-photo-pick',
    'c-photo-clear', 'c-photo-file', 'c-answer-field', 'c-answer', 'c-ox', 'c-hint-note',
    'c-hint1-label', 'c-hint2-label', 'c-hint3-label', 'c-hint1', 'c-hint2', 'c-hint3', 'c-submit',
    'pass-box', 'pass-list',
    'players', 'players-label', 'rules', 'rules-note',
  ].map((id) => [id.replace(/-(.)/g, (_, c) => c.toUpperCase()), document.getElementById(id)]),
);

startClock();
const user = await requireLogin();
renderTabbar(user);

/** 마지막으로 받아 온 상태 */
let current = null;
/** 출제 폼에서 고른 정답 종류 · 사진 (화면을 다시 그려도 유지된다) */
let composeType = 'text';
let composePhoto = null;

/** 버튼을 잠그고 일을 시킨 뒤, 끝나면 화면을 새로 그린다. */
async function run(button, busyText, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  showMessage(el.msg, '');
  try {
    await work();
    await load();
  } catch (err) {
    showMessage(el.msg, err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------------- 정답 입력칸 ---------------- */

/** OX 문제는 버튼 두 개로, 나머지는 입력칸으로 받는다. */
function setupAnswerInput({ type, input, wrap, ox, placeholder }) {
  const isOx = type === 'ox';
  wrap.classList.toggle('hidden', isOx);
  ox.classList.toggle('hidden', !isOx);
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
  });
}

bindOx(el.playOx);
bindOx(el.cOx);

/* ---------------- 문제 출제 ---------------- */

el.typePick.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  composeType = btn.dataset.type;
  renderComposeType();
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
  showMessage(el.msg, '');
  try {
    composePhoto = await shrinkPhoto(file);
    renderComposePhoto();
  } catch (err) {
    showMessage(el.msg, err.message);
  }
});

el.cPhotoClear.addEventListener('click', () => {
  composePhoto = null;
  renderComposePhoto();
});

function renderComposePhoto() {
  el.cPhotoPreview.innerHTML = composePhoto
    ? `<img src="${composePhoto}" alt="" />`
    : '🖼️';
  el.cPhotoClear.classList.toggle('hidden', !composePhoto);
  el.cPhotoPick.textContent = composePhoto ? '다른 사진으로' : '사진 넣기 (선택)';
}

el.cSubmit.addEventListener('click', () => {
  const question = el.cQuestion.value.trim();
  const answer = composeType === 'ox' ? oxValue(el.cOx) : el.cAnswer.value.trim();
  if (!question) return showMessage(el.msg, '문제를 입력해 주세요.');
  if (!answer) return showMessage(el.msg, '정답을 입력해 주세요.');

  const hints = [el.cHint1.value, el.cHint2.value, el.cHint3.value];
  const filled = hints.filter((h) => h.trim()).length;
  const ask = filled
    ? `문제를 출제할까요? 힌트는 ${filled}개예요.`
    : '힌트 없이 문제를 출제할까요?';
  if (!confirm(`${ask}\n\n정답: ${answer}`)) return;

  return run(el.cSubmit, '출제 중…', async () => {
    await api('/api/quiz', {
      method: 'POST',
      body: { answerType: composeType, question, answer, hints, photo: composePhoto },
    });
    el.cQuestion.value = '';
    el.cAnswer.value = '';
    el.cHint1.value = '';
    el.cHint2.value = '';
    el.cHint3.value = '';
    composePhoto = null;
    renderComposePhoto();
    showMessage(el.msg, '문제를 냈어요. 이제 다들 맞혀 보라고 알려 주세요!', 'ok');
  });
});

/* ---------------- 정답 제출 · 힌트 · 종료 ---------------- */

el.playSubmit.addEventListener('click', () => {
  const type = current?.quiz?.answerType;
  const answer = type === 'ox' ? oxValue(el.playOx) : el.playAnswer.value.trim();
  if (!answer) return showMessage(el.msg, '정답을 입력해 주세요.');

  return run(el.playSubmit, '제출 중…', async () => {
    const res = await api('/api/quiz/answer', { method: 'POST', body: { answer } });
    el.playAnswer.value = '';
    for (const b of el.playOx.querySelectorAll('[data-ox]')) b.setAttribute('aria-pressed', 'false');
    showMessage(
      el.msg,
      res.correct
        ? `정답이에요! ${res.first ? '가장 먼저 맞혔어요 🏆 · ' : ''}+${res.score}점`
        : `아쉬워요, 틀렸어요. (오답 ${res.wrongs}회 · 지금 맞히면 ${res.potentialScore}점)`,
      res.correct ? 'ok' : 'error',
    );
  });
});

el.playAnswer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.playSubmit.click();
});

el.hintOpen.addEventListener('click', () => {
  const penalty = current?.me?.nextHintPenalty ?? 0;
  const stage = (current?.me?.hintsUsed ?? 0) + 1;
  if (!confirm(`${stage}단계 힌트를 열까요? 얻을 수 있는 점수가 ${penalty}점 깎여요.`)) return;

  return run(el.hintOpen, '여는 중…', async () => {
    const res = await api('/api/quiz/hint', { method: 'POST' });
    showMessage(
      el.msg,
      `${res.stage}단계 힌트를 열었어요. (-${res.penalty}점 · 지금 맞히면 ${res.potentialScore}점)`,
      'ok',
    );
  });
});

el.closeQuiz.addEventListener('click', () => {
  const solved = current?.quiz?.solvedCount ?? 0;
  const ask = solved
    ? '퀴즈를 끝낼까요? 정답이 공개되고, 가장 먼저 맞힌 사람이 다음 출제자가 돼요.'
    : '아직 맞힌 사람이 없어요. 그래도 끝낼까요? 출제 차례는 나에게 그대로 남아요.';
  if (!confirm(ask)) return;

  return run(el.closeQuiz, '끝내는 중…', async () => {
    const res = await api('/api/quiz/close', { method: 'POST' });
    showMessage(
      el.msg,
      res.winner
        ? `${roundLabel(res.roundNo)} 종료 · 정답 ${res.answer} · 다음 출제자는 ${res.winner.displayName} 님이에요.`
        : `${roundLabel(res.roundNo)} 종료 · 정답 ${res.answer} · 맞힌 사람이 없어 출제 차례가 그대로 남았어요.`,
      'ok',
    );
  });
});

el.dropQuiz.addEventListener('click', () => {
  if (!confirm('낸 문제를 지울까요? 회차로 세지 않고 통째로 사라져요.')) return;
  return run(el.dropQuiz, '지우는 중…', async () => {
    await api('/api/quiz', { method: 'DELETE' });
    showMessage(el.msg, '문제를 지웠어요. 다시 낼 수 있어요.', 'ok');
  });
});

el.passList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pass]');
  if (!btn) return;
  const name = btn.dataset.name ?? '';
  if (!confirm(`${name} 님에게 출제 차례를 넘길까요?`)) return;

  return run(btn, '넘기는 중…', async () => {
    const res = await api('/api/quiz/turn', {
      method: 'POST',
      body: { userId: Number(btn.dataset.pass) },
    });
    showMessage(el.msg, `${res.turn.displayName} 님에게 출제 차례를 넘겼어요.`, 'ok');
  });
});

/* ---------------- 그리기 ---------------- */

/** 점수 안내 — 서버가 내려 준 배점을 그대로 읽는다 */
function renderRules(game) {
  const penalties = game.hintPenalties
    .map((p, i) => `${i + 1}단계 −${p}점`)
    .join(' · ');

  el.rules.innerHTML = [
    `<li><b>+${game.firstScore}점</b> 가장 먼저 맞힌 사람</li>`,
    `<li><b>+${game.nextScore}점</b> 그다음부터 맞힌 사람</li>`,
    `<li><b>−힌트</b> ${escapeHtml(penalties)} (쓴 만큼 더해서 깎여요)</li>`,
    `<li><b>−${game.wrongPenalty}점</b> 오답 한 번마다</li>`,
  ].join('');

  el.rulesNote.textContent =
    '가장 먼저 정답을 낸 사람이 다음 출제자가 돼요. 점수는 맞히는 순간 확정되고, ' +
    '아무리 깎여도 0점 밑으로는 내려가지 않아요. 퀴즈 점수는 랭킹의 전체 합계에도 들어가요.';
}

/** 출제 차례 안내 */
function renderTurn(state) {
  const { turn, quiz } = state;
  el.turnBox.classList.remove('hidden');
  el.turnAvatar.innerHTML = turn ? avatarOf(turn) : '🙂';
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
  el.questionBox.classList.toggle('hidden', !quiz);
  if (!quiz) return;

  el.questionLabel.textContent = quiz.closed
    ? `${roundLabel(quiz.roundNo)} 문제 (끝남)`
    : `${roundLabel(quiz.roundNo)} 문제`;

  el.questionPhoto.classList.toggle('hidden', !quiz.photoUrl);
  if (quiz.photoUrl && el.questionPhoto.getAttribute('src') !== quiz.photoUrl) {
    el.questionPhoto.src = quiz.photoUrl;
  }

  el.questionText.textContent = quiz.question;
  el.questionType.textContent = `${quiz.answerTypeLabel} 정답`;
  el.questionNote.textContent = quiz.closed
    ? `${quiz.solvedCount}명이 맞혔어요`
    : quiz.hintCount
      ? `${quiz.answerTypeNote} 힌트 ${quiz.hintCount}단계`
      : `${quiz.answerTypeNote} 힌트 없음`;
}

/** 정답 공개 (끝난 뒤) */
function renderAnswer(state) {
  const { quiz, me } = state;
  const show = !!quiz?.closed;
  el.answerBox.classList.toggle('hidden', !show);
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
  el.playBox.classList.toggle('hidden', !on);
  if (!on) return;

  // 이미 맞힌 사람에게는 입력칸 대신 받은 점수를 보여 준다
  const done = me.solved;
  el.playInputWrap.classList.toggle('hidden', done);
  el.playOx.classList.toggle('hidden', done);
  el.playSubmit.classList.toggle('hidden', done);
  if (done) {
    el.playScore.textContent = `${me.rank}번째로 맞혔어요 · +${me.score}점`;
    el.playScoreNote.textContent = me.rank === 1
      ? '가장 먼저 맞혔어요! 이 퀴즈가 끝나면 다음 출제자가 돼요.'
      : '출제자가 퀴즈를 끝내면 정답이 공개돼요.';
    el.playLog.innerHTML = '';
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
  parts.push(me.wouldBeFirst
    ? `아직 아무도 못 맞혔어요 (첫 정답 ${state.game.firstScore}점)`
    : `이미 맞힌 사람이 있어요 (${state.game.nextScore}점)`);
  if (me.hintsUsed) parts.push(`힌트 ${me.hintsUsed}단계 −${hintPenaltyOf(state.game, me.hintsUsed)}점`);
  if (me.wrongs) parts.push(`오답 ${me.wrongs}회 −${me.wrongs * state.game.wrongPenalty}점`);
  el.playScoreNote.textContent = parts.join(' · ');

  // 내가 낸 답은 나에게만 보인다
  const wrong = (me.attemptLog ?? []).filter((a) => !a.correct);
  el.playLog.innerHTML = wrong.length
    ? `<div class="attempt-log">${wrong
        .map((a) => `<span class="attempt">${escapeHtml(a.answer)}</span>`)
        .join('')}</div>
       <p class="muted" style="font-size: 13px; margin: 8px 0 0">내가 낸 오답이에요 (나만 보여요).</p>`
    : '';
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
  el.hintBox.classList.toggle('hidden', !on);
  if (!on) return;

  const opened = me.hints ?? [];
  el.hintList.innerHTML = opened.length
    ? opened
        .map(
          (h, i) => `<div class="hint-row">
            <span class="hint-row__seq">${i + 1}단계</span>
            <span>${escapeHtml(h)}</span>
          </div>`,
        )
        .join('')
    : '<p class="muted" style="margin: 0">아직 연 힌트가 없어요.</p>';

  el.hintOpen.classList.toggle('hidden', !me.canHint);
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
  el.setterBox.classList.toggle('hidden', !on);
  if (!on) return;

  el.setterAnswer.textContent = quiz.answer ?? '—';
  el.setterHints.innerHTML = (quiz.hints ?? []).length
    ? `<div class="card__label" style="margin-top: 16px">내가 넣은 힌트</div>${(quiz.hints ?? [])
        .map(
          (h, i) => `<div class="hint-row">
            <span class="hint-row__seq">${i + 1}단계 −${state.game.hintPenalties[i]}점</span>
            <span>${escapeHtml(h)}</span>
          </div>`,
        )
        .join('')}`
    : '<p class="muted" style="font-size: 13px; margin: 14px 0 0">힌트 없이 낸 문제예요.</p>';

  // 아무도 손대지 않았을 때만 문제를 통째로 지울 수 있다
  const untouched = !players.some((p) => p.attempts > 0 || p.hintsUsed > 0);
  el.dropQuiz.classList.toggle('hidden', !untouched);

  el.setterNote.textContent = quiz.solvedCount
    ? `${quiz.solvedCount}명이 맞혔어요. 끝내면 가장 먼저 맞힌 사람이 다음 출제자가 돼요.`
    : '아직 맞힌 사람이 없어요. 지금 끝내면 출제 차례가 나에게 그대로 남아요.';
}

/** 출제 폼 · 턴 넘기기 */
function renderCompose(state) {
  const on = !!state.canSet;
  el.composeBox.classList.toggle('hidden', !on);
  el.passBox.classList.toggle('hidden', !on);
  if (!on) return;

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
  el.passList.innerHTML = others.length
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
    : '<p class="muted center" style="margin: 0">넘길 사람이 없어요.</p>';
}

/** 참가자 목록 */
function renderPlayers(state) {
  const { quiz } = state;
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };

  el.playersLabel.textContent = quiz?.closed ? '결과' : '참가자';
  el.players.innerHTML = state.players.length
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
    : '<p class="muted center">참가할 사람이 없어요.</p>';
}

async function load() {
  const state = await api('/api/quiz');
  current = state;
  const { quiz, me } = state;

  // 진행 중인 퀴즈가 있으면 그 회차를, 없으면 다음에 낼 회차를 배지에 쓴다
  const running = !!quiz && !quiz.closed;
  el.roundBadge.textContent = roundLabel(running ? state.roundNo : state.nextRoundNo);
  el.roundNote.textContent = running
    ? '진행 중'
    : quiz ? '다음 문제 준비 중' : '첫 문제를 기다리는 중';

  if (!state.turn && !quiz) {
    el.subtitle.textContent = '운영자가 출제자를 지정하면 시작돼요';
  } else if (quiz && !quiz.closed) {
    el.subtitle.innerHTML = `${personChip(quiz.setter)} 님의 문제 · ${quiz.solvedCount}명이 맞혔어요`;
  } else if (state.isTurnHolder) {
    el.subtitle.textContent = '내가 다음 문제를 낼 차례예요';
  } else {
    el.subtitle.innerHTML = `${personChip(state.turn)} 님이 다음 문제를 준비 중`;
  }

  renderTurn(state);
  renderQuestion(state);
  renderAnswer(state);
  renderPlay(state);
  renderHints(state);
  renderSetter(state);
  renderCompose(state);
  renderPlayers(state);
  renderRules(state.game);

  // 운영자는 구경만 한다
  if (user.role === 'admin' && !state.canSet) {
    el.playBox.classList.add('hidden');
    el.hintBox.classList.add('hidden');
  }
}

try {
  await load();
} catch (err) {
  showMessage(el.msg, `불러오지 못했습니다: ${err.message}`);
  el.subtitle.textContent = '연결을 확인해 주세요';
  el.players.innerHTML = '<p class="muted center">잠시 후 다시 시도합니다.</p>';
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
