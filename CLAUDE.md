# CLAUDE.md — INVAIZ 루피 사단

## 1. 프로젝트 개요

원피스 캐릭터 인격을 가진 6명의 AI 에이전트(루피·나미·조로·우솝·상디·초퍼)가 디스코드를 인터페이스로, 노션을 결과 저장소로 삼아 INVAIZ DayZero의 마케팅·리서치·개발지원 업무를 24/7 자동화하는 멀티 에이전트 시스템이다.
Claude Code + cron이 실제 업무 수행 엔진이며, 각 에이전트는 고유한 캐릭터 인격과 의사결정 패턴을 가진다.

---

## 2. 기술 스택 & 빌드 명령어

### 기술 스택

| 카테고리 | 기술 |
|---|---|
| AI 엔진 | Claude Code CLI (로컬 `claude` 바이너리 spawn, Claude Max 구독 한도 활용) |
| 런타임 | Node.js 24 LTS |
| 패키지 매니저 | npm |
| 디스코드 봇 | discord.js v14 |
| 웹 스크래핑 | Puppeteer, Playwright |
| 노션 연동 | Notion MCP / `@notionhq/client` |
| 스케줄링 | node-cron (맥북 개발) / macOS crontab (맥미니 24/7) |
| 이메일 | SendGrid (`@sendgrid/mail`) 또는 Mailgun |
| 타입 검사 | TypeScript 5.x |
| 코드 품질 | ESLint + Prettier |
| 버전 관리 | Git (GitHub) |

### 명령어

```bash
# 개발 환경 설정
npm install

# 전체 에이전트 서버 실행 (Discord 봇 + cron 포함)
npm run dev

# 특정 에이전트만 실행
npm run dev:luffy        # 루피 (대장)
npm run dev:nami         # 나미 (콘텐츠)
npm run dev:zoro         # 조로 (리드수집)
npm run dev:usopp        # 우솝 (DOM분석)
npm run dev:sanji        # 상디 (시장정보)
npm run dev:chopper      # 초퍼 (리서치)

# 프로덕션 빌드
npm run build

# 프로덕션 실행 (맥미니 24/7)
npm start

# 타입 검사
npm run typecheck

# 린트
npm run lint

# 린트 자동 수정
npm run lint:fix

# 테스트 (에이전트 단위 테스트)
npm test

# 특정 에이전트 테스트
npm test -- --grep "nami"

# cron 작업 목록 확인
npm run cron:list

# 노션 연결 테스트
npm run test:notion

# 디스코드 봇 연결 테스트
npm run test:discord
```

---

## 3. 디렉토리 구조

