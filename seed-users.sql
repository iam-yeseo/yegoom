-- 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:seed
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 닉네임/프로필/역할/출제자 여부/비밀번호를 덮어쓴다.

INSERT INTO users (username, display_name, avatar, role, is_setter, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', '🐣', 'player', 0, 'f4dba3e33046ea4db478e8060746f34b024bb0f4ba69a73dcc5b940c723d53a8', 'b80ddc37d252e0ed57f508a3d4e1ebeb')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  is_setter     = excluded.is_setter,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, is_setter, password_hash, password_salt)
VALUES ('min', 'min', '🐤', 'player', 0, 'a9f90b33f8caf8429017afa7fc9c29065a322eba25545d63239532c7d64cab3d', 'beab27bafa64b5c71e671532fef99536')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  is_setter     = excluded.is_setter,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, is_setter, password_hash, password_salt)
VALUES ('bin', 'bin', '🐥', 'player', 0, '69f925d386b4de93c188ac7d34effb83debc51dfacc84e343a68d1370621655b', 'adb623b19430177edd1c588fda01c8e7')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  is_setter     = excluded.is_setter,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, is_setter, password_hash, password_salt)
VALUES ('siwon', 'siwon', '🚪', 'player', 1, 'a76f452b25048db11c9380c90ec9205b62809078498bbd2a96090ae2cc658edc', 'bd873b8058b1e26e76c4701d3186e196')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  is_setter     = excluded.is_setter,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, is_setter, password_hash, password_salt)
VALUES ('admin', '운영자', '🔑', 'admin', 0, 'e48ec4c65c5cb45fce22fdfe842d3a9bb555ace29d745c660dd237b36cedd19f', '3bc70448693dcec8c3b36d194d9ba732')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  is_setter     = excluded.is_setter,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
