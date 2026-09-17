import { fail,json,readJson,requireAdmin } from '../lib/util.js';

export async function onRequestGet(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;
  const { results } = await context.env.DB.prepare(`SELECT id,question,used_at AS usedAt FROM catchmind_questions WHERE active=1 ORDER BY used_at IS NOT NULL, rowid DESC`).all();
  return json({ ok:true,questions:results });
}

export async function onRequestPost(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;
  const body = await readJson(context.request), db=context.env.DB;
  if (typeof body.question !== 'string') return fail(400,'질문을 입력해 주세요.');
  const question=body.question.normalize('NFC').trim().replace(/\s+/g,' ');
  if (!question || question.length>500) return fail(400,'질문은 1~500자로 입력해 주세요.');
  // 문구는 사용 여부와 무관하게 유일하다. 삭제 후 재등록해도 사용 이력을 초기화하지 않는다.
  const existing=await db.prepare(`SELECT * FROM catchmind_questions WHERE question=?`).bind(question).first();
  if (existing?.used_at != null) return fail(409,'이미 출제된 질문은 다시 등록할 수 없어요.');
  if (existing?.active) return fail(409,'이미 등록된 질문이에요.');
  const result = body.id
    ? await db.prepare(`UPDATE catchmind_questions SET question=? WHERE id=? AND active=1 AND used_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM catchmind_questions WHERE question=?)`).bind(question,String(body.id),question).run()
    : existing
      ? await db.prepare(`UPDATE catchmind_questions SET active=1 WHERE id=? AND used_at IS NULL AND active=0
          AND (SELECT COUNT(*) FROM catchmind_questions WHERE active=1)<100`).bind(existing.id).run()
      : await db.prepare(`INSERT OR IGNORE INTO catchmind_questions(id,question) SELECT ?,?
          WHERE (SELECT COUNT(*) FROM catchmind_questions WHERE active=1)<100`).bind(crypto.randomUUID(),question).run();
  if (!result.meta.changes) return fail(409,'질문은 최대 100개이며, 사용한 질문은 수정할 수 없어요.');
  return json({ ok:true });
}

export async function onRequestDelete(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;
  const id=new URL(context.request.url).searchParams.get('id');
  if (!id) return fail(400,'질문을 선택해 주세요.');
  await context.env.DB.prepare(`UPDATE catchmind_questions SET active=0 WHERE id=?`).bind(id).run();
  return json({ ok:true });
}
