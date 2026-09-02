import { fail, json, personOf, readJson, requireAdmin } from '../lib/util.js';
import { GAMES, GAME_KEYS, gameInfo, gameOf } from '../lib/games.js';
import { assignSetterStatements, getSetters } from '../lib/setter.js';

/** 출제자 후보(플레이어 전원)와 게임별로 지금 지정된 출제자 */
export async function onRequestGet(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const db = context.env.DB;
  const [{ results }, setters] = await Promise.all([
    db.prepare(
      `SELECT id, username, display_name, avatar, photo_version FROM users
        WHERE role = 'player' ORDER BY id`,
    ).all(),
    getSetters(db),
  ]);

  return json({
    ok: true,
    games: GAME_KEYS.map((key) => gameInfo(GAMES[key])),
    setters,
    candidates: (results ?? []).map((u) =>
      personOf(u, {
        setterGames: GAME_KEYS.filter((key) => setters[key]?.id === u.id),
      }),
    ),
  });
}

/**
 * 한 게임의 출제자를 지정한다. 이 사람의 시간이 그 게임의 정답이 된다.
 * 운영자는 게임에 참여하지 않으므로 출제자가 될 수 없다.
 */
export async function onRequestPost(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const game = gameOf(body.game);
  const userId = Number(body.userId ?? body.id);
  if (!Number.isInteger(userId)) return fail(400, '출제자로 지정할 참가자를 골라 주세요.');

  const db = context.env.DB;
  const target = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first();
  if (!target) return fail(404, '없는 계정입니다.');
  if (target.role === 'admin') return fail(400, '운영자는 출제자가 될 수 없습니다.');

  await db.batch(assignSetterStatements(db, game.key, userId));

  return json({ ok: true, game: gameInfo(game), setters: await getSetters(db) });
}
