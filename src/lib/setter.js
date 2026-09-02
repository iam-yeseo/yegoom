// 출제자 — 그 게임에서 시간을 맞히는 '대상'이 되는 사람.
//
// 게임마다 한 명씩이고, game_setters 표에 게임을 키로 적어 둔다.
// 출제자는 자기 게임에 예측을 낼 수 없고 그 게임 랭킹에도 들어가지 않지만,
// 다른 게임에는 평범한 플레이어로 참가한다 (오전 출제자도 오후 게임은 한다).

import { GAME_KEYS, gameKeyOf } from './games.js';
import { personOf } from './util.js';

const SETTER_COLUMNS = 'u.id, u.username, u.display_name, u.avatar, u.photo_version';

/** 그 게임의 출제자. 아직 없으면 null */
export async function getSetter(db, game) {
  const key = gameKeyOf(game);
  if (!key) return null;
  const row = await db
    .prepare(
      `SELECT ${SETTER_COLUMNS} FROM game_setters gs JOIN users u ON u.id = gs.user_id
        WHERE gs.game = ? AND u.role = 'player'`,
    )
    .bind(key)
    .first();
  return personOf(row);
}

/** 게임별 출제자 전부 — { morning: person|null, evening: person|null } */
export async function getSetters(db) {
  const { results } = await db
    .prepare(
      `SELECT gs.game, ${SETTER_COLUMNS} FROM game_setters gs JOIN users u ON u.id = gs.user_id
        WHERE u.role = 'player'`,
    )
    .all();

  const setters = Object.fromEntries(GAME_KEYS.map((key) => [key, null]));
  for (const row of results ?? []) setters[row.game] = personOf(row);
  return setters;
}

/**
 * 한 게임의 출제자를 갈아 끼운다. userId 가 null 이면 그 게임은 출제자 없음이 된다.
 * 운영자 계정은 출제자가 될 수 없다 (게임에 참여하지 않는 쪽이다).
 */
export function assignSetterStatements(db, game, userId) {
  const key = gameKeyOf(game);
  if (!key) return [];
  if (userId === null || userId === undefined) {
    return [db.prepare(`DELETE FROM game_setters WHERE game = ?`).bind(key)];
  }
  return [
    db
      .prepare(
        `INSERT INTO game_setters (game, user_id) VALUES (?, ?)
         ON CONFLICT(game) DO UPDATE
           SET user_id = excluded.user_id, updated_at = datetime('now')`,
      )
      .bind(key, userId),
  ];
}

/** 이 사람이 출제자를 맡고 있는 게임 목록 (없으면 빈 배열) */
export async function setterGamesOf(db, userId) {
  if (!userId) return [];
  try {
    const { results } = await db
      .prepare(`SELECT game FROM game_setters WHERE user_id = ?`)
      .bind(userId)
      .all();
    return (results ?? []).map((r) => r.game).filter((g) => GAME_KEYS.includes(g));
  } catch {
    // game_setters 가 아직 없는 예전 DB — 스키마를 옮기기 전에도 로그인은 되어야 한다
    return [];
  }
}

/** 로그인 응답에 넣을 사용자 정보 — 어떤 게임의 출제자인지까지 붙인다. */
export async function userWithSetterGames(db, user) {
  if (!user) return null;
  return { ...user, setterGames: await setterGamesOf(db, user.id) };
}