```
루피-사단/
├── src/
│   ├── agents/                    # 에이전트 코어
│   │   ├── base/
│   │   │   ├── BaseAgent.ts       # 모든 에이전트 공통 추상 클래스
│   │   │   ├── AgentPersonality.ts # 캐릭터 인격 인터페이스
│   │   │   └── AgentMemory.ts     # 에이전트 컨텍스트/메모리 관리
│   │   ├── luffy/
│   │   │   ├── LuffyAgent.ts      # 대장 — 팀 얼라인먼트 & 중재
│   │   │   └── luffy.personality.ts
│   │   ├── nami/
│   │   │   ├── NamiAgent.ts       # 콘텐츠 팀장
│   │   │   ├── nami.personality.ts
│   │   │   └── tasks/
│   │   │       ├── crawlCompetitor.ts
│   │   │       ├── generateThreadsPost.ts    # 스레드 발행 초안 생성
│   │   │       ├── generateBlogPost.ts       # Framer 블로그 발행 초안 생성
│   │   │       └── analyzePerformance.ts
│   │   ├── zoro/
│   │   │   ├── ZoroAgent.ts       # 리드 수집 팀장
│   │   │   ├── zoro.personality.ts
│   │   │   └── tasks/
│   │   │       ├── crawlLeads.ts
│   │   │       ├── scoreLeads.ts
│   │   │       └── sendColdEmail.ts
│   │   ├── usopp/
│   │   │   ├── UsoppAgent.ts      # DOM 분석 팀장
│   │   │   ├── usopp.personality.ts
│   │   │   └── tasks/
│   │   │       ├── analyzeDom.ts
│   │   │       ├── generateSpec.ts
│   │   │       └── monitorDomChanges.ts
│   │   ├── sanji/
│   │   │   ├── SanjiAgent.ts      # 시장 정보 팀장
│   │   │   ├── sanji.personality.ts
│   │   │   └── tasks/
│   │   │       ├── crawlMarket.ts
│   │   │       ├── trackCompetitors.ts
│   │   │       └── sendBriefing.ts
│   │   └── chopper/
│   │       ├── ChopperAgent.ts    # 리서치 팀장
│   │       ├── chopper.personality.ts
│   │       └── tasks/
│   │           ├── designUtScenario.ts
│   │           ├── clusterNuggets.ts
│   │           └── generateRevision.ts
│   │
│   ├── discord/                   # 디스코드 연동 레이어
│   │   ├── bot.ts                 # Discord 클라이언트 초기화
│   │   ├── handlers/
│   │   │   ├── messageHandler.ts  # 메시지 라우팅 → 에이전트 디스패치
│   │   │   ├── interactionHandler.ts
│   │   │   └── dmHandler.ts       # 1:1 DM 처리
│   │   ├── channels/
│   │   │   └── channelRouter.ts   # 채널 ID → 에이전트 매핑
│   │   └── formatters/
│   │       └── messageFormatter.ts # 캐릭터 말투 포맷팅
│   │
│   ├── notion/                    # 노션 연동 레이어
│   │   ├── client.ts              # Notion API 클라이언트
│   │   ├── databases/
│   │   │   ├── leadDb.ts          # 리드 DB CRUD
│   │   │   ├── contentDb.ts       # 콘텐츠 DB CRUD
│   │   │   ├── researchDb.ts      # 리서치 DB CRUD
│   │   │   └── domSpecDb.ts       # DOM 스펙 DB CRUD
│   │   └── pages/
│   │       ├── pageBuilder.ts     # 노션 페이지 블록 빌더
│   │       └── reportUploader.ts  # 보고서 자동 업로드
│   │
│   ├── cron/                      # cron 스케줄링
│   │   ├── scheduler.ts           # cron 작업 등록 & 관리
│   │   ├── jobs/
│   │   │   ├── dailyBriefing.ts   # 상디 일일 브리핑 (매일 09:00)
│   │   │   ├── weeklyAlignment.ts # 루피 주간 얼라인먼트 (매주 월 09:00)
│   │   │   ├── leadCrawl.ts       # 조로 리드 수집 (매일 06:00)
│   │   │   ├── contentGenerate.ts # 나미 콘텐츠 생성 (매일 10:00)
│   │   │   └── domMonitor.ts      # 우솝 DOM 변동 감지 (매시간)
│   │   └── cronConfig.ts          # cron 표현식 상수 관리
│   │
│   ├── claude/                    # Claude Code CLI 실행 래퍼
│   │   ├── client.ts              # `claude` CLI spawn (runClaude 함수)
│   │   └── promptBuilder.ts       # 시스템 프롬프트 빌더
│   │
│   ├── scrapers/                  # 크롤링 공통 유틸
│   │   ├── puppeteerScraper.ts
│   │   ├── playwrightScraper.ts
│   │   └── domExtractor.ts
│   │
│   ├── config/
│   │   ├── agents.config.ts       # 에이전트별 설정 (채널 ID 등)
│   │   ├── discord.config.ts
│   │   ├── notion.config.ts
│   │   └── env.ts                 # 환경변수 파싱 & 검증 (zod)
│   │
│   ├── types/
│   │   ├── agent.types.ts
│   │   ├── discord.types.ts
│   │   ├── notion.types.ts
│   │   └── task.types.ts
│   │
│   └── utils/
│       ├── logger.ts              # 구조화 로깅
│       ├── retry.ts               # API 재시도 유틸
│       └── rateLimit.ts           # API 호출 레이트 리미터
│
├── tests/
│   ├── agents/                    # 에이전트 단위 테스트
│   ├── discord/
│   ├── notion/
│   └── fixtures/                  # 테스트용 목 데이터
│
├── scripts/
│   ├── setup-discord.ts           # 채널/권한 초기 설정
│   ├── setup-notion.ts            # DB 스키마 초기 생성
│   └── test-agents.ts             # 에이전트 연결 상태 점검
│
├── docs/
│   ├── agents/                    # 각 에이전트 상세 명세
│   └── workflows/                 # 업무 플로우 다이어그램
│
├── .env.example
├── .env.local                     # 로컬 개발용 (Git 제외)
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

## 4. 코딩 컨벤션

### 파일 & 클래스 네이밍

```
에이전트 클래스:    PascalCase  → NamiAgent.ts, ZoroAgent.ts
태스크 함수:        camelCase   → crawlCompetitor.ts, scoreLeads.ts
인격 파일:          kebab-case  → nami.personality.ts
타입 파일:          camelCase   → agent.types.ts
상수 파일:          camelCase   → cronConfig.ts
```

### 에이전트 클래스 기본 패턴

```typescript
// 모든 에이전트는 BaseAgent를 상속한다
export class NamiAgent extends BaseAgent {
  readonly name = 'nami';
  readonly displayName = '나미';
  readonly personality = NAMI_PERSONALITY;

