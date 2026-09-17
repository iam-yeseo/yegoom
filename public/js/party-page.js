import { api,escapeHtml,personChip,requireLogin,renderTabbar,setHtml,setHidden,refreshGnb } from './common.js';
import { showToast,confirmDialog } from './ui.js';
import { renderPartyHistory } from './party-history.js';

const game=document.body.dataset.party, catchmind=game==='catchmind';
const user=await requireLogin();
renderTabbar(user);
const info=document.getElementById('party-info'),play=document.getElementById('party-play');
const history=document.getElementById('party-history');
document.getElementById('party-rules').textContent=catchmind
  ? '작성 완료와 준비 완료는 별도예요. 공개된 답변마다 작성자를 한 명씩 골라 확정하세요. 본인 답변은 맞힐 수 없어요. 맞힌 사람당 1점, 3명 이상 맞히면 보너스 2점!'
  : '숫자 선택을 확정하고 준비 완료를 눌러 주세요. 중복 숫자는 탈락! 나머지는 큰 숫자부터 1등 5점 · 2등 3점 · 3등 2점 · 4등 1점을 받아요.';
let state, viewKey='', historyKey='', busy=false, loading=false, offset=0;
let answerDraft='',numberDraft=null,guesses={};

function button(action,text,disabled=false) { return `<button type="button" class="btn" data-action="${action}" ${disabled?'disabled':''}>${text}</button>`; }
function render() {
  const {round,mine,players=[],lobby=[]}=state;
  const closed=!round || round.state==='closed';
  const playing=user.role==='player';
  const joined=lobby.some(p=>p.id===user.id);
  setHtml(info,`<div class="card__label">${round ? `${round.roundNo}회차` : '첫 회차를 기다려요'}</div>
    <p class="party-status">${closed ? '함께할 친구를 모으고 있어요' : round.state==='guessing' ? '이 답변은 누구의 생각일까요?' : '나만의 답변을 준비해요'}</p>
    ${round?.question ? `<p class="party-question">${escapeHtml(round.question)}</p>` : ''}
    ${!closed ? `<p id="party-countdown" class="muted"></p>
      <div class="party-players">${players.map(p=>`<div class="party-player">${personChip(p)}<small>${p.confirmed?'확정 완료':p.ready?'준비 완료':'준비 중'}</small></div>`).join('')}</div>` :
      `<p class="muted">다음 회차 참가 희망 ${lobby.length}명 / 시작에 필요한 인원 2명</p>
      <div class="party-players">${lobby.map(p=>personChip(p)).join(' ')}</div>
      ${catchmind && state.available===0 ? '<p class="muted">사용하지 않은 질문이 없어요. 운영자가 질문을 추가하면 다시 하고 싶어요를 눌러 주세요.</p>' : ''}`}
    ${playing && closed ? button(joined?'leave':'join',joined?'참여 대기 취소':'하고 싶어요') : ''}
    ${playing && closed && joined && lobby.length>=2 && state.available>0 ? button('join','다음 회차 시작하기') : ''}
    ${playing && !closed && !mine && round.state==='answering' ? button('join','이번 회차 참여하기') : ''}
    ${!playing ? '<p class="muted">운영자는 게임을 지켜볼 수 있어요.</p>' : ''}`);
  tick();
  // 참가자의 준비 상태만 변해도 입력칸/라디오 선택과 초점은 그대로 유지한다.
  const nextKey=JSON.stringify([round?.id,round?.state,mine,state.answers]);
  if (nextKey===viewKey) return;
  const changedRound=state.round?.id!==play.dataset.round;
  if (changedRound) { answerDraft=mine?.answer ?? ''; numberDraft=mine?.number ?? null; guesses={}; }
  play.dataset.round=round?.id ?? '';
  viewKey=nextKey;
  setHidden(play,!round);
  if (!round) return;
  if (round.state==='closed') {
    setHtml(play,`<h2 class="card__label">결과 공개</h2>${players.filter(p=>p.ready).map(p=>`<div class="party-result">
      ${catchmind?'':`<span class="number-card">${p.number}</span>`}<div>${personChip(p)}
      <p>${catchmind ? `${escapeHtml(p.answer)} · 맞힌 사람 ${p.correctCount}명` : p.place ? `${p.place}등` : '중복 탈락'} · <b>+${p.score}점</b></p></div></div>`).join('')}`);
  } else if (round.state==='answering' && mine) {
    setHtml(play,catchmind
      ? `<label for="party-answer">내 답변</label><textarea id="party-answer" rows="4" maxlength="500" ${mine.ready?'disabled':''}>${escapeHtml(answerDraft)}</textarea>
        <p class="muted">${mine.ready?'준비 완료! 답변 공개를 기다려 주세요.':mine.answer?'작성한 답변을 저장했어요. 준비 완료를 눌러 주세요.':'작성 완료를 눌러 답변을 저장하세요.'}</p>
        <div class="party-actions">${button('answer','작성 완료',mine.ready || !answerDraft.trim())}${button('ready','준비 완료',mine.ready || !mine.answer || answerDraft.trim()!==mine.answer)}</div>`
      : `<fieldset class="party-options"><legend>내 카드 고르기</legend><div class="number-cards">${Array.from({length:10},(_,i)=>i+1).map(n=>`<label class="number-card">${n}<input type="radio" name="number" value="${n}" aria-label="${n}" ${numberDraft===n?'checked':''} ${mine.ready?'disabled':''}></label>`).join('')}</div></fieldset>
        <p class="muted">${mine.ready?'준비 완료! 카드를 공개할 때까지 기다려 주세요.':mine.number?'숫자를 저장했어요. 준비 완료를 눌러 주세요.':'카드 한 장을 선택하세요.'}</p>
        <div class="party-actions">${button('answer','선택 확정',mine.ready || numberDraft===null)}${button('ready','준비 완료',mine.ready || mine.number===null || numberDraft!==mine.number)}</div>`);
  } else if (round.state==='guessing') {
    const canGuess=playing && mine?.ready && !mine.confirmed;
    setHtml(play,`<h2 class="card__label">익명 답변</h2><p class="muted">${mine?.confirmed?'확정 완료! 다른 친구들을 기다려요.':canGuess?'내 답변을 제외하고 작성자를 한 명씩 골라 주세요.':'이번 회차를 관전 중이에요.'}</p>
      ${state.answers.map((a,i)=>`<article class="party-answer"><b>답변 ${i+1}${a.own?' · 내 답변':''}</b><p>${escapeHtml(a.text)}</p>
        ${canGuess && !a.own ? `<fieldset class="party-options"><legend class="muted">누구의 답변일까요?</legend>${players.filter(p=>p.ready&&p.id!==user.id).map(p=>`<label><input type="radio" name="${a.id}" value="${p.id}" ${guesses[a.id]===p.id?'checked':''}> ${escapeHtml(p.displayName)}</label>`).join('')}</fieldset>`:''}</article>`).join('')}
      ${canGuess?button('confirm','확정하기',!allGuessed()):''}`);
  } else setHtml(play,'<p class="muted">참여 후 답변을 작성할 수 있어요.</p>');
}
function allGuessed() { return state.answers.filter(a=>!a.own).every(a=>guesses[a.id]); }
function tick() {
  const el=document.getElementById('party-countdown');
  if (!el || !state?.round) return;
  const r=state.round;
  if (r.state==='guessing') { el.textContent='준비 완료한 참가자 모두 확정하면 정답과 점수가 공개돼요.'; return; }
  if (!r.deadline) { el.textContent='3명 이상 준비 완료하면 3분 뒤 공개해요. 2명만 준비하면 한 명을 더 기다려요.'; return; }
  const sec=Math.max(0,Math.ceil((r.deadline-Date.now()-offset)/1000));
  el.textContent=sec ? `공개까지 ${Math.floor(sec/60)}분 ${sec%60}초 · 공개 전까지 참여할 수 있어요` : '답변을 공개하고 있어요…';
  if (!sec) load().catch(()=>{});
}
async function load() {
  if (loading || busy) return;
  loading=true;
  try {
    state=await api(`/api/party?game=${game}`);
    offset=state.serverNow-Date.now(); render();
    const key=`${state.round?.id}:${state.round?.state}`;
    if (key!==historyKey) {
      const result=await api(`/api/party/history?game=${game}`);
      setHtml(history,renderPartyHistory(result.history,game)); historyKey=key;
      await refreshGnb();
    }
  } finally { loading=false; }
}
play.addEventListener('input',e=>{
  if (e.target.id==='party-answer') {
    answerDraft=e.target.value;
    play.querySelector('[data-action="answer"]').disabled=!answerDraft.trim();
    play.querySelector('[data-action="ready"]').disabled=answerDraft.trim()!==state.mine.answer;
  } else if (e.target.name==='number') {
    numberDraft=Number(e.target.value);
    play.querySelector('[data-action="answer"]').disabled=false;
    play.querySelector('[data-action="ready"]').disabled=numberDraft!==state.mine.number;
  } else if (e.target.type==='radio') {
    guesses[e.target.name]=Number(e.target.value);
    play.querySelector('[data-action="confirm"]').disabled=!allGuessed();
  }
});
document.querySelector('.app').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if (!btn || busy) return;
  const action=btn.dataset.action;
  if (action==='reload') { await load().catch(err=>showToast(err.message,'error')); return; }
  busy=true;
  try {
    if (action==='ready' || action==='confirm') {
      const ok=await confirmDialog({icon:catchmind?'🔮':'🃏',title:action==='ready'?'준비를 완료할까요?':'추측을 확정할까요?',message:'완료 후에는 바꿀 수 없어요.',confirmText:action==='ready'?'준비 완료':'확정하기'});
      if (!ok) return;
    }
    btn.disabled=true;
    await api('/api/party',{method:'POST',body:{game,action,roundId:state.round?.id,
      ...(action==='answer'?catchmind?{answer:answerDraft}:{number:numberDraft}:{}),
      ...(action==='confirm'?{guesses:state.answers.filter(a=>!a.own).map(a=>({answerId:a.id,authorId:guesses[a.id]}))}:{})}});
    showToast('완료했어요.','ok'); viewKey='';
  } catch(err) { showToast(err.message,'error'); }
  finally { busy=false; btn.disabled=false; await load().catch(err=>showToast(err.message,'error')); }
});
await load().catch(err=>{setHtml(info,`<p>${escapeHtml(err.message)}</p>${button('reload','다시 시도')}`);showToast(err.message,'error');});
setInterval(()=>{if(!document.hidden) load().catch(()=>{});},5000);
setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load().catch(()=>{});});
