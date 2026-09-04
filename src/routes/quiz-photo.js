// 퀴즈 문제에 붙은 사진 내려 주기 — `<img src="/api/quiz/photo?q=12">`.
//
// 사진은 퀴즈를 낼 때 한 번 저장되고 그 뒤로 바뀌지 않으므로, 주소(퀴즈 번호)만
// 같으면 언제나 같은 그림이다. 그래서 오래 캐시해도 안전하다.
// 로그인한 사람에게만 보여 주므로 private 캐시로 둔다.

import { fail, requireUser } from '../lib/util.js';

export async function onRequestGet(context) {
  const { response } = await requireUser(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const quizId = Number(url.searchParams.get('q'));
  if (!Number.isInteger(quizId)) return fail(400, '어떤 문제의 사진인지 알 수 없습니다.');

  const row = await context.env.DB.prepare(
    `SELECT mime, data FROM quiz_photos WHERE quiz_id = ?`,
  ).bind(quizId).first();

  if (!row) return fail(404, '사진이 없는 문제입니다.');

  const binary = atob(row.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const etag = `"quiz${quizId}"`;
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
