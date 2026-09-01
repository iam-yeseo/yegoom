-- 퇴근시간 맞히기 · 계정 시드
-- 자동 생성됨: npm run generate — 직접 고치지 말고 scripts/generate.mjs 를 고칠 것

-- 적용: npm run db:seed
-- 비밀번호는 PBKDF2-SHA256 10만회로 해싱돼 있어 이 파일에 평문은 없다.
-- 같은 아이디가 이미 있으면 이름/역할/비밀번호를 덮어쓴다.

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('yeseo', 'yeseo', 'player', 'aeef0a1d54052939433e33cbc62b5a0215af2c294fbc7242247161294d000359', '7e6d5a3252d559578a875e357afa7943')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('min', 'min', 'player', 'f7ec1cb99bb7f0e7dc8d9f0e925434db04731295d1321fbbb14cfd314432779b', 'ec8036a9985e3fa7f9326b616f04e669')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('bin', 'bin', 'player', 'ad98d52d6de433267f2bd560922dc23383657c0c13118821fc81e152f279f4ae', 'b4b347f40f2d6904d98af448fc44c256')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

INSERT INTO users (username, display_name, role, password_hash, password_salt)
VALUES ('siwon', 'siwon', 'admin', 'c5bd2aa4c0d47b98c80a3f36c4c8fbe16b30fe7898be4ec83a75c63300d0965b', '7832a75fa08ac46d87759196acee2a75')
ON CONFLICT(username) DO UPDATE SET
  display_name  = excluded.display_name,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
