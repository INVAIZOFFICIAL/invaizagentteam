# Sprint 2 구현 프롬프트

CLAUDE.md와 기존 Sprint 1 코드(src/agents/base/)를 참고해서 Sprint 2를 구현해라.

## 구현할 파일

### 나미 에이전트 (콘텐츠 자동화)
- src/agents/nami/nami.personality.ts
- src/agents/nami/NamiAgent.ts
- src/agents/nami/tasks/crawlCompetitor.ts
- src/agents/nami/tasks/generateQoo10Content.ts
- src/agents/nami/tasks/analyzePerformance.ts

### 상디 에이전트 (시장 인텔리전스)
- src/agents/sanji/sanji.personality.ts
- src/agents/sanji/SanjiAgent.ts
- src/agents/sanji/tasks/crawlMarket.ts
- src/agents/sanji/tasks/trackCompetitors.ts
- src/agents/sanji/tasks/sendBriefing.ts

### cron 작업
- src/cron/jobs/dailyBriefing.ts
- src/cron/jobs/contentGenerate.ts
- src/cron/scheduler.ts 업데이트

### 노션 DB
- src/notion/databases/contentDb.ts

## 핵심 규칙
1. BaseAgent 상속 필수
2. 환경변수는 @/config/env 경유
3. Claude API 호출 시 cache_control ephemeral 적용
4. 한글 주석
5. cron 중복 실행 방지 lock 구현
6. robots.txt 미확인 크롤링 금지

## 완료 조건
npm run typecheck 와 npm run lint 가 모두 통과해야 한다.
완료되면 반드시 아래를 출력해라:
<promise>SPRINT 2 COMPLETE</promise>
