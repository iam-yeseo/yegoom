import { getUser, json, todayKST } from '../lib/util.js';

export async function onRequestGet(context) {
  const user = await getUser(context);
  return json({ ok: true, user, today: todayKST() });
}
