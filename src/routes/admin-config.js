// 운영자가 게임 설정을 바꾼다 — 지금은 오후 게임의 '기회' 횟수 하나뿐이다.

import { fail, json, readJson, requireAdmin } from '../lib/util.js';
import { GAMES, GAME_KEYS, MAX_CHANCES, gameInfo, gameOf, normalizeChances } from '../lib/games.js';
import { allChances, setChancesStatements, usesChances } from '../lib/config.js';

/** 게임별 설정 — 기회를 쓰는 게임만 내려 준다 */
export async function onRequestGet(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const chances = await allChances(context.env.DB);

  return json({
    ok: true,
    maxChances: MAX_CHANCES,
    games: GAME_KEYS.filter((key) => GAMES[key].useChances).map((key) => ({
      ...gameInfo(GAMES[key]),
      chances: chances[key],
    })),
  });
}

/** 기회 횟수 바꾸기. 이미 시작된 라운드는 그날 처음 정한 횟수를 그대로 쓴다. */
export async function onRequestPost(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const game = gameOf(body.game);
  if (!usesChances(game.key)) return fail(400, `${game.label}에는 기회가 없습니다.`);

  const chances = normalizeChances(body.chances);
  if (chances === null) {
    return fail(400, `기회는 0 ~ ${MAX_CHANCES}번 사이로 정해 주세요.`);
  }

  const db = context.env.DB;
  await db.batch(setChancesStatements(db, game.key, chances));

  return json({ ok: true, game: gameInfo(game), chances });
}
