-- 기상 · 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:seed
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 닉네임/프로필/역할/비밀번호를 덮어쓴다.
-- 게임별 출제자는 마지막의 game_setters 로 지정한다.

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', '🐣', 'player', '464171172ed72bfbda96f4f373d161b0956f0f730902149067f5c2b2babb536f', '2ce5480db6cf43a3d26ea06690046e82')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'yeseo');

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('min', 'min', '🐤', 'player', '012b2dea13edffffaba438e4c65f80f8d34739f6da773192a1db2d50e017b24b', '7f47989341a13f3b2d3d8298f8ce1d89')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'min');

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('bin', 'bin', '🐥', 'player', '316f1c1aa2147d7b4059c685e9252a7a38ecc2899726fb608777442230f6af2c', 'ee59fe78d637b69dcab594f1fa50bcd4')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'bin');

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('siwon', 'siwon', '🚪', 'player', '25acefb9557f645f28887c77dfde8ebbb53f04dd1d294f354ae3f8367ea206e7', '633b238a604b3ed01074498f04c6e3dd')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'siwon');

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('admin', '운영자', '🔑', 'admin', 'ebd42f1bcd72fe2169485bbfa005938a2be6cb1bdce156915d552f97fb6e1540', 'ceb18733263c02a6586bd14f51b85d40')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin');

-- 게임별 출제자 (게임마다 한 명)
INSERT INTO game_setters (game, user_id)
SELECT 'morning', id FROM users WHERE username = 'min'
ON CONFLICT(game) DO UPDATE SET
  user_id    = excluded.user_id,
  updated_at = datetime('now');

INSERT INTO game_setters (game, user_id)
SELECT 'evening', id FROM users WHERE username = 'siwon'
ON CONFLICT(game) DO UPDATE SET
  user_id    = excluded.user_id,
  updated_at = datetime('now');
