import { personOf } from './util.js';

export const PARTY_GAMES = {
  catchmind: { key: 'catchmind', label: '독심술사', icon: '🔮' },
  numberluck: { key: 'numberluck', label: '숫자 고르기', icon: '🃏' },
};
export const REVEAL_DELAY = 30_000;
export function partyKey(value) { return Object.hasOwn(PARTY_GAMES, value ?? '') ? value : null; }

export async function activeRound(db, game) {
  return db.prepare(`SELECT * FROM party_rounds WHERE game=? AND state<>'closed'`).bind(game).first();
}

// 모든 상태 변경의 조건을 SQL에도 둔다. 동시에 여러 요청이 와도 한 번만 공개/채점한다.
export async function advanceParty(db, game, now = Date.now()) {
  const round = await activeRound(db, game);
  if (!round) return;
  if (round.state === 'answering' && (round.deadline === null || round.deadline > now)) return;
  const id = round.id;
  if (game === 'numberluck') {
    await db.batch([
      db.prepare(`UPDATE party_players AS p SET place = CASE WHEN
        (SELECT COUNT(*) FROM party_players x WHERE x.round_id=p.round_id AND x.ready=1 AND x.number=p.number)=1
        THEN 1+(SELECT COUNT(*) FROM party_players x WHERE x.round_id=p.round_id AND x.ready=1 AND x.number>p.number
          AND (SELECT COUNT(*) FROM party_players y WHERE y.round_id=x.round_id AND y.ready=1 AND y.number=x.number)=1)
        ELSE NULL END
        WHERE round_id=? AND ready=1 AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=p.round_id
          AND r.state='answering' AND r.deadline<=?)`).bind(id, now),
      db.prepare(`UPDATE party_players SET score=CASE place WHEN 1 THEN 5 WHEN 2 THEN 3 WHEN 3 THEN 2 WHEN 4 THEN 1 ELSE 0 END
        WHERE round_id=? AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=round_id AND r.state='answering' AND r.deadline<=?)`).bind(id, now),
      db.prepare(`UPDATE party_rounds SET state='closed',closed_at=? WHERE id=? AND state='answering' AND deadline<=?`).bind(now, id, now),
    ]);
  } else {
    await db.prepare(`UPDATE party_rounds SET state='guessing' WHERE id=? AND state='answering' AND deadline<=?`).bind(id, now).run();
    await db.batch([
      db.prepare(`UPDATE party_players AS p SET correct_count=(SELECT COUNT(*) FROM party_guesses g
        JOIN party_players a ON a.answer_id=g.answer_id AND a.round_id=g.round_id
        WHERE g.round_id=p.round_id AND g.user_id=p.user_id AND g.author_id=a.user_id AND a.user_id<>p.user_id)
        WHERE round_id=? AND ready=1 AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=p.round_id AND r.state='guessing')
        AND NOT EXISTS(SELECT 1 FROM party_players x WHERE x.round_id=p.round_id AND x.ready=1 AND x.confirmed=0)`).bind(id),
      db.prepare(`UPDATE party_players AS p SET score=correct_count+CASE WHEN correct_count>=3 THEN 2 ELSE 0 END
        WHERE round_id=? AND ready=1 AND EXISTS(SELECT 1 FROM party_rounds r WHERE r.id=p.round_id AND r.state='guessing')
        AND NOT EXISTS(SELECT 1 FROM party_players x WHERE x.round_id=p.round_id AND x.ready=1 AND x.confirmed=0)`).bind(id),
      db.prepare(`UPDATE party_rounds SET state='closed',closed_at=? WHERE id=? AND state='guessing'
        AND NOT EXISTS(SELECT 1 FROM party_players p WHERE p.round_id=party_rounds.id AND p.ready=1 AND p.confirmed=0)`).bind(now, id),
    ]);
  }
}

