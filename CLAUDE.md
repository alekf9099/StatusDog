# CLAUDE.md — StatusDog 작업 인수인계

Claude Code가 이 저장소를 열면 자동으로 읽는 파일입니다. PC나 계정이 바뀌어도 이전
대화 없이 이어서 작업할 수 있도록, 코드만 봐서는 알 수 없는 **결정과 이유, 지켜야 할
선, 남은 일**을 적어 둡니다. 기능 설명은 README가 원본이니 여기서는 반복하지 않습니다.

> 이 저장소는 **공개(PUBLIC)** 입니다. 비밀값, 웹훅 URL, 개인 이메일은 이 파일에도,
> 커밋에도, PR 설명에도 절대 적지 마세요.

## 한 줄 요약

URL을 주면 24시간 감시하고, 문제가 생기면 알리고, 무엇이 어떻게 잘못됐는지 기록하는
도구. 운영 중: https://status-dog.vercel.app · 감시 대상은 `monitors.json`
(copykiller.com, 그 apex 리다이렉트, StatusDog 자신).

## 명령어

```bash
npm install
npm test            # node --test, package.json의 test 목록에 파일을 직접 추가해야 실행됨
npm run typecheck
npm run build       # tsc + scripts/generate-roster.mjs (monitors.json을 dist/roster.data.js로 굽기)
node scripts/dev-web.mjs --port 3000   # 로컬 사이트 (build 먼저)
```

- 새 테스트 파일을 만들면 `package.json`의 `test` 스크립트 목록에 꼭 추가할 것.
- 커밋 전 `npm test`와 `npm run typecheck` 둘 다 통과시킬 것.

## 구조

- `src/` — TypeScript 엔진 (Node 20, ESM). `monitor/`(probe, discover, security, ct),
  `store/`(Upstash KV), `notify/`(웹훅), `auth/`(Google 로그인, 세션), `config/`.
- `api/` — Vercel 서버리스 함수. `api/cron/check.js`가 실제 점검 실행.
- `public/` — 정적 HTML + ES 모듈 프론트엔드, **빌드 단계 없음**.
  - `assets/locales.js` — en/ko 문구. `data-i18n` / `data-i18n-html` 속성으로 연결.
  - `assets/office/` — 오피스 화면(동물 동료). 얼굴은 Fluent Emoji 3D(MIT, Microsoft)
    WebP, 몸통·팔·앞발은 CSS로 그림.
- `test/` — node:test.

## 반드시 지킬 것

**의존성과 플랫폼 한도**
- 런타임 의존성 0개. Node 표준 모듈만 씁니다. 패키지 추가는 먼저 상의.
- Vercel Hobby는 서버리스 함수 **최대 12개**이고 이미 12개입니다. 새 엔드포인트는
  파일을 늘리지 말고 기존 함수에 `action`으로 붙이세요
  (예: `/api/admin/:action` → `/api/admin?action=:action` rewrite).
- Upstash KV 무료 한도는 하루 약 1만 명령. 점검 1회당 약 14명령입니다. 새 상태는
  별도 키 대신 기존 `UptimeEntry` 안에 넣어 명령 수를 늘리지 마세요.
