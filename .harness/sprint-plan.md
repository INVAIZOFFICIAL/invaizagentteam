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

## Sprint 2 — 나미: 레퍼런스 수집 파이프라인 ✅ 완료

**목표**: Threads 시드 계정 크롤 → 분류 → 지식 베이스 저장 → 큐레이션 → Discord 배달

### 완료된 파일
- [x] `src/agents/nami/nami.personality.ts`
- [x] `src/agents/nami/NamiAgent.ts`
- [x] `src/agents/nami/seedAccounts.ts` — 시드 계정 21개
- [x] `src/agents/nami/tasks/collectReferences.ts` — Playwright 크롤 + Claude 배치 분류
- [x] `src/agents/nami/tasks/curateMorningReport.ts` — TOP 10 선정 + Notion 페이지 생성
- [x] `src/agents/nami/tasks/deliverMorningReport.ts` — Discord `#콘텐츠팀-나미` 배달
- [x] `src/notion/databases/knowledgeDb.ts` — 지식 베이스 DB
- [x] cron: 03:00 수집 / 06:00 큐레이션 / 07:00 배달

**결과**: 매일 자동으로 레퍼런스 수집·분류·큐레이션·배달 파이프라인 가동 중

---

## Sprint 3 — 나미: 콘텐츠 생성·검수 ← **현재 위치**

**목표**: 레퍼런스 기반 초안 자동 생성 + Discord 아이데이션·검수 루프

> 정의서: `docs/agents/nami/content-production.md`
> 구현 프롬프트: `docs/prompts/nami-content-production-implement.md`

### 콘텐츠 DB 수정
- [ ] `src/notion/databases/contentDb.ts` — 이미지(files) 속성 추가

### 초안 생성
- [ ] `src/agents/nami/tasks/generateThreadsPost.ts`
  - 레퍼런스 TOP + 기존 성과 좋은 발행물 참고
  - AI 말투 방지 — 레퍼런스 실제 문체 패턴 프롬프트 주입
  - 초안 2건 생성 (T+1 발행 기준)
  - Discord `#콘텐츠팀-나미`에 2건 동시 보고

### 검수·아이데이션 루프
- [ ] `src/agents/nami/tasks/submitForApproval.ts`
  - Discord 메시지 파싱 (수정 요청 / 아이데이션 / OK 판단)
  - 나미가 레퍼런스·성과 데이터 근거로 논의 참여 (콘텐츠 파트너)
  - OK 확인 후 노션 콘텐츠 DB 저장 (발행예정일시 포함, 상태: 발행대기)
  - 논의 중 중간 저장 없음

### cron 등록
- [ ] `src/cron/jobs/generateContent.ts` — 매일 04:00 초안 자동 생성

**DoD**:
- 매일 새벽 초안 2건 Discord 자동 보고
- 텍스트 피드백 → 나미 수정·재보고 → OK → 노션 발행대기 저장 E2E 확인

---

## Sprint 4 — 나미: 발행·성과수집·학습루프 (10일)

**목표**: 자동 발행 + 5일 성과 수집 + 데이터 기반 학습 루프 완성

### 자동 발행
- [ ] `src/agents/nami/tasks/publishThread.ts`
  - 콘텐츠 DB `상태=발행대기` + `발행일≤now` 조회
  - 포스트 간 최소 3시간 간격 체크
  - 이미지 있으면 미디어 업로드 후 포함
  - Threads Graph API 자동 발행
  - 발행 성공: 상태 `발행완료` + 발행URL 업데이트 + Discord 알림

### 성과 수집
- [ ] `src/agents/nami/tasks/measurePerformance.ts`
  - 발행 후 5일간, 매일 24h 주기 수집
  - `fetchPostInsights()` 호출 → 성과 DB 저장
  - 5일 경과 포스트 자동 중단

### cron 등록
- [ ] `src/cron/jobs/publishContent.ts` — 매 10분 발행대기 체크
- [ ] `src/cron/jobs/collectPerformance.ts` — 매일 14:00 성과 수집

**DoD**:
- 발행예정일시 도달 → Threads 자동 발행 확인
- 발행 후 5일간 성과 DB 자동 업데이트 확인
- 나미 전체 파이프라인 (수집→큐레이션→초안→검수→발행→성과) E2E 통과

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
