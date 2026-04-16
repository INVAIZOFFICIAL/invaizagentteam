# 🕷️ 레퍼런스 프로액티브 크롤링 시스템 — 구축 프롬프트

> **이 문서의 용도**
> 이 프롬프트를 **새 Claude Code 세션**에 그대로 붙여넣어 작업을 시작한다.
> (예: `claude` 열고 "이 문서 읽고 Sprint 0 설계부터 시작해줘" 식)
>
> 이 시스템은 INVAIZ 루피 사단의 **진짜 엔진**이다 —
> 사단 4명(상디·초퍼·우솝·나미)이 각자 전문 분야의 외부 소스를
> 자동으로 수집하여 지식 베이스 DB 에 쌓는 파이프라인.
>
> **작성일**: 2026-04-16 / **작성자**: 직전 세션의 Claude

---

## 0. 작업 시작 전 체크리스트

이 프롬프트를 받은 Claude 는 구현 들어가기 전에 **반드시 아래 순서로 컨텍스트를 흡수**할 것:

1. `/Users/invaiz/Documents/develop/invaizagentteam/CLAUDE.md` 전체 정독 — 프로젝트 규칙·금지 사항
2. `docs/notion-schema.md` §1~3, §8 — 노션 DB 구조
3. `src/notion/databases/knowledgeDb.ts` — **이미 작동하는 저장 함수** (재사용 필수)
4. `src/cron/jobs/fetchThreadsComments.ts` — **기존 파이프라인 패턴** (이번 크롤러도 같은 패턴)
5. `src/notion/databases/systemMetaDb.ts` — cron 상태 추적 모듈 (재사용)
6. `src/claude/client.ts` — `runClaude()` 래퍼 (Claude API 직접 호출 금지)

그 다음 본 문서를 읽고 §8 (첫 작업 지시) 로 진입.

---

## 1. 프로젝트 컨텍스트 (필수 파악)

INVAIZ 루피 사단은 원피스 캐릭터 인격을 가진 **6명의 AI 에이전트**가 Discord 를 인터페이스로, Notion 을 결과 저장소로 삼아 INVAIZ DayZero 의 마케팅·리서치·개발지원 업무를 24/7 자동화하는 멀티 에이전트 시스템이다. Claude Code CLI + cron 이 실제 업무 수행 엔진.

### 1.1 현재까지 완성된 것

**노션 DB 5개** — `.env.local` 에 DB ID 저장 완료, 전부 Notion AI 로 생성 (B안 채택)

| DB | 역할 | ENV 변수 |
|---|---|---|
| 📝 콘텐츠 | 발행할 콘텐츠 마스터 | `NOTION_CONTENT_DB_ID` |
| 📊 콘텐츠 성과 | 시계열 성과 스냅샷 | `NOTION_PERFORMANCE_DB_ID` |
| 💬 스레드 댓글 | 사용자 반응 누적 | `NOTION_COMMENT_DB_ID` |
| 📚 지식 베이스 | **← 이번 섹션의 주 저장 대상** | `NOTION_KNOWLEDGE_DB_ID` |
| ⚙️ 시스템 운영 상태 | cron job 건강성 + 증분 기준점 | `NOTION_SYSTEM_META_DB_ID` |

**구현 완료된 모듈 (재사용 필수)**
- `src/notion/databases/knowledgeDb.ts` — `saveToKnowledgeBase()` — **절대 재구현 금지, 반드시 import 하여 호출**
- `src/notion/databases/systemMetaDb.ts` — `getJobState()` / `updateJobState()`
- `src/claude/client.ts` — `runClaude()` (Claude Code CLI spawn, Max 한도 사용)
- `src/cron/scheduler.ts` — `registerJob()` (production 에서만 cron 활성화)
- `src/utils/logger.ts` — 구조화 로깅
- `src/config/env.ts` — zod 검증된 환경변수

**기존 파이프라인 (레퍼런스 코드)**
- `src/cron/jobs/fetchThreadsComments.ts` — 증분 수집 + 중복 방지 + 시스템 메타 업데이트의 **정석 패턴**. 이번 크롤러도 동일 구조.
- `src/cron/jobs/fetchThreadsInsights.ts` — 마일스톤 기반 수집 패턴 (참고용)
- `src/threads/client.ts` — 외부 API 래퍼 패턴 (참고용)

### 1.2 기술 스택 (변경 금지)

