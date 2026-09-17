import { escapeHtml,personChip } from './common.js';
export function renderPartyHistory(history,game) {
  if (!history.length) return '<p class="muted">아직 끝난 회차가 없어요.</p>';
  return history.map(h=>`<div class="history-item"><b>${h.roundNo}회차</b>
    ${game==='catchmind' ? `<p class="party-question">${escapeHtml(h.question)}</p>` : ''}
    ${h.entries.map(p=>`<p>${personChip(p)} · ${game==='catchmind'
      ? `${escapeHtml(p.answer)} · 맞힌 사람 ${p.correctCount}명`
      : `${p.number} · ${p.place ? `${p.place}등` : '중복 탈락'} · ${p.score}점`}</p>`).join('')}</div>`).join('');
}
