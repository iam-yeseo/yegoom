import { getUser, json, todayKST } from '../lib/util.js';
import { userWithSetterGames } from '../lib/setter.js';

export async function onRequestGet(context) {
  const user = await getUser(context);
  return json({
    ok: true,
    user: await userWithSetterGames(context.env.DB, user),
    today: todayKST(),
  });
}
