-- 기상 · 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:seed
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 닉네임/프로필/역할/비밀번호를 덮어쓴다.
-- 게임별 출제자는 마지막의 game_setters 로 지정한다.

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', '🐣', 'player', '9302e6c7451e95f4c2438c04e51dcd8ff277b9b7e643ce2f5422a6baebddc4b8', '7cfdef7a32891565dbf74939ee961a2e')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('min', 'min', '🐤', 'player', '9312ae638d8c705d2f37e56bb2f47c0e6ddec7af1f05e2f09fab4f166734594e', 'd16d604eb7d9779208be3d3afc8e068e')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('bin', 'bin', '🐥', 'player', 'ef5ec378f981f709e3c6e8916cd96d08bc81361cc7b67cc8557e622865f14646', '49baf642414cba8ed43a7316992e3c0d')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('siwon', 'siwon', '🚪', 'player', 'f8463e44cdf6db7e59c810143a3eb9aecfa14d97b044239cf70af0a5a64ef801', '0e233c1920964fa95f1912724090232d')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, avatar, role, password_hash, password_salt)
VALUES ('admin', '운영자', '🔑', 'admin', 'c1733f94db0225cf37b921abafc8fe815c797dcd52cc30498fef47ac2c065dfa', '1dea4d1e0b64614a6e01e435884ee398')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  avatar        = excluded.avatar,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

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
