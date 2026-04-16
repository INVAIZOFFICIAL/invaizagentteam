# 스프린트 플랜

**전체 구조**: Sprint 0 → Sprint 1 → Sprint 2~4 (나미 완성) → Sprint 5~7 (나머지 에이전트) → Sprint 8 (통합)
**핵심 원칙**: 나미를 첫 번째로 완전히 동작시키면서 BaseAgent 패턴을 확정. 이후 나머지 에이전트는 패턴 복제.

---

## Sprint 0 — 프로젝트 셋업 (5일)

**목표**: Discord 봇 응답 + Notion 저장 Hello World

### 작업 목록
- [ ] GitHub 레포 생성, `.gitignore` (`.env.local` 포함)
- [ ] TypeScript 5.x + ESLint + Prettier 설정, `tsconfig.json` paths 설정 (`@/*` → `src/*`)
- [ ] `src/config/env.ts` — zod 환경변수 파싱 & 검증
  ```
  DISCORD_TOKEN, DISCORD_GUILD_ID
  DISCORD_CHANNEL_LUFFY/NAMI/ZORO/USOPP/SANJI/CHOPPER
  NOTION_TOKEN, NOTION_CONTENT_DB_ID, NOTION_LEAD_DB_ID ...
  THREADS_APP_ID, THREADS_APP_SECRET, THREADS_ACCESS_TOKEN
  ※ ANTHROPIC_API_KEY는 사용하지 않음 — Claude Code CLI(Max 구독)를 spawn
  ```
- [ ] `.env.example` 작성
- [ ] `src/discord/bot.ts` — discord.js v14 Client 초기화
- [ ] `scripts/setup-discord.ts` — 7개 채널 자동 생성
- [ ] `src/notion/client.ts` — Notion API 클라이언트
- [ ] `scripts/setup-notion.ts` — 콘텐츠 DB, 성과 DB 스키마 자동 생성
- [ ] `src/claude/client.ts` — Claude Code CLI spawn 래퍼 (Max 구독 활용)
- [ ] `scripts/test-agents.ts` — Discord, Notion, Claude 연결 일괄 점검
- [ ] `package.json` 스크립트 완성 (`dev`, `build`, `dev:nami` 등)

**DoD**: `npm run test:discord` + `npm run test:notion` 통과, 봇이 Discord에서 "안녕!" 응답

---

## Sprint 1 — 공통 인프라 (BaseAgent + Discord + Notion) (10일)

**목표**: 어떤 에이전트든 올려놓을 수 있는 공통 뼈대 완성

### 타입 & 인터페이스
- [ ] `src/types/agent.types.ts` — `AgentName`, `AgentPersonality`, `TaskResult`, `ContentDraft`
- [ ] `src/types/discord.types.ts`, `notion.types.ts`, `task.types.ts`

### BaseAgent
- [ ] `src/agents/base/AgentPersonality.ts` — 인격 인터페이스 (systemPrompt, catchphrase, decisionCriteria)
- [ ] `src/agents/base/AgentMemory.ts` — 멀티턴 컨텍스트 (최근 20턴 유지)
- [ ] `src/agents/base/BaseAgent.ts`
  - `parseTask()`, `executeTask()`, `replyToDiscord()`, `saveToNotion()` 추상 메서드
  - Claude Code CLI spawn 공통 로직 (인격 프롬프트 주입)
  - 장시간 작업 시 "지금 하는 중이야..." 중간 메시지 먼저 전송

### Discord 공통
- [ ] `src/discord/channels/channelRouter.ts` — 채널 ID → 에이전트 매핑
- [ ] `src/discord/handlers/messageHandler.ts` — 메시지 수신 → 에이전트 디스패치
- [ ] `src/discord/handlers/dmHandler.ts` — 1:1 DM 처리
- [ ] `src/discord/formatters/messageFormatter.ts` — 2000자 분할, 임베드 포맷

### Notion 공통
- [ ] `src/notion/pages/pageBuilder.ts` — Markdown → Notion 블록 변환
- [ ] `src/notion/pages/reportUploader.ts` — 에이전트명 + 날짜 포함 페이지 저장

