import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';
import { JSDOM } from 'jsdom';
import { gameInfo } from '../src/lib/games.js';
import { quizInfo } from '../src/lib/quiz.js';

const player={id:1,displayName:'예서',role:'player',score:24};
const friend={id:2,displayName:'친구',role:'player',score:10};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function mount(t,page,state,{user=player}={}) {
  const dom=new JSDOM(await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8'),{url:`https://test.local/${page}`,runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());
  const {window:w}=dom, timers=[],calls=[];
  w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  w.fetch=async(path,options={})=>{
    calls.push({path,...options});
    let data;
    if(path==='/api/me') data={user};
    else if(path.includes('/history')) data={history:[]};
    else if(path.startsWith('/api/today')||path==='/api/quiz'||path.startsWith('/api/party?')) data=state;
    else throw new Error(`Unexpected API: ${path}`);
    return {ok:true,json:async()=>structuredClone(data)};
  };
  const context=dom.getInternalVMContext(),cache=new Map();
  async function moduleFor(path) {
    if(cache.has(path)) return cache.get(path);
    const mod=new SourceTextModule(await readFile(new URL(`../public${path}`,import.meta.url),'utf8'),{context,identifier:path});
    cache.set(path,mod);return mod;
  }
  const entry=await moduleFor(`/js/${page==='quiz'?'quiz-page':page==='morning'||page==='evening'?'game-page':'party-page'}.js`);
  await entry.link((specifier,parent)=>moduleFor(new URL(specifier,`https://test.local${parent.identifier}`).pathname));
  await entry.evaluate();
  const doc=w.document;
  assert.doesNotMatch(doc.body.textContent,/불러오지 못했습니다|연결을 확인해 주세요|Unexpected API/);
  assert.equal(doc.querySelectorAll('.tabbar a').length,5);
  assert.ok(doc.querySelector('.game-hero'));
  return {w,doc,timers,calls,async refresh(ms){for(const timer of timers.filter(x=>x.ms===ms))timer.fn();for(let i=0;i<5;i++)await flush();}};
}
function timeState(key,extra={}) {
  return {game:gameInfo(key),date:'2026-09-18',roundNo:3,status:'open',closed:false,revealed:false,isToday:true,isSetter:false,setter:friend,submitted:0,closesAt:key==='morning'?'10:00':'18:00',chances:{total:key==='evening'?3:0,used:0,remaining:3,log:[]},players:[{...player,isMe:true,totalScore:24},{...friend,totalScore:10}],...extra};
}
function partyState(extra={}) {
  return {round:{id:12,roundNo:3,state:'answering',question:'가장 좋아하는 여행지는?',deadline:null},mine:{answer:null,number:null,ready:false},players:[player,friend],lobby:[],answers:[],available:5,serverNow:Date.now(),...extra};
}
test('morning: unsaved time survives refresh; public results use server score',async t=>{
  const state=timeState('morning'),app=await mount(t,'morning',state);
  const field=app.doc.querySelector('#guess-input input');
  field.value='09';field.dispatchEvent(new app.w.Event('input',{bubbles:true}));field.blur();
  await app.refresh(20000);assert.equal(field.value,'09');
  assert.ok(app.doc.querySelector('#my-result').classList.contains('hidden'));
  state.revealed=true;state.closed=true;state.answer='09:00:00';
  Object.assign(state.players[0],{submitted:true,guess:'09:00:00',score:100,diffText:'정확히',scoreText:'+100점'});
  await app.refresh(20000);
  assert.match(app.doc.querySelector('#my-result').textContent,/\+100/);
});
test('evening: chance tickets and setter-only recording controls',async t=>{
  const state=timeState('evening',{isSetter:true,setter:player,mine:{answerRecorded:true,answer:'18:30:00',canRecord:true}});
  const {doc}=await mount(t,'evening',state);
  assert.equal(doc.querySelectorAll('.chance-ticket').length,3);
  assert.equal(doc.querySelector('#secret-time').textContent,'18:30:00');
  assert.ok(doc.querySelector('#guess-box').classList.contains('hidden'));
});
test('number cards: selection survives polling and changes in other players',async t=>{
  const state=partyState(),app=await mount(t,'numberluck',state);
  const card=app.doc.querySelector('input[value="7"]');
  card.checked=true;card.dispatchEvent(new app.w.Event('input',{bubbles:true}));
  state.players[1].ready=true;await app.refresh(5000);
  assert.equal(app.doc.querySelector('input:checked').value,'7');
  assert.equal(app.doc.querySelector('[data-action="answer"]').disabled,false);
  assert.equal(app.doc.querySelector('[data-action="ready"]').disabled,true);
  assert.equal(app.doc.querySelectorAll('.number-cards input').length,10);
});
test('mind: own answer is unavailable; confirmed guesses hide controls',async t=>{
  const state=partyState({round:{id:12,roundNo:3,state:'guessing'},mine:{ready:true,confirmed:false},players:[{...player,ready:true},{...friend,ready:true}],answers:[{id:'own',text:'제주도',own:true},{id:'other',text:'부산',own:false}]});
  const app=await mount(t,'catchmind',state);
  assert.equal(app.doc.querySelectorAll('.party-answer--own input').length,0);
  assert.equal(app.doc.querySelectorAll('.party-answer:not(.party-answer--own) input').length,1);
  state.mine.confirmed=true;await app.refresh(5000);
  assert.equal(app.doc.querySelectorAll('#party-play input').length,0);
  assert.match(app.doc.querySelector('#party-play').textContent,/봉인 완료/);
});
test('quiz: unopened hints stay private and three envelope states render',async t=>{
  const state={game:quizInfo(),roundNo:3,nextRoundNo:4,turn:friend,isTurnHolder:false,canSet:false,players:[],me:{isPlayer:true,isSetter:false,solved:false,canHint:true,hints:[],hintsUsed:0,wrongs:0,attempts:[],nextHintPenalty:1},quiz:{id:3,roundNo:3,status:'open',closed:false,question:'고양이는 귀엽다?',setter:friend,answerType:'ox',answerTypeLabel:'O/X',answerTypeNote:'O 또는 X',mode:'free',modeLabel:'자유',modeIcon:'',modeNote:'',secondsLeft:null,hintCount:2,solvedCount:0}};
  const {doc}=await mount(t,'quiz',state);
  assert.equal(doc.querySelectorAll('.hint-envelope').length,3);
  assert.equal(doc.querySelectorAll('.hint-envelope.is-unavailable').length,1);
  assert.ok(doc.querySelector('#answer-box').classList.contains('hidden'));
  assert.equal(doc.querySelector('#question-text').textContent,'고양이는 귀엽다?');
});
