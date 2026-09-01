# 🕕 퇴근시간 맞히기

플레이어 3명이 운영자 1명의 **오늘 퇴근시간**을 맞히는 모바일 웹 게임.
정답과 가장 가까운 시간을 부른 사람이 우승하고, 우승 횟수가 누적돼 랭킹에 반영됩니다.

Cloudflare **Workers (정적 에셋) + D1** 로만 동작합니다. 전부 무료 티어 안에서 돌아가고,
빌드 도구 없이 순수 HTML / CSS / JS 로 되어 있습니다.

---

## 게임 규칙

| | |
|---|---|
| 참가자 | 플레이어 3명 + 운영자 1명 (각자 계정으로 로그인) |
| 예측 | 플레이어는 하루에 한 번, `HH:MM` 으로 퇴근시간을 예측 |
| 수정 | 정답이 공개되기 전까지 몇 번이든 수정 가능 |
| 비공개 | 정답 공개 전에는 **아무에게도** 남의 예측이 보이지 않음 (운영자에게도) |
| 정답 | 운영자가 실제 퇴근시간을 등록하면 그 즉시 오차·우승자 확정 |
| 우승 | 오차(분)가 가장 작은 사람. 동점이면 공동 우승 |
| 랭킹 | 우승 횟수 순, 동률이면 평균 오차가 작은 순 |

하루의 기준은 **KST(Asia/Seoul)** 입니다. 서버가 직접 KST 날짜를 계산하므로
기기의 시간대 설정과 무관하게 모두 같은 라운드를 봅니다.

## 화면

| 경로 | 설명 |
|---|---|
| `/login` | 로그인 (미로그인 상태로 다른 페이지에 가면 여기로 보냄) |
| `/` | 오늘의 게임 — 상단 실시간 시계, 예측 입력, 참가자 현황, 정답 공개 |
| `/ranking` | 누적 랭킹 + 지난 30일 기록 |
| `/admin` | 정답 등록 (운영자만 보이고, 운영자만 접근 가능) |
| `/account` | 비밀번호 변경 / 로그아웃 |

---

## 처음 배포하기

### 0. 준비

```bash
npm install
npx wrangler login
```

### 1. D1 데이터베이스 만들기

```bash
npm run db:create
```

출력에 나오는 `database_id` 를 `wrangler.toml` 의
`PASTE_YOUR_D1_DATABASE_ID_HERE` 자리에 붙여넣습니다.

### 2. 테이블 만들기

```bash
npm run db:init
```

> ⚠️ `schema.sql` 은 맨 위에서 기존 테이블을 `DROP` 합니다.
> **최초 1회만** 실행하세요. 다시 실행하면 기록이 전부 지워집니다.

### 3. 배포

```bash
npm run deploy
```

처음 배포하면 `https://<프로젝트이름>.<계정>.workers.dev` 주소가 나옵니다.

GitHub 저장소를 Cloudflare 대시보드에 연결해 두었다면 푸시할 때마다 자동 배포됩니다.
이때 실행되는 기본 배포 명령이 `npx wrangler deploy` 인데, 이 저장소가 바로 그 형태라
빌드 설정을 따로 만질 필요가 없습니다. (D1 바인딩은 `wrangler.toml` 에서 읽어 갑니다.)

### 4. 계정 만들기

계정 4개가 `seed-users.sql` 에 이미 준비돼 있습니다. 그대로 넣으면 됩니다.

```bash
npm run db:seed
```

| 아이디 | 역할 | 표시 이름 |
|---|---|---|
| `yeseo` | 플레이어 | yeseo |
| `min` | 플레이어 | min |
| `bin` | 플레이어 | bin |
| `siwon` | **운영자** | siwon |

비밀번호는 아이디와 같습니다. 각자 로그인한 뒤 `/account` 에서 바꿀 수 있습니다.

> `seed-users.sql` 에는 평문 비밀번호가 아니라 PBKDF2 해시만 들어 있습니다.
> 다만 지금 비밀번호는 아이디와 같은 짧은 문자열이라, 이 저장소에 접근할 수 있는
> 사람은 해시를 금방 되찾을 수 있습니다. 사내 4인용 게임이라 괜찮다면 그대로 쓰고,
> 신경 쓰인다면 각자 `/account` 에서 비밀번호를 바꾸는 것으로 충분합니다.

이제 `https://내앱.pages.dev` 에서 로그인하면 됩니다. 끝.

### 계정을 나중에 바꾸고 싶다면

**표시 이름·비밀번호를 다시 정하고 싶을 때** — `scripts/make-seed.mjs` 의 `USERS` 배열을
고친 뒤 시드를 다시 만들어 넣습니다. 같은 아이디는 덮어쓰기 때문에 기록은 그대로 남습니다.

