#!/usr/bin/env node
// 계정 5개(플레이어 2명 + 게임별 출제자 2명 + 운영자 1명)를 만들거나
// 비밀번호를 재설정하는 스크립트.
//
//   SETUP_TOKEN=... node scripts/create-users.mjs http://localhost:8788
//   SETUP_TOKEN=... node scripts/create-users.mjs https://toigeun-game.pages.dev
//
// 이미 있는 아이디면 이름/역할/비밀번호를 덮어씁니다.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, env, exit } from 'node:process';

const baseUrl = (argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = env.SETUP_TOKEN;

if (!token) {
  console.error('환경변수 SETUP_TOKEN 이 필요합니다.');
  console.error('예) SETUP_TOKEN=abc123 node scripts/create-users.mjs https://내앱.pages.dev');
  exit(1);
}

// 닉네임은 한글/영문/숫자 10글자 이내, 프로필은 한 글자(이모지 가능)
//   setter: 'morning'  오전 게임 출제자 — 이 사람의 기상시간을 맞힌다
//   setter: 'evening'  오후 게임 출제자 — 이 사람의 퇴근시간을 맞힌다
//   role: 'admin'      게임에 참여하지 않는 운영자
const SETTER_LABEL = { morning: '오전 출제자', evening: '오후 출제자' };

const DEFAULTS = [
  { username: 'player1', displayName: '플레이어1', avatar: '🐣', role: 'player' },
  { username: 'player2', displayName: '플레이어2', avatar: '🐤', role: 'player' },
  { username: 'morning', displayName: '오전출제자', avatar: '🌅', role: 'player',
    setter: 'morning' },
  { username: 'evening', displayName: '오후출제자', avatar: '🌆', role: 'player',
    setter: 'evening' },
  { username: 'admin', displayName: '운영자', avatar: '🔑', role: 'admin' },
];

const rl = createInterface({ input: stdin, output: stdout });
const users = [];

console.log(`\n대상 서버: ${baseUrl}`);
console.log('엔터만 누르면 괄호 안의 기본값을 사용합니다.\n');

for (const d of DEFAULTS) {
  const label = d.role === 'admin' ? '운영자' : SETTER_LABEL[d.setter] ?? '플레이어';
  console.log(`── ${label} (${d.username})`);

  const username = (await rl.question(`  아이디 (${d.username}): `)).trim() || d.username;
  const displayName =
    (await rl.question(`  닉네임 · 한글/영문/숫자 10글자 이내 (${d.displayName}): `)).trim() ||
    d.displayName;
  const avatar =
    (await rl.question(`  프로필 글자 · 한 글자, 이모지 가능 (${d.avatar}): `)).trim() || d.avatar;

  let password = '';
  while (password.length < 3) {
    password = (await rl.question('  비밀번호 (3자 이상): ')).trim();
    if (password.length < 3) console.log('  ! 3자 이상 입력해 주세요.');
  }

  users.push({ username, displayName, avatar, role: d.role, setter: d.setter ?? null, password });
  console.log('');
}

rl.close();

const res = await fetch(`${baseUrl}/api/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-setup-token': token },
  body: JSON.stringify({ users }),
});

const data = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`\n실패 (${res.status}): ${data.error ?? '알 수 없는 오류'}`);
  exit(1);
}

console.log('\n✅ 계정 준비 완료');
for (const u of data.users) {
  const label = u.role === 'admin' ? '운영자     ' : SETTER_LABEL[u.setter] ?? '플레이어   ';
  console.log(`   ${label} ${u.username} — ${u.avatar} ${u.displayName}`);
}
console.log(`\n${baseUrl}/login 에서 로그인해 보세요.\n`);