- 리전은 서울(`icn1`) 고정. 미국 리전에서 재면 없는 장애가 잡혔던 이력이 있음(PR #8).

**보안**
- 감시 목록 `monitors.json`은 **일부러 커밋 파일**입니다. 사이트에 인증 없는 공개
  쓰기 창구(`POST /api/monitors` 등)를 만들지 마세요. 아무나 임의 주소를 우리 IP로
  두드리게 만들 수 있습니다. 로그인 도입 후에도 사용자 범위로 제한하고
  `normalizeCheckUrl`의 사설망 차단을 유지할 것.
- `/api/check`에는 SSRF 차단이 있습니다. 약화시키지 말 것.
- 응답 헤더는 허용 목록에 있는 것만 보고합니다. 웹훅 라벨과 오류 메시지에는 origin만
  노출하고 `redactUrls`를 거칩니다.
- 관리자: **로그인 ≠ 권한**. 권한은 `STATUSDOG_ADMIN_EMAILS`로만 판단하고, 요청마다
  다시 읽으며, 문제가 있으면 닫힌 쪽으로 실패합니다. 사고 메모 작성자 이메일은 응답에
  싣지 않습니다.
- 보안 탭(`/security`)의 결과는 소유자 전용입니다. 공개 응답(`/api/monitors` 등)에
  `security` 필드를 넣지 마세요.
- `/.env`, `/.git/HEAD` 같은 노출 파일 탐침은 대상 사이트 보안팀 승인 없이는 하지
  않기로 했습니다. 보안 탭은 밖에서 보이는 신호(헤더, 외부 스크립트, 인증서, CT 로그)만 봅니다.

**작업 방식**
- 비밀값(`CRON_SECRET`, 웹훅 URL, `GOOGLE_CLIENT_SECRET`, `STATUSDOG_SESSION_SECRET`)은
  사용자에게 **받지 않습니다**. 넣을 위치(Vercel 환경변수, Google Console, cron-job.org)와
  방법만 안내합니다.
- 머지는 사용자가 명시적으로 승인한 PR만. 기본은 `feat/...` 브랜치 → PR → 승인 → merge
  commit 방식.
- 로컬 서버를 끌 때 모든 node 프로세스를 죽이지 말고, 띄운 그 작업만 멈출 것.
- 문구를 바꾸면 en/ko 둘 다 바꿀 것(패리티 테스트가 있음). 복수형은 `{one, other}` 객체.
- 오피스 문구는 "강아지"가 아니라 "동료"(다른 동물도 있으므로).

## 설계상 일부러 그렇게 한 것

- **localStorage에 있는 것들**(브라우저에서 추가한 감시, 오피스 동료 이름·외형 변경)은
  계정이 없어서 그런 것입니다. **Google 로그인 기반 사용자 기능이 계획돼 있으니**, 저장
  위치를 바꿀 수 있게 유지하세요. `createDogOverrideStore(storage)`처럼 어댑터를 받는
  형태로 짜면, 나중에 서버 저장소로 바꾸는 것이 교체 한 번으로 끝납니다. 오피스의
  "인턴 vs 정규직" 구분도 로그인 이후 다시 볼 대상입니다.
- **하위 메뉴 점검**(`discover: true`)은 SPA 껍데기 페이지를 "정상"으로 오판하지 않도록,
  존재하지 않는 경로의 응답을 지문으로 삼아 비교합니다. 판단할 수 없으면 초록이 아니라
  `unverifiable`로 표시합니다.
- **알림은 상태가 바뀔 때만** 보냅니다(보안 탭 포함). 두 지점(서울 Vercel + GitHub
  러너)의 결과가 엇갈리면 판단을 보류합니다.

## 운영 현황

- 배포: `main`에 머지하면 Vercel이 자동 배포.
- 환경변수 **이름**(값은 Vercel에만): `CRON_SECRET`, `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  (또는 `UPSTASH_REDIS_REST_*`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `STATUSDOG_SESSION_SECRET`, `STATUSDOG_ADMIN_EMAILS`, `STATUSDOG_STALE_AFTER_MINUTES`.
- 스케줄러: GitHub Actions `monitor.yml`(15분 예약이지만 실제로는 2~5시간씩 밀림)이
  보조이고, **cron-job.org가 주 스케줄러**가 되어야 합니다.

## 남은 일 (2026-11 기준)

- [ ] **cron-job.org 설정 — 사용자가 할 일.** 아직 안 돼 있어서 실제 점검 간격이 약 3시간입니다.
      `POST https://status-dog.vercel.app/api/cron/check`, 5분마다,
      헤더 `Authorization: Bearer <CRON_SECRET>`. Test run에서 200이 나오면 완료.
      완료 후에는 저장된 점검 간격이 5분 안팎으로 줄었는지 확인할 것.
- [ ] 소유자 로그인 상태에서 `/security` 화면 실사용 확인.
- [ ] Google 로그인 기반 사용자별 감시와 설정(계획만 있음, 미착수).

## 지금까지의 흐름

PR 번호 순서대로 보면 됩니다(`gh pr list --state merged`).

- #1~#3: 엔진, 대체 페이지, 대시보드, CLI, 웹사이트.
- #4~#8: 24시간 예약 점검, 상태 전환 알림, Google Chat, 서울 리전.
- #9~#11: 한국어, 오피스(사이트마다 동료 한 명).
- #12~#18: 인증서 만료, 감시 중단 감지, 사고 기록, 통계, 상태 페이지, 두 지점 점검,
  배지와 RSS.
- #19~#23: 소유자 로그인, 사고 메모, 알림 탭, 감사에서 나온 수정, 무료로 몇 분 안에
  오는 알림.
- #24: 홈 URL 하나로 하위 메뉴 페이지까지 점검.
- #25: 소유자 전용 보안 탭.
- #26: 오피스 동물을 3D Fluent 얼굴 + 직접 그린 몸통으로 교체.
