-- 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: node scripts/make-seed.mjs > seed-users.sql
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 이름/역할/비밀번호를 덮어쓴다.

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', 'player', 'b6ad6e11fa953eac52fbf165e0a87a139d12b23e84311d6c68b0b5b3b65d7aca', '1f77b768470bfbbcaacb8c2d98b43d8a')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('min', 'min', 'player', '7de1bc8a96f3935aadafa5175df1f5c33dd5803aefa530cea7f37f706e3ea57f', '4b11133faa6fffa4b86f2b56e85a90d8')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('bin', 'bin', 'player', 'e1e747fc4ab77a8e870e286b6e3920c65758d5cbc93ef13beed2ecff87c8668a', 'a1ec497ec0cb658f80179bbaf3eb606d')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('siwon', 'siwon', 'admin', 'f84a0df0e86537c5b52672d4cc311922abbaba8acb8eb8b176337b59c3b913c6', '51dab4353284a66a80fd76bd69453756')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
