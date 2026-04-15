# Sprint 1 Ralph Loop — 나미 에이전트 완성

## 목표
나미(NamiAgent)를 완전히 구현하여 디스코드에서 실제로 동작하는 첫 번째 에이전트를 완성한다.
BaseAgent 패턴이 나미를 통해 실전 검증된다.

## 완료 기준 (Definition of Done)
- [ ] `src/agents/nami/nami.personality.ts` — 나미 인격 정의 (시스템 프롬프트, 판단 기준, 말투)
- [ ] `src/agents/nami/NamiAgent.ts` — BaseAgent 상속, parseTask + executeTask 구현
- [ ] `src/agents/nami/tasks/crawlQoo10.ts` — Qoo10 JP Kpop 카테고리 크롤링
- [ ] `src/agents/nami/tasks/crawlThreads.ts` — Threads 경쟁사 포스트 수집
- [ ] `src/agents/nami/tasks/crawlKpopInfo.ts` — Kpop 해외 판매 관련 정보 수집
- [ ] `src/agents/nami/tasks/analyzeReferences.ts` — Claude로 레퍼런스 분석 + 전략안 생성
- [ ] `src/agents/nami/tasks/generateThreadsPost.ts` — Threads 포스트 초안 생성
- [ ] `src/agents/nami/tasks/generateBlogPost.ts` — 블로그 SEO 글 초안 생성
- [ ] `src/notion/databases/contentDb.ts` — 콘텐츠 DB CRUD
- [ ] `src/cron/jobs/namiCrawl.ts` — Qoo10 일 1회, Kpop 정보 주 1회
- [ ] `src/index.ts`에서 NamiAgent 활성화
- [ ] `npm run typecheck` 통과
- [ ] `npm run lint` 통과

## 기술 스택
- TypeScript 5.x, Node.js 24
- Playwright (크롤링, Stealth 모드)
- Claude Code CLI spawn (`src/claude/client.ts` 활용)
- Notion API (`@notionhq/client`)
- discord.js v14

## 핵심 구현 가이드

### 나미 인격 (nami.personality.ts)
```typescript
systemPrompt: `
너는 나미야. INVAIZ DayZero의 콘텐츠 전략가이자 항해사.
"숫자가 말해주잖아"가 입버릇이야.
데이터 없이는 절대 움직이지 않아. ROI가 보여야 행동해.
Kpop 역직구 콘텐츠 전문가야 — Qoo10 JP 트렌드, Threads SNS 전략 모두 꿰뚫고 있어.
일본어 Kpop 소비자 심리도 이해하고 있어.
항상 한국어로 대화하되, 필요할 때 일본어 키워드를 섞어.
`
```

### NamiAgent parseTask 로직
메시지에서 다음 액션을 파싱:
- "레퍼런스 수집" / "크롤링" → crawl 태스크
- "분석" / "전략" → analyze 태스크
- "스레드 만들어" / "포스트" → generateThreads 태스크
- "블로그 써줘" / "SEO" → generateBlog 태스크

### Qoo10 JP 크롤링 타겟
- URL: https://www.qoo10.jp/gmkt.inc/Special/Special.aspx?sid=kpop (또는 유사 URL)
- 수집 항목: 상품명, 가격, 판매량, 리뷰수, 상품 설명 패턴
- 브라우저 풀 패턴 사용 (Playwright 인스턴스 재사용)

### Threads 크롤링
- Threads API 또는 Playwright로 Kpop 관련 계정/포스트 수집
- 좋아요 + 댓글 + 리포스트 기준 상위 포스트 필터링

### Notion contentDb 스키마
레퍼런스 DB:
- 이름 (title), 소스 (select: qoo10/threads/news), URL (url), 수집일 (date), 성과점수 (number)

콘텐츠 초안 DB:
- 이름 (title), 타입 (select: threads/blog), 상태 (select: draft/review/approved/published)
- 본문 (rich_text), 키워드 (multi_select), 발행일 (date)

## 주의사항
- robots.txt 확인 후 크롤링
- 브라우저 인스턴스는 재사용 (풀 패턴)
- Claude 실행은 `src/claude/client.ts`의 runClaude() 사용 (직접 API 호출 금지)
- 환경변수는 반드시 `src/config/env.ts`의 env 객체 경유
- 모든 주석은 한글로

## 반복 작업 방식
각 이터레이션에서:
1. 미완성 파일 목록 확인 (위 완료 기준 체크박스)
2. 가장 의존성이 낮은 것부터 구현
3. `npm run typecheck`로 타입 오류 즉시 수정
4. 다음 이터레이션에서 이어서 진행

모든 체크박스가 완료되고 `npm run typecheck`가 통과하면:
<promise>SPRINT1_COMPLETE</promise>
