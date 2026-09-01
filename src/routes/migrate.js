import { fail, getUser, json, timingSafeEqual } from '../lib/util.js';
import { migrate } from '../lib/migrate.js';

/**
 * 예전 스키마로 만들어진 DB 를 지금 모양으로 옮긴다.
 * 운영자로 로그인했거나 SETUP_TOKEN 을 실어 보내면 실행할 수 있고,
 * 이미 옮겨진 DB 에 다시 실행해도 아무 일도 일어나지 않는다.
 */
export async function onRequestPost(context) {
  const expected = context.env.SETUP_TOKEN;
  const provided =
    context.request.headers.get('x-setup-token') ??
    new URL(context.request.url).searchParams.get('token') ??
    '';

  const byToken = !!expected && timingSafeEqual(provided, expected);
  if (!byToken) {
    const user = await getUser(context);
    if (user?.role !== 'admin') {
      return fail(401, '운영자로 로그인하거나 설정 토큰이 필요합니다.');
    }
  }

  const result = await migrate(context.env.DB);
  return json({ ok: true, ...result });
}
