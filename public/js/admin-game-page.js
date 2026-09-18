import {
  GAMES, QUIZ, api, escapeHtml, pageTitle, personChip, renderGnb, renderTabbar,
  setHtml, refreshGnb,
} from './common.js';
import { confirmDialog, showToast } from './ui.js';
import { gameCard, quizCard } from './admin-game-cards.js';
import { renderPartyHistory } from './party-history.js';

const PARTY = {
  catchmind: { label: '독심술사', icon: '🔮' },
  numberluck: { label: '숫자 고르기', icon: '🃏' },
};

export async function mountAdminGame(user, key) {
  if (user.role !== 'admin') return;
  const game = GAMES[key] ?? (key === 'quiz' ? QUIZ : PARTY[key]);
  const app = document.querySelector('.app');
  const isParty = !!PARTY[key];
  document.title = pageTitle(`${game.label} 운영`);
  app.innerHTML = `
    <header class="gnb" data-gnb aria-label="내 프로필과 점수"></header>
    <h1 class="page-title admin-title"><img src="/assets/arcade/icon-${key==='catchmind'?'mind':key==='numberluck'?'number':key}.svg" width="28" height="28" alt="" /> ${escapeHtml(game.label)} 운영
      <span>운영자 전용 · ${key === 'catchmind' ? '질문 관리와 회차 현황' : '게임 현황과 설정'}</span></h1>
    ${key === 'catchmind' ? '<section class="card" id="question-admin"></section>' : ''}
    ${!isParty ? '<section class="card" id="game-settings"><p class="muted">설정을 불러오는 중…</p></section>' : ''}
    ${key === 'catchmind' ? '<details class="admin-details"><summary>현재 회차 현황</summary>' : ''}
      <div id="admin-state"><section class="card"><p class="muted">현황을 불러오는 중…</p></section></div>
    ${key === 'catchmind' ? '</details>' : ''}
    ${isParty ? '<details class="admin-details" id="admin-history"><summary>지난 회차 보기</summary><section class="card" id="admin-history-list"></section></details>' : ''}
    <p class="muted admin-note">운영자는 게임에 참여할 수 없어요. 공개 전 답변은 운영자에게도 보이지 않아요.</p>
    <a class="admin-setup-link" href="/setup">공통 설정 · 스키마 업데이트</a>`;
  renderGnb(user);
  renderTabbar(user);
  if (key === 'catchmind') {
    const { mountQuestionAdmin } = await import('./question-admin.js');
    await mountQuestionAdmin(document.getElementById('question-admin'));
  }
  const stateEl = document.getElementById('admin-state');
  let busy = false, loading = false;

  async function loadState() {
    if (loading || busy) return;
    loading = true;
    try {
      const state = await api(isParty ? `/api/party?game=${key}` : key === 'quiz' ? '/api/quiz' : `/api/today?game=${key}`);
      setHtml(stateEl, isParty ? partyCard(state) : key === 'quiz' ? quizCard(state) : gameCard(state));
    } catch (err) {
      setHtml(stateEl, `<section class="card"><p>${escapeHtml(err.message)}</p><button class="btn btn--ghost" data-retry>다시 불러오기</button></section>`);
    } finally { loading = false; }
  }

  async function loadSettings() {
    const el = document.getElementById('game-settings');
    if (!el) return;
    const data = await api('/api/admin/setter');
    const current = data.setters[key];
    const config = key === 'evening' ? await api('/api/admin/config') : null;
    setHtml(el, `<h2 class="card__label">${key === 'quiz' ? '다음 출제자' : '출제자'} 설정</h2>
      <p>현재: ${current ? personChip(current) : '아직 지정하지 않았어요'}</p>
      <form data-setter-form>
        <label class="field"><span>${escapeHtml(game.label)} 출제자</span>
          <select name="userId" required><option value="" disabled ${current ? '' : 'selected'}>플레이어 선택</option>
            ${data.candidates.map(p => `<option value="${p.id}" ${p.id === current?.id ? 'selected' : ''}>${escapeHtml(p.displayName)}</option>`).join('')}
          </select></label>
        <button class="btn btn--ghost" type="submit">출제자 저장</button>
      </form>
      ${config ? `<form data-chances-form class="admin-chances">
        <label class="field"><span>오후 게임 기회 횟수</span><select name="chances">
          ${Array.from({ length: config.maxChances + 1 }, (_, n) => `<option value="${n}" ${n === config.games.find(g => g.key === key)?.chances ? 'selected' : ''}>${n}번</option>`).join('')}
        </select></label><button class="btn btn--ghost" type="submit">기회 횟수 저장</button>
        <p class="muted">다음 라운드부터 적용돼요. 진행 중인 회차는 기존 횟수를 유지해요.</p></form>` : ''}`);
  }

  app.addEventListener('submit', async e => {
    const setter = e.target.matches('[data-setter-form]');
    const chances = e.target.matches('[data-chances-form]');
    if (!setter && !chances) return;
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.target);
    const body = setter ? { game: key, userId: Number(form.get('userId')) } : { game: key, chances: Number(form.get('chances')) };
    busy = true;
    const button = e.submitter;
    try {
      if (setter && !await confirmDialog({ title: '출제자를 변경할까요?', message: `${game.label}의 ${key === 'quiz' ? '다음 출제 차례를' : '출제자를'} 변경해요.`, confirmText: '변경하기' })) return;
      button.disabled = true;
      await api(setter ? '/api/admin/setter' : '/api/admin/config', { method: 'POST', body });
      await loadSettings();
      showToast('설정을 저장했어요.', 'ok');
    } catch (err) { showToast(err.message, 'error'); }
    finally { busy = false; button.disabled = false; await loadState(); }
  });

  stateEl.addEventListener('click', async e => {
    if (e.target.closest('[data-retry]')) { await loadState(); return; }
    const button = e.target.closest('[data-cancel]');
    if (!button || busy) return;
    busy = true;
    try {
      if (!await confirmDialog({ icon: '↩️', title: '정답 공개를 취소할까요?', message: '점수를 되돌리고 예측과 기록해 둔 정답은 유지해요.', detail: game.label, confirmText: '공개 취소', tone: 'danger' })) return;
      button.disabled = true;
      await api(`/api/admin/round?game=${key}`, { method: 'DELETE' });
      await refreshGnb();
      showToast('정답 공개를 취소했어요.', 'ok');
    } catch (err) { showToast(err.message, 'error'); }
    finally { busy = false; button.disabled = false; await loadState(); }
  });
  document.getElementById('admin-history')?.addEventListener('toggle', async e => {
    if (!e.target.open) return;
    const target = document.getElementById('admin-history-list');
    try {
      const { history } = await api(`/api/party/history?game=${key}`);
      setHtml(target, renderPartyHistory(history, key));
    } catch (err) { target.textContent = err.message; }
  });
  await Promise.all([loadState(), loadSettings().catch(err => {
    const el = document.getElementById('game-settings');
    setHtml(el, `<p>${escapeHtml(err.message)}</p><a href="/setup">설정 페이지에서 다시 확인하기</a>`);
  })]);
  setInterval(() => { if (!document.hidden) loadState(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadState(); });
}

