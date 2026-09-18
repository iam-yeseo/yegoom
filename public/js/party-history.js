import { escapeHtml,personChip } from './common.js';
import { stateArt } from './arcade.js';
export function renderPartyHistory(history,game) {
  if (!history.length) return stateArt('empty','첫 기록의 주인공은?','한 판을 마치면 기록이 여기에 쌓여요.');
  return history.map(h=>`<div class="history-item"><b>${h.roundNo}회차</b>
    ${game==='catchmind' ? `<p class="party-question">${escapeHtml(h.question)}</p>` : ''}
    ${h.entries.map(p=>`<p>${personChip(p)} · ${game==='catchmind'
      ? `${escapeHtml(p.answer)} · 맞힌 사람 ${p.correctCount}명`
      : `${p.number} · ${p.place ? `${p.place}등` : '중복 탈락'} · ${p.score}점`}</p>`).join('')}</div>`).join('');
}
