-- 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:seed
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 닉네임/프로필/역할/비밀번호를 덮어쓴다.

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', '🐣', 'player', 'b7b73c692ddc1c07c2b3a5d9a09ec5ae6d9a52c83d0973052140c43eb6469c2a', '90bed330c60cdf180aa1e1ef738b99b7')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('min', 'min', '🐤', 'player', 'cc4f07eff687ddea6d329a4f73f7db6f7861c34ee8d3cb050ed0847f2006d0a2', '489d6a0360690fb3d412124cb9848b1b')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('bin', 'bin', '🐥', 'player', '3a3a17f2280249ed379da9cb832c37a9ab0d65c64f26eef62c27bafab7e31b62', 'adc45380590a37eaac97eed79471dc17')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('siwon', 'siwon', '🔑', 'admin', '0ed320a911d78162f4f141fb32163579293d237566e985e102803edc42aefcde', '455f0f6165255ea777ccc391de266cf6')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