### cron 뼈대
- [ ] `src/cron/cronConfig.ts` — CRON 상수 (DAILY_06, DAILY_09, DAILY_10, HOURLY 등)
- [ ] `src/cron/scheduler.ts` — node-cron 등록 + lock 패턴 (중복 실행 방지)

### 유틸
- [ ] `src/utils/logger.ts`, `retry.ts`, `rateLimit.ts`

**DoD**: 루피 채널에 메시지 입력 → BaseAgent 상속한 더미 에이전트가 말투로 응답 + Notion 저장

---

## Sprint 2 — 나미: 레퍼런스 수집 (10일)

**목표**: Qoo10 JP + Threads 경쟁사 + Kpop 정보 자동 수집 → Notion 저장

### 나미 인격
- [ ] `src/agents/nami/nami.personality.ts`
  ```
  "숫자가 말해주잖아" 말투
  판단 기준: ROI 있나? 데이터로 검증 가능한가?
  전문 영역: 콘텐츠 전략, SEO, SNS 성과 분석
  ```
- [ ] `src/agents/nami/NamiAgent.ts` — BaseAgent 상속, 기본 메시지 핸들링

### Qoo10 JP 수집
- [ ] `src/scrapers/playwrightScraper.ts` — Playwright Stealth 브라우저 풀
- [ ] `src/agents/nami/tasks/crawlQoo10.ts`
  - Qoo10 JP Kpop 카테고리 랭킹 수집 (상품명, 가격, 판매량, 상품 설명 패턴)
  - 베스트셀러 상위 50개 정기 수집 (cron 일 1회)
  - robots.txt 확인 후 Playwright로 크롤링
  - 수집 결과 → `contentDb`에 저장

### Threads 경쟁사 수집
- [ ] `src/agents/nami/tasks/crawlThreads.ts`
  - Threads API로 Kpop/역직구 관련 키워드 검색
  - 경쟁사 계정 자동 발굴 (팔로워 수, 인게이지먼트 기준 필터링)
  - 성과 좋은 포스트 수집 (좋아요 + 댓글 + 리포스트 기준 상위)
  - Threads API 불가 영역은 Playwright 보완
  - 수집 결과 → `contentDb`에 저장

### Kpop 해외 판매 정보 수집
- [ ] `src/agents/nami/tasks/crawlKpopInfo.ts`
  - Kpop 역직구 관련 뉴스/트렌드 수집 (구글 뉴스, 커뮤니티)
  - 해외 Kpop 판매 관련 정보 (아마존, 이베이 Kpop 섹션 등)
  - 주 1회 cron 실행
  - 수집 결과 → `contentDb`에 저장

### Notion DB
- [ ] `src/notion/databases/contentDb.ts`
  - 레퍼런스 저장 스키마: 소스, URL, 수집일, 성과지표, 카테고리(Qoo10/Threads/뉴스)
  - 콘텐츠 초안 저장 스키마: 타입(스레드/블로그), 상태(초안/검토중/승인/발행), 발행일

### cron 등록
- [ ] `src/cron/jobs/namiCrawl.ts` — Qoo10 일 1회 + Kpop 정보 주 1회

**DoD**: `@나미 레퍼런스 수집해줘` → Qoo10 + Threads + Kpop 정보 수집 → Notion `콘텐츠 레퍼런스 DB`에 저장 확인

---

## Sprint 3 — 나미: 분석 + 전략 + 콘텐츠 제작 (10일)

**목표**: 수집된 레퍼런스 기반 Claude 분석 → 전략 디스코드 제시 → 초안 생성 → Notion 저장

### 분석 + 전략
- [ ] `src/agents/nami/tasks/analyzeReferences.ts`
  - 수집된 레퍼런스 Claude 분석
  - 성과 좋은 콘텐츠 패턴 도출 (형식, 주제, 키워드, 길이 등)
  - 경쟁사 포지셔닝 파악
  - 분석 결과 → Notion 저장 + Discord `#콘텐츠팀-나미` 채널에 전략안 제시
  - 사람이 Discord에서 피드백 → 전략 확정

