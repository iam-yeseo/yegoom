import {api,escapeHtml,setHtml} from './common.js';
import {showToast,confirmDialog} from './ui.js';
const root=document.getElementById('question-admin');
let questions=[],editing=null;
async function load() {
  const data=await api('/api/admin/questions'); questions=data.questions;
  setHtml(root,`<h2 class="card__label">🔮 독심술사 질문 관리 (${questions.length}/100)</h2>
    <p class="muted">한 번 출제한 질문은 재사용하지 않아요. 사용한 질문은 삭제해도 출제 이력이 남아요.</p>
    <form id="question-form"><label for="admin-question">${editing?'질문 수정':'새 질문'}</label>
    <textarea id="admin-question" maxlength="500" rows="3" required>${escapeHtml(editing?.question ?? '')}</textarea>
    <div class="party-actions"><button class="btn" type="submit">${editing?'수정 저장':'질문 추가'}</button>${editing?'<button class="btn btn--ghost" type="button" data-cancel-edit>취소</button>':''}</div></form>
    ${questions.map(q=>`<div class="question-admin-item"><span class="tag">${q.usedAt===null?'미사용':'출제 완료'}</span><p>${escapeHtml(q.question)}</p>
      <div class="party-actions">${q.usedAt===null?`<button class="btn btn--ghost" data-edit="${q.id}">수정</button>`:''}<button class="btn btn--ghost" data-delete="${q.id}">삭제</button></div></div>`).join('')}`);
}
root.addEventListener('submit',async e=>{
  e.preventDefault(); const btn=e.submitter; btn.disabled=true;
  try { await api('/api/admin/questions',{method:'POST',body:{question:document.getElementById('admin-question').value,...(editing?{id:editing.id}:{})}});editing=null;await load();showToast('질문을 저장했어요.','ok'); }
  catch(err){showToast(err.message,'error');btn.disabled=false;}
});
root.addEventListener('click',async e=>{
  const btn=e.target.closest('button'); if(!btn)return;
  if(btn.hasAttribute('data-cancel-edit')){editing=null;await load();}
  if(btn.dataset.edit){editing=questions.find(q=>q.id===btn.dataset.edit);await load();document.getElementById('admin-question').focus();}
  if(btn.dataset.delete){
    const ok=await confirmDialog({title:'질문을 삭제할까요?',message:'이미 진행 중인 회차와 지난 기록은 유지돼요.',confirmText:'삭제',tone:'danger'});
    if(!ok)return;
    btn.disabled=true;
    try{await api(`/api/admin/questions?id=${encodeURIComponent(btn.dataset.delete)}`,{method:'DELETE'});editing=null;await load();showToast('삭제했어요.','ok');}
    catch(err){showToast(err.message,'error');btn.disabled=false;}
  }
});
load().catch(err=>{root.textContent=err.message;});