  // 디스코드 메시지 수신 → 업무 판단 → 수행 → 결과 응답
  async handleMessage(message: DiscordMessage): Promise<void> {
    const task = await this.parseTask(message.content);
    const result = await this.executeTask(task);
    await this.replyToDiscord(message, result);
    await this.saveToNotion(result);
  }
}
```

### 캐릭터 인격 정의 패턴

```typescript
// 각 에이전트의 시스템 프롬프트 핵심 — 말투와 판단 기준을 명시한다
export const NAMI_PERSONALITY: AgentPersonality = {
  systemPrompt: `
    너는 나미야. 항해사이자 콘텐츠 전략가.
    데이터 없이는 절대 움직이지 않아. "숫자가 말해주잖아"가 입버릇이야.
    ...
  `,
  decisionCriteria: ['ROI가 나오는가?', '데이터로 검증 가능한가?'],
  catchphrase: '숫자가 말해주잖아',
};
```

### 주석 규칙

```typescript
// 한글 주석 사용 (팀 내부 코드이므로)
// 에이전트 간 협업 플로우는 반드시 주석으로 흐름을 표기한다

// 나쁜 예
const result = await crawl(url); // crawl the url

// 좋은 예
// 조로가 수집한 리드를 나미 채널에 공유하기 전에 품질 필터링 실행
const filteredLeads = await scoreLeads(rawLeads);
```

### import 순서

```typescript
// 1. Node.js 내장 모듈
import path from 'path';
import fs from 'fs/promises';

// 2. 외부 패키지
import { Client, GatewayIntentBits } from 'discord.js';
import { Client as NotionClient } from '@notionhq/client';

// 3. 내부 모듈 — 절대 경로 사용 (tsconfig paths 설정)
import { BaseAgent } from '@/agents/base/BaseAgent';
import { notionClient } from '@/notion/client';

// 4. 타입 import
import type { AgentPersonality } from '@/types/agent.types';
```

### 환경변수 접근 패턴

```typescript
// 직접 process.env 접근 금지 — 반드시 config/env.ts를 통해 접근
// 나쁜 예
const token = process.env.DISCORD_TOKEN;

// 좋은 예 (zod로 검증된 타입 안전 접근)
import { env } from '@/config/env';
const token = env.DISCORD_TOKEN;
```

---

## 5. 하네스 워크플로우

### 권장 레벨: **Level 2**

이 프로젝트는 6개 에이전트 × 다수 태스크의 복잡한 멀티 에이전트 시스템이므로, Generator-Evaluator 분리를 통해 각 에이전트 구현의 품질을 검증하는 Level 2가 적합하다.

### Generator / Evaluator 역할

| 역할 | 담당 범위 |
|---|---|
| **Generator** | 각 에이전트 클래스, 태스크 함수, 디스코드/노션 연동 코드 구현 |
| **Evaluator** | 캐릭터 인격 일관성, 에이전트 간 협업 플로우, API 오류 처리, 보안(환경변수 노출 등) 검증 |

### 스프린트 단위 작업 흐름

```
Sprint 0 — 아키텍처 결정 & 프로젝트 셋업
Sprint 1 — 에이전트 코어 시스템 (BaseAgent, Discord, Notion 공통 인프라)
Sprint 2 — 나미(콘텐츠 자동화) + 상디(시장 인텔리전스)
Sprint 3 — 조로(리드 수집 & 세일즈 자동화)
Sprint 4 — 우솝(DOM 분석 & 개발지원)
Sprint 5 — 초퍼(사용자 리서치 & UT 자동화)
Sprint 6 — 통합 QA, 운영 자동화 & 안정화
```

---

## 6. 핵심 기능 구현 가이드

### 1. 캐릭터 인격 시스템 (BaseAgent)

**실행 엔진은 Claude API가 아니라 Claude Code CLI다.** 비용 최소화(= Claude Max 구독 한도 활용)를 위해 `@anthropic-ai/sdk`로 `messages.create`를 호출하지 않는다. 대신 `src/claude/client.ts`의 `runClaude()`가 로컬 `claude` CLI를 `spawn`으로 실행해 결과를 받아온다.

캐릭터 일관성은 시스템 프롬프트에서 결정된다. 각 에이전트는 `AgentPersonality.systemPrompt`를 `runClaude()`의 `systemPrompt` 옵션으로 전달하고, CLI 출력(text)을 파싱해 디스코드/노션에 반영한다.

```typescript
// src/claude/client.ts 의 runClaude()를 사용한다 — API 키/SDK 호출 금지
import { runClaude } from '@/claude/client';