### 콘텐츠 제작 — Threads
- [ ] `src/agents/nami/tasks/generateThreadsPost.ts`
  - 확정된 전략 기반 Threads 포스트 초안 생성
  - 형식: 훅 문장 + 본문 3~5개 포인트 + CTA
  - Kpop 제품 관련 콘텐츠 특화 (해외 구매 꿀팁, 신제품 소개 등)
  - 초안 → Notion `콘텐츠 초안 DB`에 저장 (상태: 초안)
  - Discord에 "초안 만들었어! 확인해봐" 알림

### 콘텐츠 제작 — 블로그 SEO
- [ ] `src/agents/nami/tasks/generateBlogPost.ts`
  - Qoo10 JP 상품 설명 패턴 + Kpop 트렌드 기반 SEO 글 초안 생성
  - 키워드 선정, H2/H3 구조, 내부 링크 제안 포함
  - 초안 → Notion `콘텐츠 초안 DB`에 저장 (상태: 초안)
  - Discord에 알림

### cron 등록
- [ ] `src/cron/jobs/namiGenerate.ts` — `CRON.DAILY_10` (매일 10:00 전략 기반 초안 자동 생성)

**DoD**:
- `@나미 분석해줘` → Discord에 전략안 제시 → 피드백 반영 확인
- `@나미 스레드 만들어줘` → Threads 포스트 초안 Notion 저장 + Discord 알림
- `@나미 블로그 써줘` → 블로그 초안 Notion 저장 + Discord 알림

---

## Sprint 4 — 나미: 발행 + 성과 수집 + 인사이트 (10일)

**목표**: Threads 자동 발행 + 성과 수집 + 피드백 루프 완성

### Threads 자동 발행
- [ ] `src/agents/nami/tasks/publishToThreads.ts`
  - Notion `콘텐츠 초안 DB`에서 상태가 "승인"인 항목 조회
  - Threads API로 자동 발행
  - 발행 성공 → Notion 상태 "발행완료" + 발행일 기록
  - Discord `#콘텐츠팀-나미`에 발행 알림
  - 발행 실패 시 Discord 에러 알림

### 성과 수집
- [ ] `src/agents/nami/tasks/collectPerformance.ts`
  - Threads API로 발행된 포스트 성과 수집 (좋아요, 댓글, 리포스트, 조회수)
  - Notion `성과 DB`에 자동 저장
  - cron 일 1회 실행

### 인사이트 분석
- [ ] `src/agents/nami/tasks/analyzePerformance.ts`
  - 성과 데이터 기반 Claude 분석
  - 어떤 포스트가 잘 됐는지, 왜 잘 됐는지 패턴 도출
  - 다음 전략에 반영할 인사이트 정리
  - 주 1회 Discord에 성과 리포트 발송

### Notion DB
- [ ] `src/notion/databases/performanceDb.ts` — 성과 데이터 저장 스키마

### cron 등록
- [ ] `src/cron/jobs/namiPublish.ts` — 매일 승인된 콘텐츠 자동 발행
- [ ] `src/cron/jobs/namiPerformance.ts` — 일 1회 성과 수집, 주 1회 리포트

**DoD**:
- Notion에서 초안 "승인" 처리 → Threads 자동 발행 확인
- 발행 포스트 성과가 Notion에 자동 수집됨
- 주 1회 성과 리포트 Discord 수신 확인
- 나미 전체 파이프라인 E2E 통과

---

## Sprint 5 — 상디 (시장정보 & 일일 브리핑) (10일)

**목표**: 매일 09:00 시장 브리핑 자동 발송

- [ ] `src/agents/sanji/sanji.personality.ts` + `SanjiAgent.ts`
- [ ] `src/agents/sanji/tasks/crawlMarket.ts` — 경쟁사 가격/기능 변동 감지
- [ ] `src/agents/sanji/tasks/sendBriefing.ts` — Claude 요약 → Discord 발송
- [ ] `src/cron/jobs/dailyBriefing.ts` — `CRON.DAILY_09`