```bash
npm run seed:make
npm run db:seed
```

**대화형으로 만들고 싶을 때** — `/api/setup` 엔드포인트를 쓰는 CLI 도 있습니다.
아무나 못 쓰도록 토큰을 먼저 걸어 둡니다.

```bash
npx wrangler secret put SETUP_TOKEN     # 아무 긴 랜덤 문자열
SETUP_TOKEN=방금_넣은_토큰 npm run users -- https://내앱.pages.dev
```

`SETUP_TOKEN` 을 설정하지 않으면 `/api/setup` 은 항상 503 으로 닫혀 있습니다.
시드 SQL 만 쓸 거라면 토큰은 등록하지 않아도 됩니다.

---

## 로컬에서 개발하기

```bash
npm run db:init:local              # 로컬 D1 에 테이블 생성
npm run db:seed:local              # 계정 4개 넣기
npm run dev                        # http://localhost:8788
```

`/api/setup` 까지 로컬에서 써 보려면 `cp .dev.vars.example .dev.vars` 로
`SETUP_TOKEN` 을 채운 뒤 `npm run dev` 를 다시 띄우면 됩니다.

---

## 구조

```
public/                  정적 파일 (Cloudflare 의 assets 레이어가 서빙)
  index.html               오늘의 게임
  login.html / ranking.html / admin.html / account.html
  css/style.css            모바일 우선 스타일 (다크 테마)
  js/common.js             API 호출, 상단 시계, 탭바, 로그인 가드
src/                     Worker (API)
  index.js                 진입점 — 경로/메서드 라우팅
  lib/util.js              응답·시간·비밀번호 해싱·세션 헬퍼
  lib/game.js              정답 확정 및 우승자 판정
  routes/…                 각 엔드포인트
schema.sql               D1 테이블 정의
seed-users.sql           계정 4개 시드 (해시 포함, 자동 생성됨)
scripts/make-seed.mjs    seed-users.sql 생성기
scripts/create-users.mjs 계정 생성 / 비밀번호 재설정 CLI
```

요청은 먼저 `public/` 의 정적 파일과 맞춰 보고, 맞는 파일이 없을 때만 Worker 로 넘어갑니다.
그래서 `/login` 은 `public/login.html` 로 이어지고 `/api/*` 만 `src/index.js` 가 처리합니다.

## API

인증은 `HttpOnly` 세션 쿠키로 합니다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `POST` | `/api/login` | — | 로그인 |
| `POST` | `/api/logout` | — | 로그아웃 |
| `GET` | `/api/me` | — | 현재 로그인 사용자 (미로그인이면 `user: null`) |
| `GET` | `/api/today` | 로그인 | 오늘 라운드 상태 (`?date=YYYY-MM-DD` 로 과거 조회) |
| `POST` | `/api/guess` | 플레이어 | 예측 제출/수정 |
| `GET` | `/api/ranking` | 로그인 | 누적 랭킹 |
| `GET` | `/api/history` | 로그인 | 최근 30일 기록 |
| `POST` | `/api/admin/answer` | 운영자 | 정답 등록 및 라운드 확정 |
| `DELETE` | `/api/admin/answer` | 운영자 | 정답 공개 취소 (예측은 유지) |
| `POST` | `/api/password` | 로그인 | 본인 비밀번호 변경 |
| `POST` | `/api/setup` | `SETUP_TOKEN` | 계정 생성 / 비밀번호 재설정 |

## 보안 메모

- 비밀번호는 PBKDF2-SHA256 10만 회 + 계정별 랜덤 솔트로 해싱해 저장합니다. 평문은 남지 않습니다.
- 세션 쿠키는 `HttpOnly` + `SameSite=Lax`, HTTPS 에서는 `Secure` 로 내려갑니다. 유효기간 30일.
- 로그인 실패 시 아이디 존재 여부에 따라 응답 시간이 달라지지 않도록 없는 계정에도 해싱을 수행합니다.
- 비밀번호를 바꾸면 그 계정의 모든 세션이 끊깁니다.
- 정답 공개 전 예측은 서버에서 아예 응답에 담지 않습니다. 프론트에서 가리는 방식이 아닙니다.
- `SETUP_TOKEN` 을 설정하지 않으면 `/api/setup` 은 항상 503 으로 닫혀 있습니다.

## 이 게임을 매일 하려면

운영자가 퇴근할 때 `/admin` 에서 실제 시간을 등록하면 그날 라운드가 끝납니다.
다음 날 KST 00:00 이 지나면 자동으로 새 라운드가 시작되므로, 따로 초기화할 것은 없습니다.
잘못 등록했다면 `/admin` 에서 **정답 수정**(우승자 재계산) 또는 **공개 취소**(예측 유지)를 쓰면 됩니다.