- Node.js 24 LTS / TypeScript 5.x
- 패키지: `@notionhq/client`, `zod`, `node-cron`, `puppeteer`, `playwright`
- 빌드: `tsx` (dev), `tsc` (build)
- 노션 필드명 컨벤션: **한글 + 공백 없음** (예: `작업이름`, `마지막실행시각`)

---

## 2. 이번 섹션의 목표 (What)

사단 4명이 각자 전문 분야의 외부 소스를 **자동으로 크롤링**하여 **📚 지식 베이스 DB** 에 쌓는다.

| 에이전트 | 크롤링 대상 예시 | 지식 베이스 `카테고리` |
|---|---|---|
| **상디** (시장 정보) | 업계 뉴스, 리서치 회사 블로그, IR 자료 | `시장동향`, `경쟁사`, `데이터통계` |
| **초퍼** (사용자 리서치) | Reddit, 네이버 카페, 사용자 리뷰 플랫폼 | `사용자Quote`, `UT인사이트` |
| **우솝** (DOM/개발) | 경쟁사 웹사이트 변화 감지 | `경쟁사`, `툴리소스` |
| **나미** (콘텐츠) | 잘 쓴 스레드·블로그 레퍼런스 | `레퍼런스콘텐츠` |

**범위 밖 (이번 섹션 아님)**
- 조로의 **리드 수집** — 별도 리드 DB 사용, 다른 스프린트
- 루피의 크롤링 — 루피는 리더 역할, 수집 안 함
- 디스코드 명령어로 트리거하는 "on-demand" 모드 — 또 다른 섹션

---

## 3. 반드시 따라야 할 프로젝트 규칙 (하드 룰)

**`CLAUDE.md` 전체가 바이블이다.** 특히 이 섹션에서 관련된 것:

### 3.1 Claude 호출
- `runClaude()` **필수** — `@anthropic-ai/sdk` 직접 import 절대 금지
- `ANTHROPIC_API_KEY` 환경변수 절대 사용 금지 (Max 구독만 씀)
- `src/claude/client.ts` 외 경로에서 `claude` 바이너리 직접 spawn 금지
- 같은 에이전트는 같은 `systemPrompt` 문자열 재사용 (CLI 내부 캐시 적중률 ↑)

### 3.2 환경변수
- `process.env.*` 직접 접근 금지 — 반드시 `@/config/env.js` 경유
- 새 환경변수 추가 시 `src/config/env.ts` 의 zod 스키마 + `.env.example` + `.env.local` 모두 갱신

### 3.3 import / path alias
- 내부 모듈은 `@/` 절대 경로 사용 (예: `@/notion/client.js`)
- tsconfig paths 이미 설정됨

### 3.4 크롤링 윤리 (이 섹션 핵심)
- **robots.txt 반드시 확인** — 거부된 경로는 절대 크롤링 안 함
- User-Agent 명시: `INVAIZ-Luffy-Crawler/1.0 (https://invaiz.com)`
- 동일 도메인 요청 간 **최소 1초 delay** (소스별 조정 가능)
- 재크롤링 방지: 동일 URL 은 24시간 이내 재요청 금지

### 3.5 크롤링 결과 처리
- 스크래핑 결과 **검증 없이 노션에 바로 업로드 금지** — 최소한 제목·본문 empty 체크
- 리드 등 개인정보는 로컬 파일에 평문 저장 금지

### 3.6 cron 작업
- 맥북/맥미니 양쪽에서 동시 실행 방지 — `NODE_ENV=production` 에서만 활성화 (`scheduler.registerJob` 내부 이미 구현됨)
- 중복 실행 방지 lock 이미 `scheduler.ts` 에 구현됨 — 추가 구현 불필요

### 3.7 캐릭터 인격
- 에이전트가 자기 전문 영역 밖 업무 수행 금지 (상디가 사용자 리뷰 크롤링 X)
- 인격 시스템 프롬프트는 `*.personality.ts` 파일에 정의, `runClaude()` 호출 시 주입
- 요약·분류 결과물 말투는 각 에이전트 인격에 맞춤

---

## 4. 구현 범위 (What to build)

### 4.1 소스 관리 시스템

**반드시 Sprint 0 에서 사용자와 결정할 것**: 소스 목록을 어디서 관리하나?

두 옵션 중 선택:

**옵션 A — 새 노션 DB `🌐 크롤링 소스`**
- 필드 제안: `소스명`(title) · `URL` · `담당에이전트`(select) · `카테고리기본값`(select) · `크롤링주기`(select) · `활성화`(checkbox) · `마지막수집`(date) · `발견률`(number)
- 비개발자(사용자)가 노션에서 직접 소스 추가/비활성화 가능
- 이 프로젝트 철학 "노션=컨트롤 센터" 과 정합

