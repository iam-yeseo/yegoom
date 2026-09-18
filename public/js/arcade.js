// Presentation only: game permissions, deadlines and scoring stay in the API.
import { escapeHtml } from './common.js';

const GAMES = {
  morning: ['morning', 'WAKE UP!', '몇 시에\n일어났을까?'],
  evening: ['evening', 'CLOCK OUT!', '칼퇴? 야근?\n맞혀 봐!'],
  quiz: ['quiz', 'QUIZ TIME', '정답을\n눌러 줘!'],
  catchmind: ['mind', 'READ MY MIND', '너의 생각이\n들려!'],
  numberluck: ['number', 'LUCKY NUMBER', '큰 숫자?\n안 겹치게!'],
};

export function illustration(key, className = '') {
  return `<img class="arcade-art ${className}" src="/assets/arcade/${key}.webp" alt="" width="320" height="240" decoding="async" />`;
}

export function gameHero(key, { subtitle = '', dynamic = false } = {}) {
  const [asset, kicker, title] = GAMES[key];
  return `<section class="game-hero" aria-label="${escapeHtml(kicker)}">
    <div class="game-hero__copy"><p class="game-hero__kicker"${dynamic ? ' id="title-text"' : ''}>${kicker}${subtitle ? ' / ' + escapeHtml(subtitle) : ''}</p>
    <h1 class="game-hero__title">${title.replace('\n', '<br />')}</h1></div>
    ${illustration(asset, 'game-hero__art')}
  </section>`;
}

export function stateArt(key, title, description = '') {
  return `<div class="arcade-state">${illustration(key)}<div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div></div>`;
}

export function scoreCard(score, details = [], { loss = false, title = 'MY RESULT' } = {}) {
  return `<div class="arcade-result"><div class="card__label">${escapeHtml(title)}</div>
    <div class="arcade-result__hero"><div><strong>+${escapeHtml(score)}<small>점</small></strong><p>이번 판 획득 점수</p></div>${illustration(loss ? 'loss' : 'success')}</div>
    <dl>${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></div>`;
}

export function gameSteps(saved, ready, noun = '답변 작성') {
  return `<ol class="game-steps" aria-label="참여 단계"><li class="${saved ? 'is-complete' : 'is-current'}">${saved ? '✓ 저장 완료' : '1 ' + noun}</li><li class="${ready ? 'is-complete' : saved ? 'is-current' : ''}">${ready ? '✓ 준비 완료' : '2 준비 완료'}</li></ol>`;
}