const output = await runClaude(userPrompt, this.name, {
  systemPrompt: this.personality.systemPrompt,
  maxTurns: 10,
  timeoutMs: 120_000,
});
```

**금지 사항:**
- `import Anthropic from '@anthropic-ai/sdk'` — SDK 경로는 API 비용을 발생시킨다
- `process.env.ANTHROPIC_API_KEY` 참조 — 이 프로젝트는 API 키를 사용하지 않는다
- `messages.create` / `cache_control` 등 SDK 전용 옵션 — CLI에는 해당 개념이 없다 (Claude Code 내부 캐싱 자동 적용)

**프롬프트 캐싱 관련:** Claude Code CLI는 내부적으로 자동 캐싱을 수행하므로 코드에서 `cache_control`을 명시할 필요가 없다. 대신 같은 `systemPrompt`를 매 호출마다 동일하게 유지하는 것이 캐시 적중률을 높이는 방법이다.

### 2. 디스코드 메시지 → 에이전트 디스패치

채널 ID 기반으로 메시지를 해당 에이전트에 라우팅한다. `@멘션` 또는 채널 진입만으로 에이전트가 활성화된다.

```typescript
// channelRouter.ts
const CHANNEL_AGENT_MAP: Record<string, AgentName> = {
  [env.DISCORD_CHANNEL_LUFFY]:   'luffy',
  [env.DISCORD_CHANNEL_NAMI]:    'nami',
  [env.DISCORD_CHANNEL_ZORO]:    'zoro',
  [env.DISCORD_CHANNEL_USOPP]:   'usopp',
  [env.DISCORD_CHANNEL_SANJI]:   'sanji',
  [env.DISCORD_CHANNEL_CHOPPER]: 'chopper',
};
```

### 3. 노션 결과 자동 저장

모든 태스크 완료 후 `saveToNotion()`을 호출한다. 페이지 제목에 에이전트명 + 날짜를 포함시켜 검색 가능하게 한다.

```typescript
// pageBuilder.ts 사용 예시
await notionClient.pages.create({
  parent: { database_id: env.NOTION_DOM_SPEC_DB_ID },
  properties: {
    이름: { title: [{ text: { content: `[우솝] ${url} DOM 분석 — ${today}` } }] },
    상태: { select: { name: '완료' } },
    URL: { url },
  },
  children: pageBuilder.fromMarkdown(specMarkdown),
});
```

### 4. cron 스케줄 관리

`node-cron`으로 등록하되 모든 cron 표현식은 `cronConfig.ts`에 상수로 분리한다. 작업 시작/완료를 Discord 채널에 자동 알림한다.

```typescript
// cronConfig.ts
export const CRON = {
  DAILY_09:        '0 9 * * *',
  DAILY_06:        '0 6 * * *',
  WEEKLY_MON_09:   '0 9 * * 1',
  HOURLY:          '0 * * * *',
} as const;

// scheduler.ts
cron.schedule(CRON.DAILY_09, async () => {
  await sanjiAgent.runDailyBriefing();
});
```

### 5. 우솝 DOM 분석 (Puppeteer)

RPA 개발팀에 전달할 스펙 문서를 자동 생성한다. CSS 셀렉터, XPath, iframe 여부, 동적 렌더링 여부를 반드시 포함한다.

```typescript
// analyzeDom.ts 핵심 추출 항목
interface DomSpec {
  url: string;
  title: string;
  targetElements: {
    label: string;       // 예: "장바구니 버튼"
    cssSelector: string;
    xpath: string;
    isInsideIframe: boolean;
    isDynamic: boolean;  // JS 렌더링 필요 여부
    notes: string;       // 우솝 특이사항 메모
  }[];
  screenshotBase64: string;
  analyzedAt: string;
}
```

---

## 7. 주의사항 & 금지 패턴

### 환경변수 & 보안

```
금지: process.env.DISCORD_TOKEN 직접 접근 → config/env.ts 경유
금지: .env 파일 Git 커밋 → .gitignore에 .env.local 반드시 포함
금지: ANTHROPIC_API_KEY 사용 — 이 프로젝트는 Claude Code CLI(Max 구독)로만 실행한다
금지: 크롤링 결과(리드 개인정보)를 로컬 파일에 평문 저장
```

### 에이전트 인격 일관성

```
금지: 인격 프롬프트 없이 runClaude() 호출 (캐릭터 붕괴)
금지: 에이전트가 자신의 전문 영역 밖 업무를 단독 수행
       → 루피에게 DOM 분석 요청 시 "우솝한테 물어봐!" 로 리다이렉트
