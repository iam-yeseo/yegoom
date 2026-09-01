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

// 아이디와 비밀번호가 같은 계정 4개
const USERS = [
  { username: 'yeseo', displayName: 'yeseo', role: 'player', password: 'yeseo' },
  { username: 'min',   displayName: 'min',   role: 'player', password: 'min' },
  { username: 'bin',   displayName: 'bin',   role: 'player', password: 'bin' },
  { username: 'siwon', displayName: 'siwon', role: 'admin',  password: 'siwon' },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
  return { hash, salt };
}

const seeded = USERS.map((u) => {
  const { hash, salt } = hashPassword(u.password);
  const { password, ...rest } = u;
  return { ...rest, hash, salt };
});

const banner = (what) => `-- 퇴근시간 맞히기 · ${what}\n-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것\n`;
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
    '-- 같은 아이디가 이미 있으면 이름/역할/비밀번호를 덮어쓴다.',
    '',
    seeded
      .map((u) =>
        [
          `INSERT INTO users (username, display_name, role, password_hash, password_salt)`,
          `VALUES (${q(u.username)}, ${q(u.displayName)}, ${q(u.role)}, ${q(u.hash)}, ${q(u.salt)})`,
          `ON CONFLICT(username) DO UPDATE SET`,
          `  display_name  = excluded.display_name,`,
          `  role          = excluded.role,`,
          `  password_hash = excluded.password_hash,`,
          `  password_salt = excluded.password_salt;`,
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
for (const u of seeded) {
  console.log(`  ${u.role === 'admin' ? '운영자  ' : '플레이어'} ${u.username} — ${u.displayName}`);
}
