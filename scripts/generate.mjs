#!/usr/bin/env node
// schema.sql / seed-users.sql / src/lib/seed.js 를 한 번에 만든다.
//
//   npm run generate
//
// 테이블 정의는 src/lib/schema.js, 계정 목록은 아래 USERS 가 원본이다.
// 비밀번호 해싱은 src/lib/util.js 의 hashPassword() 와 같은 방식이어야 한다.
//   PBKDF2-SHA256 / 100,000회 / 32바이트
//   솔트는 16바이트 랜덤을 hex 문자열로 만든 뒤 그 "문자열"을 UTF-8 로 인코딩해 사용

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SCHEMA_STATEMENTS } from '../src/lib/schema.js';

const ITERATIONS = 100_000;

// 아이디와 비밀번호가 같은 계정 5개.
// displayName(닉네임)과 avatar(프로필 한 글자)는 로그인 후 각자 바꿀 수 있는 초기값이다.
//   role: 'admin'      게임에 참여하지 않는 운영자
//   setter: 'morning'  오전 게임 출제자 — 이 사람의 기상시간을 맞힌다
//   setter: 'evening'  오후 게임 출제자 — 이 사람의 퇴근시간을 맞힌다
// 출제자는 자기 게임에만 빠지고 다른 게임에는 평범한 플레이어로 참가한다.
const USERS = [
  { username: 'yeseo', displayName: 'yeseo', avatar: '🐣', role: 'player', password: 'yeseo' },
  { username: 'min',   displayName: 'min',   avatar: '🐤', role: 'player', password: 'min',
    setter: 'morning' },
  { username: 'bin',   displayName: 'bin',   avatar: '🐥', role: 'player', password: 'bin' },
  { username: 'siwon', displayName: 'siwon', avatar: '🚪', role: 'player', password: 'siwon',
    setter: 'evening' },
  { username: 'admin', displayName: '운영자', avatar: '🔑', role: 'admin',  password: 'admin' },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
  return { hash, salt };
}

const seeded = USERS.map((u) => {
  const { hash, salt } = hashPassword(u.password);
  const { password, ...rest } = u;
  return { ...rest, setter: u.setter ?? null, hash, salt };
});

const banner = (what) => `-- 기상 · 퇴근시간 맞히기 · ${what}\n-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것\n`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ---- schema.sql ---- */
writeFileSync(
  'schema.sql',
  [
    banner('테이블 정의'),
    '-- 적용: npm run db:init',
    '-- 전부 IF NOT EXISTS 라 여러 번 실행해도 기존 데이터는 그대로다.',
    '',
    SCHEMA_STATEMENTS.map((s) => `${s};`).join('\n\n'),
    '',
  ].join('\n'),
);

/* ---- seed-users.sql ---- */
writeFileSync(
  'seed-users.sql',
  [
    banner('계정 시드'),
    '-- 적용: npm run db:seed',
    '-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.',
    '-- 같은 아이디가 이미 있으면 닉네임/프로필/역할/비밀번호를 덮어쓴다.',
    '-- 게임별 출제자는 마지막의 game_setters 로 지정한다.',
    '',
    seeded
      .map((u) =>
        [
          `INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)`,
          `VALUES (${q(u.username)}, ${q(u.displayName)}, ${q(u.avatar)}, ${q(u.role)}, ${q(u.hash)}, ${q(u.salt)})`,
          `ON CONFLICT(username) DO UPDATE SET`,
          `  display_name  = excluded.display_name,`,
          `  avatar        = excluded.avatar,`,
          `  role          = excluded.role,`,
          `  password_hash = excluded.password_hash,`,
          `  password_salt = excluded.password_salt;`,
        ].join('\n'),
      )
      .join('\n\n'),
    '',
    '-- 게임별 출제자 (게임마다 한 명)',
    seeded
      .filter((u) => u.setter)
      .map((u) =>
        [
          `INSERT INTO game_setters (game, user_id)`,
          `SELECT ${q(u.setter)}, id FROM users WHERE username = ${q(u.username)}`,
          `ON CONFLICT(game) DO UPDATE SET`,
          `  user_id    = excluded.user_id,`,
          `  updated_at = datetime('now');`,
        ].join('\n'),
      )
      .join('\n\n'),
    '',
  ].join('\n'),
);

/* ---- src/lib/seed.js (부트스트랩 엔드포인트가 사용) ---- */
writeFileSync(
  'src/lib/seed.js',
  [
    '// 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것',
    '// 비밀번호 평문은 들어 있지 않다 (PBKDF2-SHA256 10만회 해시).',
    '',
    `export const SEED_USERS = ${JSON.stringify(seeded, null, 2)};`,
    '',
  ].join('\n'),
);

console.log('생성 완료: schema.sql, seed-users.sql, src/lib/seed.js');
const SETTER_LABEL = { morning: '오전 출제자', evening: '오후 출제자' };
for (const u of seeded) {
  const label = u.role === 'admin' ? '운영자     ' : SETTER_LABEL[u.setter] ?? '플레이어   ';
  console.log(`  ${label} ${u.username} — ${u.avatar} ${u.displayName}`);
}