function partyCard(state) {
  const r = state.round;
  const phase = !r ? '시작 대기' : r.state === 'closed' ? '결과 공개' : r.state === 'guessing' ? '작성자 추측 중' : '답변 준비 중';
  const deadline = r?.state === 'answering' && r.deadline
    ? `<p class="muted">공개 예정 ${escapeHtml(new Date(r.deadline).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }))} (한국 시간)</p>` : '';
  return `<section class="card"><h2 class="card__label">회차 현황</h2>
    <p><b>${r ? `${r.roundNo}회차 · ` : ''}${phase}</b></p>
    ${r?.question ? `<p class="party-question">${escapeHtml(r.question)}</p>` : ''}${deadline}
    <p class="muted">다음 회차 참가 희망 ${state.lobby.length}명</p>
    ${(state.players ?? []).map(p => `<div class="party-player">${personChip(p)}<small>${p.confirmed ? '확정 완료' : p.ready ? '준비 완료' : '준비 중'}</small>
      ${r?.state === 'closed' && p.ready ? `<p>${state.game.key === 'catchmind' ? `${escapeHtml(p.answer)} · 맞힌 사람 ${p.correctCount}명` : `${p.number} · ${p.place ? `${p.place}등` : '중복 탈락'}`} · ${p.score}점</p>` : ''}</div>`).join('')}
    ${r?.state === 'guessing' ? `<h3 class="card__label">익명 답변</h3>${state.answers.map(a => `<p class="party-answer">${escapeHtml(a.text)}</p>`).join('')}` : ''}
  </section>`;
}