**옵션 B — 코드 config 파일 `src/config/crawl-sources.ts`**
- TypeScript 상수로 소스 정의
- 버전 관리, 타입 안전
- 소스 변경 시 배포 필요 → 유연성 ↓

**추천 (이전 세션 Claude 의견)**: 옵션 A — 프로젝트 철학 정합. 단 사용자 최종 결정 필수.

### 4.2 공통 크롤러 인프라 (`src/crawler/`)

모든 에이전트가 공유할 부품:

| 파일 | 역할 |
|---|---|
| `src/crawler/robotsChecker.ts` | robots.txt 파싱·캐시·허용 여부 판정 |
| `src/crawler/fetchPage.ts` | HTTP fetch + HTML 파싱. 기본은 `fetch`, 동적 페이지는 Puppeteer 풀 사용 |
| `src/crawler/extractor.ts` | 본문 추출 (권장: `@mozilla/readability` 또는 직접 구현) |
| `src/crawler/rateLimiter.ts` | 도메인별 요청 간 최소 간격 보장 (in-memory) |
| `src/crawler/deduplicator.ts` | URL 로 지식 베이스 DB 조회 (중복 방지) — 노션 API query |
| `src/crawler/summarizer.ts` | `runClaude()` 배치 요약 + 카테고리·태그 제안. **수집된 N개를 1번 호출로 처리** (Max 한도 보호) |

### 4.3 에이전트별 크롤러 태스크

각 에이전트의 `tasks/` 디렉토리에 1개씩:

| 에이전트 | 파일 | 입력 | 출력 |
|---|---|---|---|
| 상디 | `src/agents/sanji/tasks/crawlMarketSources.ts` | 상디 담당 소스 리스트 | 지식 베이스 카드 N개 |
| 초퍼 | `src/agents/chopper/tasks/crawlUserReviews.ts` | 초퍼 담당 소스 리스트 | 지식 베이스 카드 N개 |
| 우솝 | `src/agents/usopp/tasks/monitorCompetitorDom.ts` | 우솝 담당 소스 리스트 | 지식 베이스 카드 N개 (+ DOM 변화 시만 저장) |
| 나미 | `src/agents/nami/tasks/collectContentReferences.ts` | 나미 담당 소스 리스트 | 지식 베이스 카드 N개 |

**공통 흐름** (모두 `fetchThreadsComments.ts` 패턴 따름):
```
1. 시스템 메타 DB 에서 작업 상태 조회 → 비활성화 시 스킵
2. 담당 소스 리스트 조회 (크롤링 소스 DB 또는 config)
3. 각 소스마다:
   a. robots.txt 확인 → 거부 시 스킵
   b. rate limiter 대기
   c. fetchPage → extractor → 후보 항목 리스트
   d. 각 항목의 URL 로 지식 베이스 중복 확인
   e. 신규만 모아 runClaude 로 일괄 요약·분류 (1번 호출)
   f. saveToKnowledgeBase 로 각 카드 저장
4. systemMetaDb 결과 업데이트 (마지막실행 / 가져온개수 / 에러)
```

### 4.4 cron 등록

`src/cron/jobs/crawlReferences.ts` 1개 파일에 4개 register 함수:

```ts
export function registerSanjiCrawlJob(): void { ... }     // 매일 06:00, 18:00 (2회)
export function registerChopperCrawlJob(): void { ... }   // 매일 08:00
export function registerUsoppDomMonitorJob(): void { ... }// 매시간 (DOM 변화 감지는 빈도 중요)
export function registerNamiContentRefJob(): void { ... } // 매일 20:00
```

또는 에이전트별로 파일 분리도 OK. 판단은 구현 세션에서.

`src/cron/scheduler.ts` 의 re-export 섹션에 추가 필수.

### 4.5 시스템 메타 DB 초기 row

4개 job row 를 시딩해야 함. **이미 시딩된 3개 row 와 같은 페이지에 추가**:
- `sanji_crawl_market` / 설명: "상디 시장 정보 소스 크롤링" / 주기: `0 6,18 * * *`
- `chopper_crawl_user_reviews` / 설명: "초퍼 사용자 리뷰 플랫폼 크롤링" / 주기: `0 8 * * *`
- `usopp_monitor_competitor_dom` / 설명: "우솝 경쟁사 DOM 변화 감지" / 주기: `0 * * * *`
- `nami_collect_content_refs` / 설명: "나미 레퍼런스 콘텐츠 수집" / 주기: `0 20 * * *`

