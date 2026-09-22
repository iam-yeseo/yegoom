import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SCHEMA_STATEMENTS } from '../src/lib/schema.js';
import { pendingMigrations,migrate } from '../src/lib/migrate.js';
import { advanceParty,REVEAL_DELAY } from '../src/lib/party.js';
import * as party from '../src/routes/party.js';
import * as questions from '../src/routes/party-questions.js';
import * as ranking from '../src/routes/ranking.js';
import * as me from '../src/routes/me.js';
import { scoreFor } from '../src/lib/game.js';

test('evening score boundaries and unchanged morning scores',()=>{
  for(const [diff,score] of [[0,10],[1,8],[10,8],[11,6],[30,6],[31,4],[60,4],[61,2],[120,2],[121,1],[300,1],[301,0]]) assert.equal(scoreFor('evening',diff),score);
  assert.equal(scoreFor('morning',0),100);
});

test('D1: migration, anonymous rounds, concurrency, scoring, history and authorization', async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-09-01',d1Databases:['DB']}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  // Simulate an existing installation, including a historical score that must not change.
  await db.batch(SCHEMA_STATEMENTS.filter(s=>!s.includes('party_')&&!s.includes('catchmind_questions')).map(s=>db.prepare(s)));
  for(let i=1;i<=5;i++) {
    await db.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt) VALUES(?,?,?,?,?,?)`).bind(i,i===5?'admin':`p${i}`,`친구${i}`,i===5?'admin':'player','test','test').run();
    await db.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,datetime('now','+1 day'))`).bind(`test-${i}`,i).run();
  }
  await db.prepare(`INSERT INTO rounds(game,game_date,status,answer_seconds) VALUES('evening','2026-01-01','settled',3600)`).run();
  await db.prepare(`INSERT INTO results(game,game_date,user_id,diff_seconds,score,is_winner) VALUES('evening','2026-01-01',1,0,3,1)`).run();
  assert.ok((await pendingMigrations(db)).includes('party_rounds'));
  await migrate(db); await migrate(db);
  assert.deepEqual(await pendingMigrations(db),[]);
  assert.equal((await db.prepare(`SELECT score FROM results`).first()).score,3);
  const ctx=(id,path,body,method=body?'POST':'GET')=>({env:{DB:db},request:new Request(`https://test.local${path}`,{method,headers:{cookie:`toigeun_session=test-${id}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
  async function call(module,id,path,body,method) {
    const res=await module[method==='DELETE'?'onRequestDelete':body?'onRequestPost':'onRequestGet'](ctx(id,path,body,method));
    return {status:res.status,...await res.json()};
  }
  const action=(id,game,action,roundId,extra={})=>call(party,id,'/api/party',{game,action,roundId,...extra});
  const state=(game,id=1)=>call(party,id,`/api/party?game=${game}`);
  assert.equal((await state('numberluck',0)).status,401);
  assert.equal((await call(questions,1,'/api/admin/questions',{question:'누가 좋아요?'})).status,403);
  assert.equal((await action(5,'numberluck','join')).status,403);
  assert.equal((await call(questions,5,'/api/admin/questions',{question:'가장 좋아하는 여행지는?'})).status,200);
  const q=(await call(questions,5,'/api/admin/questions')).questions[0];
  await call(questions,5,'/api/admin/questions',{id:q.id,question:'가장 기억에 남는 여행지는?'});

  // Two players start immediately, but two ready players must not start the countdown.
  await Promise.all([action(1,'catchmind','join'),action(2,'catchmind','join')]);
  let s=await state('catchmind'),id=s.round.id;
  assert.equal(s.round.state,'answering'); assert.equal(s.round.roundNo,1);
  assert.equal((await action(1,'catchmind','ready',id)).status,400);
  for(const u of [1,2]) {
    await action(u,'catchmind','answer',id,{answer:`비밀 답변 ${u}`});
    await action(u,'catchmind','ready',id);
  }
  s=await state('catchmind',5);
  assert.equal(s.round.deadline,null); assert.deepEqual(s.answers,[]);
  assert.ok(!JSON.stringify(s).includes('비밀 답변'));
  assert.equal((await action(1,'catchmind','answer',id,{answer:'수정 공격'})).status,409);
  for(const u of [3,4]) {
    await action(u,'catchmind','join');
    await action(u,'catchmind','answer',id,{answer:`비밀 답변 ${u}`});
  }
  const before=Date.now();
  await Promise.all([action(3,'catchmind','ready',id),action(4,'catchmind','ready',id)]);
  s=await state('catchmind');
  assert.ok(s.round.deadline>=before+REVEAL_DELAY);
  const deadline=s.round.deadline;
  await advanceParty(db,'catchmind',deadline-1);
  assert.equal((await state('catchmind')).round.state,'answering');
  await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
  s=await state('catchmind');
  assert.equal(s.round.state,'guessing');assert.equal(s.answers.length,4);
  assert.equal(s.answers.filter(a=>a.own).length,1);
  assert.ok(s.answers.every(a=>!('authorId' in a)));
  assert.ok(s.players.every(p=>!('answer' in p)));
  const {results: roster}=await db.prepare(`SELECT * FROM party_players WHERE round_id=?`).bind(id).all();
  const choices=u=>roster.filter(p=>p.user_id!==u).map(p=>({answerId:p.answer_id,authorId:p.user_id}));
  assert.equal((await action(1,'catchmind','confirm',id,{guesses:[{answerId:roster[0].answer_id,authorId:1}]})).status,400);
  await Promise.all([1,2,3].map(u=>action(u,'catchmind','confirm',id,{guesses:choices(u)})));
  assert.equal((await state('catchmind')).round.state,'guessing');
  await Promise.all([action(4,'catchmind','confirm',id,{guesses:choices(4)}),action(4,'catchmind','confirm',id,{guesses:choices(4)})]);
  s=await state('catchmind');assert.equal(s.round.state,'closed');
  assert.ok(s.players.every(p=>p.correctCount===3&&p.score===10));
  await Promise.all([advanceParty(db,'catchmind'),advanceParty(db,'catchmind')]);
  const hist=await (await party.history(ctx(1,'/api/party/history?game=catchmind'))).json();
  assert.equal(hist.history[0].question,'가장 기억에 남는 여행지는?');
  assert.ok(hist.history[0].entries.every(e=>e.correctCount===3&&!('score' in e)));
  // Used questions cannot be edited or resurrected after deletion.
  assert.equal((await call(questions,5,'/api/admin/questions',{id:q.id,question:'바꾸기'})).status,409);
  await call(questions,5,`/api/admin/questions?id=${q.id}`,null,'DELETE');
  assert.equal((await call(questions,5,'/api/admin/questions',{question:'가장 기억에 남는 여행지는?'})).status,409);
  await Promise.all([action(1,'catchmind','join'),action(2,'catchmind','join')]);
  s=await state('catchmind');assert.equal(s.round.id,id);assert.equal(s.available,0);

  // Unique descending numbers score; duplicate 10s lose. Concurrent readers settle once.
  await Promise.all([1,2,3,4].map(u=>action(u,'numberluck','join')));
  s=await state('numberluck');id=s.round.id;
  assert.equal(s.players.length,4);
  assert.equal((await action(1,'numberluck','answer',id,{number:11})).status,400);
  assert.equal((await action(1,'numberluck','answer','old-round',{number:5})).status,409);
  for(const [u,n] of [[1,10],[2,10],[3,9],[4,1]]){
    await action(u,'numberluck','answer',id,{number:n});await action(u,'numberluck','ready',id);
  }
  s=await state('numberluck',5);assert.ok(s.players.every(p=>!('number' in p)));
  await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
  await Promise.all([state('numberluck'),state('numberluck',2),state('numberluck',3)]);
  s=await state('numberluck');assert.equal(s.round.state,'closed');
  assert.deepEqual(s.players.map(p=>p.score),[0,0,5,3]);
  assert.deepEqual(s.players.map(p=>p.place),[null,null,1,2]);
  const total=await call(ranking,1,'/api/ranking');
  assert.equal(total.ranking.find(p=>p.id===1).score,13);
  assert.equal(total.ranking.find(p=>p.id===3).score,15);
  assert.equal((await call(me,3,'/api/me')).user.score,15);
  assert.equal((await call(ranking,1,'/api/ranking?game=numberluck')).ranking[0].id,3);
  // All duplicate: everyone scores zero, and no phantom winner.
  await Promise.all([1,2,3].map(u=>action(u,'numberluck','join')));
  s=await state('numberluck');id=s.round.id;assert.equal(s.round.roundNo,2);
  for(const u of [1,2,3]) {await action(u,'numberluck','answer',id,{number:7});await action(u,'numberluck','ready',id);}
  await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
  s=await state('numberluck');assert.ok(s.players.every(p=>p.place===null&&p.score===0));
  // Four unique cards exercise all four awards.
  await Promise.all([1,2,3,4].map(u=>action(u,'numberluck','join')));
  s=await state('numberluck');id=s.round.id;
  for(const u of [1,2,3,4]) {await action(u,'numberluck','answer',id,{number:11-u});await action(u,'numberluck','ready',id);}
  await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
  s=await state('numberluck');assert.deepEqual(s.players.map(p=>p.score),[5,3,2,1]);
  // An unready fourth player cannot hold up the reveal or enter the guessing phase.
  await call(questions,5,'/api/admin/questions',{question:'두 번째 질문'});
  await action(1,'catchmind','join');
  await Promise.all([3,4].map(u=>action(u,'catchmind','join')));
  s=await state('catchmind');id=s.round.id;
  for(const u of [1,2,3]) {await action(u,'catchmind','answer',id,{answer:`두번째 ${u}`});await action(u,'catchmind','ready',id);}
  await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
  s=await state('catchmind',4);assert.equal(s.answers.length,3);
  assert.equal((await action(4,'catchmind','confirm',id,{guesses:[]})).status,409);
  const {results: second}=await db.prepare(`SELECT * FROM party_players WHERE round_id=? AND ready=1`).bind(id).all();
  // All wrong, one correct, two correct: scores 0, 1, 2 without the bonus.
  for(const u of [1,2,3]) {
    const other=second.filter(p=>p.user_id!==u);
    const picks=other.map((p,i)=>({answerId:p.answer_id,authorId:u===1 || (u===2&&i===0)?other[1-i].user_id:p.user_id}));
    assert.equal((await action(u,'catchmind','confirm',id,{guesses:picks})).status,200);
  }
  s=await state('catchmind');assert.equal(s.round.state,'closed');
  assert.deepEqual(s.players.filter(p=>p.ready).map(p=>p.score),[0,1,2]);
  const used=(await call(questions,5,'/api/admin/questions')).questions.find(q=>q.usedAt!==null);
  await call(questions,5,`/api/admin/questions?id=${used.id}`,null,'DELETE');
  // Question cap is enforced by SQL even under simultaneous submissions.
  for(let i=0;i<99;i++) await call(questions,5,'/api/admin/questions',{question:`새 질문 ${i}`});
  const cap=await Promise.all([call(questions,5,'/api/admin/questions',{question:'마지막 A'}),call(questions,5,'/api/admin/questions',{question:'마지막 B'})]);
  assert.deepEqual(cap.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call(questions,5,'/api/admin/questions')).questions.length,100);

  // Team bonus excludes unready spectators and requires every guess from every ready player.
  for(const scenario of [
    {participants:[1,2,3],wrongPlayer:null,counts:[2,2,2],scores:[7,7,7]},
    {participants:[1,2,3,4],wrongPlayer:1,counts:[2,3,3,3],scores:[2,5,5,5]},
  ]) {
    await Promise.all([1,2,3,4].map(u=>action(u,'catchmind','join')));
    s=await state('catchmind');id=s.round.id;
    for(const u of scenario.participants) {
      await action(u,'catchmind','answer',id,{answer:`보너스 답변 ${u}`});
      await action(u,'catchmind','ready',id);
    }
    await db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=?`).bind(Date.now()-1,id).run();
    s=await state('catchmind');assert.equal(s.round.state,'guessing');
    const {results: participants}=await db.prepare(`SELECT * FROM party_players WHERE round_id=? AND ready=1 ORDER BY user_id`).bind(id).all();
    for(const u of scenario.participants) {
      const guesses=participants.filter(p=>p.user_id!==u).map(p=>({answerId:p.answer_id,authorId:p.user_id}));
      if(u===scenario.wrongPlayer) guesses[0].authorId=guesses[1].authorId;
      if(u===scenario.participants.at(-1)) {
        assert.equal((await state('catchmind')).round.state,'guessing');
        assert.equal((await db.prepare(`SELECT SUM(score) AS score FROM party_players WHERE round_id=?`).bind(id).first()).score,0);
      }
      assert.equal((await action(u,'catchmind','confirm',id,{guesses})).status,200);
    }
    s=await state('catchmind');assert.equal(s.round.state,'closed');
    assert.deepEqual(s.players.filter(p=>p.ready).map(p=>p.correctCount),scenario.counts);
    assert.deepEqual(s.players.filter(p=>p.ready).map(p=>p.score),scenario.scores);
    const {results: spectators}=await db.prepare(`SELECT score FROM party_players WHERE round_id=? AND ready=0`).bind(id).all();
    assert.ok(spectators.every(p=>p.score===0));
    await Promise.all([advanceParty(db,'catchmind'),advanceParty(db,'catchmind')]);
    assert.deepEqual((await state('catchmind')).players.filter(p=>p.ready).map(p=>p.score),scenario.scores);
  }

  // A completed round from the previous scoring rule is never awarded a retroactive bonus.
  await db.prepare(`INSERT INTO party_rounds(id,game,round_no,state,created_at,closed_at)
    VALUES('legacy-catchmind','catchmind',100,'closed',1,2)`).run();
  for(const u of [1,2,3]) {
    await db.prepare(`INSERT INTO party_players(round_id,user_id,answer_id,ready,confirmed,correct_count,score)
      VALUES('legacy-catchmind',?,?,1,1,2,2)`).bind(u,`legacy-answer-${u}`).run();
  }
  s=await state('catchmind');
  assert.deepEqual(s.players.map(p=>p.score),[2,2,2]);
});
