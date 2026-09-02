// 게임별 설정 — 지금은 '기회' 횟수 하나뿐이다.
//
// game_config 에 행이 없으면 src/lib/games.js 의 defaultChances 를 쓴다. 그래서
// 운영자가 한 번도 손대지 않아도 게임은 그냥 돌아간다.

import { GAME_KEYS, GAMES, gameOf } from './games.js';

/** 그 게임에 걸려 있는 기회 횟수 */
export async function chancesFor(db, game) {
  const g = gameOf(game);
  if (!g.useChances) return 0;
  try {
    const row = await db
      .prepare(`SELECT chances FROM game_config WHERE game = ?`)
      .bind(g.key)
      .first();
    return row?.chances ?? g.defaultChances;
  } catch {
    // game_config 가 아직 없는 예전 DB — 스키마를 옮기기 전에도 화면은 떠야 한다
    return g.defaultChances;
  }
}

/** 게임별 기회 횟수 전부 — { morning: n, evening: n } */
export async function allChances(db) {
  const entries = await Promise.all(
    GAME_KEYS.map(async (key) => [key, await chancesFor(db, key)]),
  );
  return Object.fromEntries(entries);
}

/** 기회 횟수를 저장한다. 값 검사는 부르는 쪽에서 끝내고 온다. */
export function setChancesStatements(db, game, chances) {
  return [
    db
      .prepare(
        `INSERT INTO game_config (game, chances) VALUES (?, ?)
         ON CONFLICT(game) DO UPDATE
           SET chances = excluded.chances, updated_at = datetime('now')`,
      )
      .bind(gameOf(game).key, chances),
  ];
}

/** 기회를 쓰는 게임인지 */
export function usesChances(game) {
  return GAMES[gameOf(game).key].useChances === true;
}