시딩 스크립트 작성: `scripts/seed-crawl-meta.ts`

### 4.6 테스트 스크립트

각 에이전트 크롤러를 1회 수동 실행할 수 있는 스크립트:
- `scripts/run-crawl-sanji.ts`
- `scripts/run-crawl-chopper.ts`
- `scripts/run-crawl-usopp.ts`
- `scripts/run-crawl-nami.ts`

기존 `scripts/run-fetch-comments.ts` 와 동일한 패턴 (사전 점검 → 실행 → 사후 상태 확인).

---

## 5. 에이전트별 설계 고려사항

### 5.1 상디 (시장 정보) — 표준형

가장 전형적인 크롤러. 정적 HTML 파싱 + 새 기사 감지.
- 대부분 RSS 피드 제공하는 사이트 → `rss-parser` 라이브러리 고려
- Paywall 처리: 헤드라인 + 메타 설명만 수집 (본문 못 긁으면 가치 낮지만 존재 알림은 됨)

### 5.2 초퍼 (사용자 리뷰)

사용자 발화는 문맥이 중요 — 단순 텍스트가 아니라 **누가·언제·맥락** 같이 보관.
- Reddit: 공식 API 가 편함 (OAuth 필요)
- 네이버 카페/블로그: 네이버 검색 API 고려, 없으면 HTML 파싱
- 각 발화마다 별도 지식 베이스 카드 (`카테고리: 사용자Quote`)
- 본문에 원문 + 맥락 메모 (어느 글/어느 쓰레드에서 나왔나)

### 5.3 우솝 (DOM 모니터링) — 특이형

**목적이 다름** — 새 정보 수집이 아니라 **변화 감지**.
- 스냅샷 저장 (`src/crawler/snapshots/{url-hash}.html`) 후 다음 실행에 diff
- 변화 감지 시에만 지식 베이스 카드 생성 (`카테고리: 경쟁사`)
- Puppeteer 필수 (JS 렌더링된 경쟁사 웹사이트가 대부분)
- RPA 스펙 문서 생성은 **별도 플로우** — 이번 섹션 밖

### 5.4 나미 (콘텐츠 레퍼런스)

"이렇게 쓰고 싶다" 싶은 스레드·블로그를 자동 아카이빙.
- 특정 크리에이터 계정 모니터링 (예: 좋아하는 스레드 유저 핸들 리스트)
- Threads API 재사용 가능 (`src/threads/client.ts` 의 `fetchMyRecentThreads` 확장해서 **타 계정 조회** 지원 필요 — `threads_profile_discovery` 권한 필요)
- 또는 웹사이트 크롤링 (Threads 웹 뷰, 블로그 등)
- 본문 + 훅 분석 → 지식 베이스 카드 (`카테고리: 레퍼런스콘텐츠`)

---

## 6. Definition of Done

구현 완료로 간주하는 조건 (전부 체크):

- [ ] Sprint 0 설계 결정 사항을 **`docs/reference-crawling-spec.md`** 로 문서화 후 사용자 승인 받음
- [ ] 소스 관리 시스템 구축 (옵션 A 선택 시 노션 DB 생성 스크립트 `scripts/setup-crawl-source-db.ts` 포함)
- [ ] `src/crawler/*` 6개 모듈 전부 작성
- [ ] 4명 에이전트의 크롤러 태스크 파일 전부 작성
- [ ] `crawlReferences.ts` (또는 분리 파일들) cron job 등록
- [ ] 시스템 메타 DB 에 4개 job row 시딩 완료
- [ ] robots.txt 준수 로직이 실제 거부 케이스에서 작동 확인
- [ ] 4개 테스트 스크립트 작성
- [ ] `npm run typecheck` 통과 (0 errors)
- [ ] `npm run lint` 통과 (0 errors — 기존 warning 1개는 별개)
- [ ] 최소 **1개 에이전트의 크롤링이 실제 돌아서 지식 베이스 DB 에 1개 이상 카드 저장됨** (end-to-end 검증)
- [ ] 에러 케이스 1개 실증 (예: 404 소스 → systemMetaDb 에 "부분실패" 기록 확인)

---

## 7. 주의사항 — 만들면 안 되는 것