금지: 채널 라우팅 우회 (채널 ID 하드코딩 금지 — 반드시 config 사용)
```

### 크롤링 & 외부 API

```
금지: robots.txt 미확인 크롤링 (법적 리스크)
금지: API 레이트 리미터 없이 연속 호출 (계정 차단)
금지: Puppeteer 브라우저 인스턴스를 요청마다 새로 생성 (메모리 누수)
       → 브라우저 풀 패턴 사용
금지: 스크래핑 결과를 검증 없이 노션에 바로 업로드
```

### cron 작업

```
금지: cron 작업 중복 실행 방지 로직 없이 배포
       → 각 job에 실행 중 플래그(lock) 구현
금지: cron 실패 시 무음 처리 — 반드시 Discord 에러 채널에 알림
금지: 맥북/맥미니 양쪽에서 동일 cron 동시 실행
       → 운영 환경(맥미니)에서만 cron 활성화 (NODE_ENV=production 체크)
```

### Claude Code CLI 실행

```
금지: @anthropic-ai/sdk import 또는 messages.create 호출 (API 비용 발생, Max 한도 미활용)
금지: ANTHROPIC_API_KEY 환경변수 설정/참조
금지: src/claude/client.ts 외의 경로에서 `claude` 바이너리 직접 spawn
       → 반드시 runClaude()를 경유 (로깅/타임아웃/에러 처리 일관성)
금지: 대화 히스토리 무제한 누적 (CLI --max-turns 제한과 별개로 프롬프트 비대화 방지)
       → 최근 N턴만 유지하거나 요약 압축
금지: systemPrompt를 매 호출마다 다르게 조립 (CLI 내부 캐시 미적중)
       → 같은 에이전트는 같은 인격 문자열을 재사용
금지: 에이전트 응답을 기다리는 동안 Discord 응답 없음 처리 누락
       → 장시간 작업은 "지금 분석 중이야..." 중간 메시지 먼저 전송
```

---

## 8. Definition of Done

각 에이전트/기능이 완료되었다고 판단하는 기준:

### 에이전트 기본 요건

- [ ] 디스코드 채널에서 메시지 수신 → 해당 에이전트가 응답함
- [ ] 응답 말투가 캐릭터 인격에 맞음 (팀원 2인 이상 확인)
- [ ] 업무 수행 결과가 노션에 자동 저장됨
- [ ] 에러 발생 시 에러 내용을 캐릭터 말투로 Discord에 알림
- [ ] Claude 호출은 `runClaude()` 경유 (SDK/ANTHROPIC_API_KEY 미사용)

### 태스크 단위 요건

- [ ] 실제 타겟 URL/소스에서 정상 동작 확인
- [ ] 결과물 노션 페이지에 필수 필드(날짜, 상태, 담당 에이전트) 포함
- [ ] API 레이트 리밋 초과 시 재시도 로직 동작 확인
- [ ] 타입스크립트 오류 없음 (`npm run typecheck` 통과)
- [ ] ESLint 오류 없음 (`npm run lint` 통과)

### cron 작업 요건

- [ ] 지정 시각에 자동 실행 확인 (맥미니 환경)
- [ ] 중복 실행 방지 lock 동작 확인
- [ ] 실패 시 Discord 에러 채널 알림 확인
- [ ] `NODE_ENV=production`에서만 활성화 확인

### 통합 요건

- [ ] 루피가 타 에이전트 채널 충돌 시 중재 응답을 생성함
- [ ] 에이전트 간 정보 공유 플로우 (예: 상디 → 나미) 정상 동작
- [ ] 맥북(개발) ↔ 맥미니(운영) Git 동기화 후 동일하게 동작
