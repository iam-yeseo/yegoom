// 출제자 — 퇴근시간을 맞히는 '대상'이 되는 사람.
//
// 운영자(admin)는 정답을 등록만 하고, 출제자는 예측을 낼 수 없으며 랭킹에도
// 들어가지 않는다. 항상 한 명만 지정되도록 users.is_setter 를 한 번에 갈아 끼운다.

/** 지금 지정된 출제자. 아직 없으면 null */
export async function getSetter(db) {
  const row = await db
    .prepare(
      `SELECT id, username, display_name, avatar FROM users
        WHERE is_setter = 1 AND role = 'player' ORDER BY id LIMIT 1`,
    )
    .first();
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ?? '🙂',
  };
}

/**
 * 출제자를 한 명으로 갈아 끼운다. userId 가 null 이면 아무도 지정하지 않는다.
 * 운영자 계정은 출제자가 될 수 없다 (정답을 등록하는 쪽이라 게임이 성립하지 않는다).
 */
export function assignSetterStatements(db, userId) {
  const statements = [db.prepare(`UPDATE users SET is_setter = 0 WHERE is_setter = 1`)];
  if (userId !== null && userId !== undefined) {
    statements.push(
      db.prepare(`UPDATE users SET is_setter = 1 WHERE id = ? AND role = 'player'`).bind(userId),
    );
  }
  return statements;
}

/** 화면에 보여 줄 역할 이름 */
export function roleLabel(user) {
  if (user?.role === 'admin') return '운영자';
  return user?.isSetter || user?.is_setter ? '출제자' : '플레이어';
}
