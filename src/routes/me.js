import { getUser, json, todayKST } from '../lib/util.js';
import { userWithSetterGames } from '../lib/setter.js';

export async function onRequestGet(context) {
  const user = await getUser(context);
  const total = user ? await context.env.DB.prepare(`SELECT
    COALESCE((SELECT SUM(score) FROM results WHERE user_id=?1),0)+
    COALESCE((SELECT SUM(score) FROM quiz_players WHERE user_id=?1 AND solved_at IS NOT NULL),0)+
    COALESCE((SELECT SUM(p.score) FROM party_players p JOIN party_rounds r ON r.id=p.round_id
      WHERE p.user_id=?1 AND p.ready=1 AND r.state='closed'),0) AS score`).bind(user.id).first() : null;
  return json({
    ok: true,
    user: user ? { ...await userWithSetterGames(context.env.DB, user), score: total.score } : null,
    today: todayKST(),
  });
}