- **디스코드 트리거**: 크롤링 트리거는 cron 만. "@나미 크롤해줘" 같은 수동 모드는 다른 섹션.
- **콘텐츠 자동 생성**: 크롤링 결과로 스레드/블로그 글을 바로 만들면 안 됨. 지식 베이스로만 가야 함.
- **조로의 리드**: 리드 DB 는 별도, 이번 섹션 건드리지 말 것.
- **콘텐츠 성과 DB**: 기존 파이프라인 건드리지 말 것.
- **Threads API 답글 작성**: `threads_manage_replies` 권한 사용 금지 — 이번 섹션은 순수 read-only 입력 파이프라인.

---

## 8. 첫 작업 지시 — 이 프롬프트를 받은 Claude 에게

이 문서를 다 읽고 §0 체크리스트의 6개 파일을 모두 흡수한 뒤:

### 8.1 Sprint 0 — 설계 대화 먼저 시작

사용자에게 다음 3가지 질문을 던짐 (한 번에 하나씩, 답변 기다림):

1. **소스 관리 방식**: 옵션 A (노션 DB) vs 옵션 B (코드 config)?
2. **초기 크롤링 소스**: 각 에이전트당 최소 2~3개 URL. 사용자가 아직 소스 리스트 없으면 함께 브레인스토밍.
3. **크롤링 주기**: 제안 (상디 일 2회 / 초퍼 일 1회 / 우솝 매시간 / 나미 일 1회) 그대로 OK? 조정?

### 8.2 기획서 작성 → 승인

Sprint 0 답변 받은 뒤 `docs/reference-crawling-spec.md` 작성:
- 확정된 설계 결정 사항
- 각 에이전트 크롤러의 상세 스키마 (입력·출력·처리 단계)
- 소스 관리 DB 스키마 (옵션 A 시)
- 시스템 메타 row 상세
- 에러 처리 전략

→ 사용자 "좋다/수정" 피드백 대기. 이 프로젝트는 **기획서 먼저, 코드 나중** 룰을 철저히 따름.

### 8.3 Sprint 1 ~ 3 진행 순서

1. **Sprint 1 — 공통 인프라** (반나절)
   - `src/crawler/*` 6개 모듈 전부 작성
   - 단위 테스트 가능한 모듈은 `tests/` 에 최소 테스트 추가
   - robots.txt 체커는 실제 robots 파일로 테스트

2. **Sprint 2 — 에이전트별 크롤러** (반나절~하루)
   - 상디 → 초퍼 → 우솝 → 나미 순서
   - 각 에이전트 `personality.ts` 의 systemPrompt 를 `runClaude()` 호출에 주입
   - 에이전트별 `scripts/run-crawl-{agent}.ts` 테스트 스크립트로 검증하며 진행

3. **Sprint 3 — 통합** (1~2시간)
   - cron job 등록 + scheduler re-export
   - 시스템 메타 row 시딩 (`scripts/seed-crawl-meta.ts`)
   - end-to-end 검증 (실제 소스에서 카드 1개 저장)
   - 에러 케이스 1개 실증

각 Sprint 끝나면 사용자에게 진행 상황 보고 + 다음 Sprint 진입 전 확인.

---

## 9. 참고 — 작업 리듬

이 프로젝트의 사용자 협업 스타일:
- **대화 기반 설계** — 한 번에 큰 덩어리 말고, 결정 포인트마다 물어봄
- **한국어** 필수 (코드·변수명·주석은 영어 OK, 사용자 커뮤니케이션은 한국어)
- **사용자가 이미 알려준 프로젝트 사실을 추측으로 메우지 않기** (과거 마찰 사례 있음)
- **작업 단위 작게** — 기획 → 승인 → 구현 → 검증 → 다음 단계
- 타입체크·린트는 **매 단계마다** 실행해서 0 error 유지

---

## 10. 완료 후

이 섹션이 완료되면 다음에 이어질 작업:
- **댓글 분류 cron** (`comments_classification` — 이미 시스템 메타에 시딩됨)
- **Threads/Blog 콘텐츠 생성 태스크** (`generateThreadsPost.ts` / `generateBlogPost.ts`)
- **디스코드 봇 연결** + 수동 트리거 명령어
- **조로 리드 수집 섹션** (별도 스프린트)

이번 섹션이 끝나면 사단의 "입력 파이프라인"이 완성되고, 그 다음은 "출력 파이프라인"(콘텐츠 생성)과 "상호작용 레이어"(디스코드 봇 심화)로 진행.

---

**끝. 이 프롬프트를 받은 Claude 는 §0 체크리스트부터 시작할 것.**
