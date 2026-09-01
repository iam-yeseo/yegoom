#!/usr/bin/env node
// 계정 시드 SQL 을 만든다. 비밀번호 해시를 여기서 미리 계산해 두므로
// 배포 후 SQL 한 번만 실행하면 계정이 준비된다.
//
//   node scripts/make-seed.mjs > seed-users.sql
//
// 해싱 방식은 functions/_lib/util.js 의 hashPassword() 와 정확히 같아야 한다.
//   PBKDF2-SHA256 / 100,000회 / 32바이트 / 솔트는 16바이트 랜덤을 hex 문자열로 만든 뒤
//   그 "문자열"을 UTF-8 로 인코딩해 솔트 바이트로 사용

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 100_000;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
  return { hash, salt };
}

// 아이디와 비밀번호가 같은 계정 4개
const USERS = [
  { username: 'yeseo', displayName: 'yeseo', role: 'player', password: 'yeseo' },
  { username: 'min',   displayName: 'min',   role: 'player', password: 'min' },
  { username: 'bin',   displayName: 'bin',   role: 'player', password: 'bin' },
  { username: 'siwon', displayName: 'siwon', role: 'admin',  password: 'siwon' },
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const lines = [
  '-- 퇴근시간 맞히기 · 계정 시드',
  '-- 자동 생성됨: node scripts/make-seed.mjs > seed-users.sql',
  '-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.',
  '-- 같은 아이디가 이미 있으면 이름/역할/비밀번호를 덮어쓴다.',
  '',
];

for (const u of USERS) {
  const { hash, salt } = hashPassword(u.password);
  lines.push(
    `INSERT INTO users (username, display_name, role, password_hash, password_salt)`,
    `VALUES (${q(u.username)}, ${q(u.displayName)}, ${q(u.role)}, ${q(hash)}, ${q(salt)})`,
    `ON CONFLICT(username) DO UPDATE SET`,
    `  display_name  = excluded.display_name,`,
    `  role          = excluded.role,`,
    `  password_hash = excluded.password_hash,`,
    `  password_salt = excluded.password_salt;`,
    '',
  );
}

process.stdout.write(lines.join('\n'));