export async function joinParty(db, game, userId, now = Date.now()) {
  const id = crypto.randomUUID();
  // 각 batch는 D1 트랜잭션이다. 동시 참가/시작 시 두 개의 판이 생기지 않는다.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO party_lobby(game,user_id) SELECT ?,? WHERE NOT EXISTS
      (SELECT 1 FROM party_rounds WHERE game=? AND state<>'closed')`).bind(game,userId,game),
    db.prepare(`INSERT OR IGNORE INTO party_rounds(id,game,round_no,question_id,question,created_at)
      SELECT ?,?,COALESCE((SELECT MAX(round_no) FROM party_rounds WHERE game=?),0)+1,
        CASE WHEN ?='catchmind' THEN q.id END,CASE WHEN ?='catchmind' THEN q.question END,?
      FROM (SELECT 1) LEFT JOIN catchmind_questions q ON q.id=(SELECT id FROM catchmind_questions WHERE active=1 AND used_at IS NULL ORDER BY random() LIMIT 1)
      WHERE (SELECT COUNT(*) FROM party_lobby WHERE game=?)>=2
        AND (?='numberluck' OR q.id IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM party_rounds WHERE game=? AND state<>'closed')`)
      .bind(id,game,game,game,game,now,game,game,game),
    db.prepare(`UPDATE catchmind_questions SET used_at=? WHERE id=(SELECT question_id FROM party_rounds WHERE id=?)`).bind(now,id),
    db.prepare(`INSERT OR IGNORE INTO party_players(round_id,user_id,answer_id)
      SELECT r.id,l.user_id,lower(hex(randomblob(16))) FROM party_lobby l JOIN party_rounds r ON r.game=l.game
      WHERE r.id=?`).bind(id),
    db.prepare(`DELETE FROM party_lobby WHERE game=? AND EXISTS(SELECT 1 FROM party_rounds WHERE id=?)`).bind(game,id),
    db.prepare(`INSERT OR IGNORE INTO party_players(round_id,user_id,answer_id)
      SELECT id,?,? FROM party_rounds WHERE game=? AND state='answering' AND (deadline IS NULL OR deadline>?)`)
      .bind(userId,crypto.randomUUID(),game,now),
  ]);
}

export async function partyState(db, game, user, now = Date.now()) {
  await advanceParty(db, game, now);
  const round = await db.prepare(`SELECT * FROM party_rounds WHERE game=? ORDER BY round_no DESC LIMIT 1`).bind(game).first();
  const { results: lobby } = await db.prepare(`SELECT u.* FROM party_lobby l JOIN users u ON u.id=l.user_id WHERE l.game=? ORDER BY u.id`).bind(game).all();
  const available = game === 'catchmind' ? (await db.prepare(`SELECT COUNT(*) AS n FROM catchmind_questions WHERE active=1 AND used_at IS NULL`).first()).n : null;
  if (!round) return { game: PARTY_GAMES[game], round: null, lobby: lobby.map(p=>personOf(p)), available, serverNow: now };
  const { results: players } = await db.prepare(`SELECT p.*,u.username,u.display_name,u.avatar,u.photo_version,u.id
    FROM party_players p JOIN users u ON u.id=p.user_id WHERE round_id=? ORDER BY u.id`).bind(round.id).all();
  const mine = players.find(p=>p.user_id===user.id);
  const closed = round.state === 'closed';
  const revealed = round.state !== 'answering';
  return {
    game: PARTY_GAMES[game], lobby: lobby.map(p=>personOf(p)), available, serverNow: now,
    round: { id: round.id, roundNo: round.round_no, state: round.state, question: round.question, deadline: round.deadline },
    players: players.map(p=>personOf(p, { ready: !!p.ready, confirmed: !!p.confirmed,
      ...(closed && p.ready ? { answer: p.answer, number: p.number, correctCount: p.correct_count, score: p.score, place: p.place } : {}) })),
    mine: mine ? { answer: mine.answer, number: mine.number, ready: !!mine.ready, confirmed: !!mine.confirmed } : null,
    // 무작위 익명 ID만 공개한다. 사용자 ID나 제출 순서로 작성자가 드러나지 않는다.
    answers: game === 'catchmind' && revealed ? players.filter(p=>p.ready)
      .map(p=>({ id: p.answer_id, text: p.answer, own: p.user_id === user.id,
        ...(closed ? { authorId: p.user_id } : {}) }))
      .sort((a,b)=>a.id.localeCompare(b.id)) : [],
  };
}

export async function partyScoreMap(db, game = null) {
  const { results } = await db.prepare(`SELECT p.user_id,r.game,SUM(p.score) AS score,COUNT(*) AS played
    FROM party_players p JOIN party_rounds r ON r.id=p.round_id
    WHERE r.state='closed' AND p.ready=1 AND (? IS NULL OR r.game=?) GROUP BY p.user_id,r.game`).bind(game,game).all();
  const map = new Map();
  for (const row of results) {
    const entry = map.get(row.user_id) ?? { score: 0, played: 0, catchmind: 0, numberluck: 0 };
    entry.score += row.score; entry.played += row.played; entry[row.game] = row.score;
    map.set(row.user_id,entry);
  }
  return map;
}