**DoD**: 매일 09:00 `#시장정보-상디` 채널에 브리핑 자동 발송

---

## Sprint 6 — 조로 (리드 수집 & 콜드메일) (10일)

**목표**: 주 50건 리드 수집 + 스코어링 + 콜드메일 자동 발송

- [ ] `src/agents/zoro/zoro.personality.ts` + `ZoroAgent.ts`
- [ ] `src/agents/zoro/tasks/crawlLeads.ts` — 구글/Shopify 셀러 정보 수집
- [ ] `src/agents/zoro/tasks/scoreLeads.ts` — Claude로 A/B/C 등급 분류
- [ ] `src/agents/zoro/tasks/sendColdEmail.ts` — SendGrid 연동, 개인화 메일 발송
- [ ] `src/notion/databases/leadDb.ts`
- [ ] `src/cron/jobs/leadCrawl.ts` — `CRON.DAILY_06`

**DoD**: 주 50건 수집 + A등급 리드 콜드메일 발송 + Notion 상태 추적

---

## Sprint 7 — 우솝 + 초퍼 + 루피 (14일)

### 우솝 (DOM 분석)
- [ ] `UsoppAgent.ts` + `analyzeDom.ts` + `generateSpec.ts` + `monitorDomChanges.ts`
- [ ] Playwright DOM 추출 → 스펙 문서 생성 → Notion 저장
- [ ] `src/cron/jobs/domMonitor.ts` — 6시간 주기 변동 감지

### 초퍼 (리서치 & UT)
- [ ] `ChopperAgent.ts` + `designUtScenario.ts` + `clusterNuggets.ts` + `generateRevision.ts`
- [ ] 인터뷰 노트 → Atomic Nugget 클러스터링 → 수정안 생성

### 루피 (대장 & 중재)
- [ ] `LuffyAgent.ts` — 요청 분류 + 에이전트 라우팅 + 팀 간 충돌 중재
- [ ] `src/cron/jobs/weeklyAlignment.ts` — 매주 월 09:00 팀 얼라인먼트

**DoD**: 각 에이전트 Discord에서 기본 요청 처리 + Notion 저장 확인

---

## Sprint 8 — 통합 QA & 운영 자동화 (10일)

**목표**: 48시간 무중단 + 에이전트 간 협업 E2E 검증

- [ ] 헬스체크 — 5분 주기 ping, 무응답 시 자동 재시작 + `#루피-오류` 알림
- [ ] E2E: 상디 브리핑 → 나미 콘텐츠 전략 연계 플로우
- [ ] E2E: 루피 → 복수 에이전트 협업 지시 플로우
- [ ] Discord Rate Limit 안정화 — 메시지 큐 + 지수 백오프
- [ ] `NODE_ENV=production`에서만 cron 활성화 확인 (맥북/맥미니 중복 방지)
- [ ] 운영 매뉴얼 (`docs/`) 작성
- [ ] 48시간 무중단 운영 테스트

**DoD**: 48시간 무중단 + 전 에이전트 KPI 측정 가능

---

## 의존성 & 병렬 가능 구간

```
Sprint 0 (셋업)
    ↓
Sprint 1 (공통 인프라)
    ↓
Sprint 2 → Sprint 3 → Sprint 4  (나미 순차)
    ↓
Sprint 5, 6, 7  (나머지 에이전트 — 병렬 가능)
    ↓
Sprint 8 (통합 QA)
```

---

## 주요 리스크

| 리스크 | 대응 |
|--------|------|
| Threads API 경쟁사 데이터 제한 | 공식 API + Playwright 병행 |
| Qoo10 JP 봇 차단 | Playwright Stealth, 수집 간격 분산 |
| Claude Code 세션 컨텍스트 단절 | 태스크 단위로 쪼개서 spawn, 결과는 Notion에 누적 |
| cron 맥북/맥미니 중복 실행 | `NODE_ENV=production` 체크 |
| Threads 발행 실패 | 재시도 3회 + Discord 에러 알림 |
