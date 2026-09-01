import { clearCookie, json, readCookie, SESSION_COOKIE } from '../_lib/util.js';

export async function onRequestPost(context) {
  const token = readCookie(context.request, SESSION_COOKIE);
  if (token) {
    await context.env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  }
  return json({ ok: true }, { headers: { 'set-cookie': clearCookie(context.request) } });
}
