import { fail, requireUser } from '../lib/util.js';

/**
 * 프로필 사진 내려 주기 — `<img src="/api/avatar?u=3&v=2">`.
 *
 * 주소에 판 번호(v)가 들어 있어 사진을 바꾸면 주소도 바뀐다. 그래서 오래 캐시해도
 * 낡은 사진이 남지 않는다. 로그인한 사람에게만 보여 주므로 private 캐시로 둔다.
 */
export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const userId = Number(url.searchParams.get('u'));
  if (!Number.isInteger(userId)) return fail(400, '누구의 사진인지 알 수 없습니다.');

  const row = await context.env.DB.prepare(
    `SELECT p.mime, p.data, u.photo_version
       FROM user_photos p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ?`,
  ).bind(userId).first();

  if (!row) return fail(404, '아직 프로필 사진이 없습니다.');

  const binary = atob(row.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const etag = `"u${userId}v${row.photo_version}"`;
  if (context.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(context.request.method === 'HEAD' ? null : bytes, {
    headers: {
      'content-type': row.mime,
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=604800',
      etag,
    },
  });
}
