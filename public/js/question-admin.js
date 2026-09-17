import { api, escapeHtml, setHtml } from './common.js';
import { showToast, confirmDialog } from './ui.js';

const PAGE_SIZE = 5;

export async function mountQuestionAdmin(root) {
  let questions = [], editing = null, page = 1, busy = false;
  root.innerHTML = `
    <h2 class="card__label" id="question-count">독심술사 질문 관리</h2>
    <details class="question-editor" id="question-editor">
      <summary id="question-editor-title">새 질문 추가</summary>
      <form id="question-form">
        <label class="field"><span id="question-input-label">새 질문</span>
          <textarea id="admin-question" maxlength="500" rows="3" required></textarea></label>
        <div class="party-actions"><button class="btn" type="submit" id="question-save">질문 추가</button>
          <button class="btn btn--ghost" type="button" id="question-cancel">취소</button></div>
      </form>
    </details>
    <div class="question-filters">
      <label class="field"><span>질문 검색</span><input id="question-search" type="search" placeholder="질문 내용 검색" autocomplete="off"></label>
      <label class="field"><span>출제 상태</span><select id="question-filter">
        <option value="all">전체</option><option value="unused">미사용</option><option value="used">출제 완료</option>
      </select></label>
    </div>
    <p class="muted question-list-note" id="question-range" aria-live="polite"></p>
    <div id="question-list"></div>
    <nav class="question-pagination" aria-label="질문 목록 페이지">
      <button class="btn btn--ghost" type="button" id="question-prev">이전</button>
      <span id="question-page" aria-live="polite"></span>
      <button class="btn btn--ghost" type="button" id="question-next">다음</button>
    </nav>
    <p class="muted question-list-note">한 페이지에 5개씩 표시해요. 출제 완료한 질문은 다시 나오지 않아요.</p>
    <button class="btn btn--ghost hidden" id="question-retry" type="button">질문 다시 불러오기</button>`;
  const el = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id, node]));

  function renderList() {
    const query = el['question-search'].value.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
    const filter = el['question-filter'].value;
    const matches = questions.filter(q => q.question.normalize('NFC').toLocaleLowerCase('ko-KR').includes(query)
      && (filter === 'all' || (filter === 'used' ? q.usedAt !== null : q.usedAt === null)));
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    page = Math.max(1, Math.min(page, pages));
    const start = (page - 1) * PAGE_SIZE;
    const shown = matches.slice(start, start + PAGE_SIZE);
    el['question-count'].textContent = `독심술사 질문 관리 (${questions.length}/100)`;
    el['question-range'].textContent = matches.length ? `${matches.length}개 중 ${start + 1}–${start + shown.length}번째` : '검색 결과가 없어요.';
    el['question-page'].textContent = `${page} / ${pages}`;
    el['question-prev'].disabled = busy || page === 1;
    el['question-next'].disabled = busy || page === pages;
    setHtml(el['question-list'], shown.map(q => `<article class="question-admin-item">
      <span class="tag">${q.usedAt === null ? '미사용' : '출제 완료'}</span>
      <p>${escapeHtml(q.question)}</p><div class="question-item-actions">
        ${q.usedAt === null ? `<button type="button" class="btn btn--ghost" data-edit="${escapeHtml(q.id)}" ${busy ? 'disabled' : ''}>수정</button>` : ''}
        <button type="button" class="btn btn--ghost" data-delete="${escapeHtml(q.id)}" ${busy ? 'disabled' : ''}>삭제</button>
      </div></article>`).join('') || '<p class="muted">검색어나 출제 상태를 바꿔 보세요.</p>');
  }

  function edit(question = null) {
    editing = question;
    el['question-editor-title'].textContent = question ? '질문 수정' : '새 질문 추가';
    el['question-input-label'].textContent = question ? '질문 수정' : '새 질문';
    el['question-save'].textContent = question ? '수정 저장' : '질문 추가';
    el['admin-question'].value = question?.question ?? '';
    el['question-editor'].open = !!question;
    if (question) el['admin-question'].focus();
  }

  async function load() {
    const data = await api('/api/admin/questions');
    questions = data.questions;
    el['question-retry'].classList.add('hidden');
    renderList();
  }
  function report(err) {
    showToast(err.message, 'error');
    el['question-retry'].classList.remove('hidden');
  }
  el['question-search'].addEventListener('input', () => { page = 1; renderList(); });
  el['question-filter'].addEventListener('change', () => { page = 1; renderList(); });
  for (const [id, step] of [['question-prev', -1], ['question-next', 1]]) {
    el[id].addEventListener('click', () => {
      page += step; renderList();
      el['question-search'].scrollIntoView({ block: 'start' });
    });
  }
  el['question-retry'].addEventListener('click', () => load().catch(report));
  el['question-cancel'].addEventListener('click', () => { if (!busy) edit(); });
  el['question-form'].addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    el['question-save'].disabled = true;
    try {
      const question = el['admin-question'].value;
      // 내용이 같으면 저장 요청 없이 편집을 닫는다.
      if (editing && question.normalize('NFC').trim().replace(/\s+/g, ' ') === editing.question) { edit(); return; }
      await api('/api/admin/questions', { method: 'POST', body: { question, ...(editing ? { id: editing.id } : {}) } });
      edit();
      await load();
      showToast('질문을 저장했어요.', 'ok');
    } catch (err) { report(err); }
    finally { busy = false; el['question-save'].disabled = false; renderList(); }
  });
  el['question-list'].addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button || busy) return;
    const question = questions.find(q => q.id === (button.dataset.edit ?? button.dataset.delete));
    if (!question) return;
    if (button.dataset.edit) { edit(question); return; }
    busy = true;
    try {
      if (!await confirmDialog({ title: '질문을 삭제할까요?', message: '진행 중인 회차와 지난 기록, 출제 이력은 유지돼요.', detail: question.question, confirmText: '삭제', tone: 'danger' })) return;
      button.disabled = true;
      await api(`/api/admin/questions?id=${encodeURIComponent(question.id)}`, { method: 'DELETE' });
      if (editing?.id === question.id) edit();
      await load();
      showToast('삭제했어요.', 'ok');
    } catch (err) { report(err); }
    finally { busy = false; renderList(); }
  });
  await load().catch(report);
}
