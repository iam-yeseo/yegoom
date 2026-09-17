import { fail, json, readJson, requireUser, personOf } from '../lib/util.js';
import { partyKey, partyState, joinParty, advanceParty, REVEAL_DELAY } from '../lib/party.js';

export async function onRequestGet(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;
  const game = partyKey(new URL(context.request.url).searchParams.get('game'));
  if (!game) return fail(400,'게임을 선택해 주세요.');
  return json({ ok: true, ...await partyState(context.env.DB,game,user) });
}

export async function onRequestPost(context) {
  const { user, response } = await requireUser(context);
  if (response) return response;
  if (user.role !== 'player') return fail(403,'플레이어만 참여할 수 있어요.');
  const body = await readJson(context.request);
  const game = partyKey(body.game);
  if (!game) return fail(400,'게임을 선택해 주세요.');
  const db = context.env.DB, now = Date.now();
  await advanceParty(db,game,now);
  if (body.action === 'join') {
    await joinParty(db,game,user.id,now);
    return json({ ok:true, ...await partyState(db,game,user,now) });
  }
  if (body.action === 'leave') {
    await db.prepare(`DELETE FROM party_lobby WHERE game=? AND user_id=?`).bind(game,user.id).run();
    return json({ ok:true });
  }
  const round = await db.prepare(`SELECT * FROM party_rounds WHERE id=? AND game=?`).bind(String(body.roundId ?? ''),game).first();
  if (!round || round.state === 'closed') return fail(409,'진행 중인 회차가 아니에요. 새로고침해 주세요.');
  const player = await db.prepare(`SELECT * FROM party_players WHERE round_id=? AND user_id=?`).bind(round.id,user.id).first();
  if (!player) return fail(403,'먼저 이 회차에 참여해 주세요.');
  if (body.action === 'answer' || body.action === 'ready') {
    if (round.state !== 'answering' || (round.deadline !== null && now >= round.deadline)) return fail(409,'이미 답변이 공개되었어요.');
    if (player.ready) return fail(409,'준비 완료한 답변은 바꿀 수 없어요.');
    if (body.action === 'answer') {
      let answer = null, number = null;
      if (game === 'catchmind') {
        if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.trim().length > 500) return fail(400,'답변은 1~500자로 입력해 주세요.');
        answer = body.answer.trim();
      } else {
        if (!Number.isInteger(body.number) || body.number < 1 || body.number > 10) return fail(400,'1부터 10 사이의 숫자를 선택해 주세요.');
        number = body.number;
      }
      const result = await db.prepare(`UPDATE party_players SET answer=?,number=? WHERE round_id=? AND user_id=? AND ready=0
        AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=round_id AND r.state='answering' AND (r.deadline IS NULL OR r.deadline>?))`)
        .bind(answer,number,round.id,user.id,now).run();
      if (!result.meta.changes) return fail(409,'지금은 답변을 바꿀 수 없어요.');
    } else {
      if (game === 'catchmind' ? !player.answer : player.number == null) return fail(400,'먼저 작성 완료 버튼을 눌러 주세요.');
      await db.batch([
        db.prepare(`UPDATE party_players SET ready=1 WHERE round_id=? AND user_id=? AND ready=0
          AND (answer IS NOT NULL OR number IS NOT NULL)
          AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=round_id AND r.state='answering' AND (r.deadline IS NULL OR r.deadline>?))`).bind(round.id,user.id,now),
        db.prepare(`UPDATE party_rounds SET deadline=? WHERE id=? AND state='answering' AND deadline IS NULL
          AND (SELECT COUNT(*) FROM party_players WHERE round_id=party_rounds.id AND ready=1)>=3`).bind(now+REVEAL_DELAY,round.id),
      ]);
    }
  } else if (body.action === 'confirm') {
    if (game !== 'catchmind' || round.state !== 'guessing' || !player.ready || player.confirmed) return fail(409,'지금은 추측을 확정할 수 없어요.');
    const { results: participants } = await db.prepare(`SELECT user_id,answer_id FROM party_players WHERE round_id=? AND ready=1`).bind(round.id).all();
    const targets = participants.filter(p=>p.user_id!==user.id);
    const guesses = body.guesses;
    if (!Array.isArray(guesses) || guesses.length!==targets.length || new Set(guesses.map(g=>g?.answerId)).size!==targets.length ||
      guesses.some(g=>!g || !targets.some(t=>t.answer_id===g.answerId) || !targets.some(t=>t.user_id===g.authorId))) {
      return fail(400,'본인 답변을 제외한 각 답변의 작성자를 한 명씩 골라 주세요.');
    }
    await db.batch([
      ...guesses.map(g=>db.prepare(`INSERT INTO party_guesses(round_id,user_id,answer_id,author_id)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM party_players p JOIN party_rounds r ON r.id=p.round_id
          WHERE p.round_id=? AND p.user_id=? AND p.confirmed=0 AND r.state='guessing')
        ON CONFLICT(round_id,user_id,answer_id) DO NOTHING`).bind(round.id,user.id,g.answerId,g.authorId,round.id,user.id)),
      db.prepare(`UPDATE party_players SET confirmed=1 WHERE round_id=? AND user_id=? AND confirmed=0
        AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=round_id AND r.state='guessing')`).bind(round.id,user.id),
    ]);
    await advanceParty(db,game,now);
  } else return fail(400,'알 수 없는 동작이에요.');
  return json({ ok:true, ...await partyState(db,game,user,now) });
}

export async function history(context) {
  const { response } = await requireUser(context);
  if (response) return response;
  const game = partyKey(new URL(context.request.url).searchParams.get('game'));
  if (!game) return fail(400,'게임을 선택해 주세요.');
  const db = context.env.DB;
  await advanceParty(db,game);
  const { results: rounds } = await db.prepare(`SELECT id,round_no,question FROM party_rounds WHERE game=? AND state='closed' ORDER BY round_no DESC LIMIT 30`).bind(game).all();
  const history = await Promise.all(rounds.map(async r=>{
    const { results } = await db.prepare(`SELECT u.*,p.answer,p.number,p.correct_count,p.score,p.place FROM party_players p
      JOIN users u ON u.id=p.user_id WHERE p.round_id=? AND p.ready=1 ORDER BY u.id`).bind(r.id).all();
    return { roundNo:r.round_no,question:r.question,entries:results.map(p=>personOf(p, game==='catchmind'
      ? { answer:p.answer,correctCount:p.correct_count }
      : { number:p.number,score:p.score,place:p.place })) };
  }));
  return json({ ok:true,history });
}
