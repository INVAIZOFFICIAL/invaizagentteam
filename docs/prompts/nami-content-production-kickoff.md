# 나미 콘텐츠 생성·발행 체계 정의 — 킥오프 프롬프트

> **✅ 완료 — 2026-04-17.** 6개 섹션 Q&A 완료.
> 확정 내용: `docs/agents/nami/content-production.md`
> 구현 프롬프트: `docs/prompts/nami-content-production-implement.md`

---

> 이 문서는 다음 세션에서 **나미 콘텐츠 생성·검수·발행·성과 측정** 체계를 정의하기 위한 가이드다.
> "자 이제 나미 콘텐츠 생산 체계 잡자" 라고 하면 이 문서를 먼저 읽고 바로 Q&A 시작.

---

## 왜 이 작업을 하는가

### 맥락 (2026-04-16 기준)
- INVAIZ는 **무풍지대** 안. 2026-06 까지 DayZero B2C 사전 신청 **100명** 달성이 유일한 탈출 조건.
- 약 10주 남음 → 주간 +10명 페이스.
- 나미 채널은 이 100명 중 **콘텐츠 유입(스레드 우선, 블로그 후행)** 파트를 책임진다.

### 지금 상태
- ✅ **인풋(레퍼런스 수집)** 완성: 매일 03:00 시드 21개 크롤 → 06:00 큐레이션 → 07:00 `#콘텐츠팀-나미` 배달. 정의서 `docs/agents/nami/reference-collection.md`.
- ❌ **아웃풋(콘텐츠 생성·검수·발행·성과)** 전무: 코드·정의 모두 없음.

### 이 작업의 결과물
레퍼런스를 매일 보기만 하면 의미 없다. **레퍼런스 → 우리 각도 초안 → 사용자 검수 → 발행 → 성과 측정 → 학습 루프**까지 이어져야 100명 목표가 실제 움직인다.

---

## 함께 정의해야 할 6가지

각 항목마다 1~3개 질문을 드릴 테니, 답 주시면 정의서·코드 순으로 확정해갑니다.

### 1. 후킹 템플릿 추출·관리
- 쌓인 레퍼런스에서 **후킹 템플릿 5~10개**를 뽑는 작업은 언제·누가·어떻게?
- 추출된 템플릿은 어디에 저장 (노션 DB? 코드 상수? docs?)
- 얼마나 자주 갱신?

### 2. 콘텐츠 초안 생성
- 1회 실행에 **몇 개** 생성 (주제 1개 × 3안? 주제 3개 × 1안?)
- 실행 주기 (매일 자동? 수동 트리거?)
- DayZero 핵심 메시지(품절 감시·AI 번역·사전 신청) 배치 비율 10:1 유지?
- 언어 한국어 70% / 영어 30% 유지?
- 한 초안 당 포스트 체인 길이 (1~5개)

### 3. 검수·승인 플로우 (사용자 ↔ 나미)
- 옵션 A: **디스코드 리액션** — 초안을 `#콘텐츠팀-나미`에 올리고 ✅ 승인 / 🔁 재작성 / ❌ 폐기
- 옵션 B: **노션 상태 워크플로우** — 콘텐츠 DB에 "검수대기" 상태로 큐잉, 상태 변경으로 조작
- 옵션 C: 혼합 (노션에 다 올리되 디스코드에 요약 + 승인 액션 가능)
- 재작성 요청 시 피드백 주는 방법 (이유 1줄? 구체 수정 요구?)

### 4. 발행 스케줄
- 요일·시간대 (평일 밤 10시 속설 반영?)
- 주 몇 건 (이전 playbook 기본값 5~10건)
- 발행 간격 (스팸 방지 최소 간격)
- 승인된 게 쌓이면 어떻게 큐잉·분배?

### 5. 발행 방식
- 옵션 A: **완전 자동** — 승인 즉시 Threads Graph API `threads_content_publish`로 포스팅
- 옵션 B: **반자동** — "발행 준비 완료" 알림만, 사용자가 앱에서 직접
- 옵션 C: **예약 발행** — 승인된 건 큐에 넣고 지정 시간 자동 발행
- `threads_content_publish` 권한은 이미 있나? (현재 `src/threads/client.ts`는 **읽기만** 구현)

### 6. 발행 후 성과 측정
- `fetchPostInsights()` 엔진은 있음 — 조회수·좋아요·답글·리포스트·인용 가능
- 수집 시점 (발행 +24h? +72h? +7일? 여러 번?)
- 성과 데이터 저장 위치 — 콘텐츠 DB(`NOTION_CONTENT_DB_ID`) 또는 성과 DB(`NOTION_PERFORMANCE_DB_ID`)?
- UTM 규칙으로 `dzero.run` 유입·사전 신청 귀속시키는 방법
- 성과 낮은 콘텐츠 폐기·활용 높은 템플릿 재사용 기준

---

## 작업 방식

1. **한 섹션씩 Q&A** — 1~3 답변 → 내가 요약 → 다음 섹션
2. **매 섹션 확정마다 정의서에 반영** — `docs/agents/nami/content-production.md` (신규 생성 예정)
3. **6개 섹션 모두 확정되면 구현 순서 제안** — 추정:
   - `src/agents/nami/teams/content/generateThreadsPost.ts` — 초안 생성
   - `src/agents/nami/teams/content/submitForApproval.ts` — 검수 UX
   - `src/agents/nami/teams/content/publishThread.ts` — 발행
   - `src/agents/nami/tasks/measurePerformance.ts` — 성과 수집
   - cron 추가 (생성 1회/일, 성과 수집 2~3회/일)

---

## 시작 전 선읽기 권장

- `CLAUDE.md` — 프로젝트 헌법. 특히 `금지 사항` · `Claude Code CLI 실행`
- `docs/agents/README.md` — 팀 구조·공통 원칙
- `docs/agents/nami/playbook.md` — 나미 전략 (타겟·메시지·KPI)
- `docs/agents/nami/reference-collection.md` — 인풋 파이프라인
- 메모리 자동 로드: `project_doldrums_escape`, `project_signup_goal_100`, `project_dayzero_prelaunch`
- `src/threads/client.ts` — 현재 API 구현 (읽기만)
- `src/notion/databases/contentDb.ts` — 콘텐츠 DB 스키마 (존재만 확인)

---

## 성공 기준 (이 작업이 끝났을 때)

- [ ] `docs/agents/nami/content-production.md` 정의서 존재, 6개 섹션 모두 확정값 담김
- [ ] 구현 파일 4개 (`generateThreadsPost`, `submitForApproval`, `publishThread`, `measurePerformance`) 타입체크·린트 통과
- [ ] 초안 1회 수동 트리거로 end-to-end 동작 확인
- [ ] 레퍼런스 수집 완료 → 주에 스레드 5~10건 자동 제안·승인·발행·측정 루프 돌아감
- [ ] 발행 후 성과가 콘텐츠 DB / 성과 DB에 자동 갱신
- [ ] 『이번 주 사전 신청 몇 명이 나미 콘텐츠 경유인지』 추적 가능 (UTM 또는 대체 수단)

---

*작성 2026-04-16. 레퍼런스 수집 파이프라인 완료 직후, 아웃풋 체계 착수 전.*
