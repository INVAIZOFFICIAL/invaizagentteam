# 나미 콘텐츠 생성·발행 구현 — 세션 프롬프트

> "나미 콘텐츠 생산 구현 시작하자" 하면 이 문서를 먼저 읽고 바로 구현 시작.
> 기획은 완료됨. 이 세션은 코드 구현만.

---

## 선읽기 필수 (순서대로)

1. `docs/agents/nami/content-production.md` — **확정 정의서. 모든 결정의 근거.**
2. `docs/agents/nami/playbook.md` — 타겟·메시지·KPI·톤
3. `src/agents/nami/tasks/collectReferences.ts` — 레퍼런스 수집 구조 파악
4. `src/agents/nami/tasks/curateMorningReport.ts` — 큐레이션 패턴 파악
5. `src/notion/databases/contentDb.ts` — 현재 콘텐츠 DB 스키마
6. `src/notion/databases/performanceDb.ts` — 성과 DB 스키마
7. `src/threads/client.ts` — Threads API (읽기+쓰기 구현 상태 확인)
8. `src/claude/client.ts` — runClaude() 사용법
9. `src/cron/scheduler.ts` — cron 등록 패턴

---

## 구현할 파일 4개 + 수정 2개

### 신규 생성

#### 1. `src/agents/nami/tasks/generateThreadsPost.ts`

**역할**: 매일 새벽 cron 진입점. 초안 2건 생성 후 Discord 보고.

**핵심 로직**:
- 레퍼런스 DB에서 TOP 레퍼런스 조회 (score 높은 순, 어제~오늘 수집분)
- 성과 DB에서 잘 된 기존 발행물 조회 (상위 N건)
- runClaude()로 초안 2건 생성
  - systemPrompt: NAMI_PERSONALITY + 레퍼런스 문체 패턴 주입
  - **AI 말투 방지**: 레퍼런스 실제 문장 예시를 프롬프트에 포함
  - 출력: `{ title, content, hookCopy }` × 2
- Discord `#콘텐츠팀-나미`에 2건 동시 전송

**프롬프트 설계 핵심** (AI 말투 방지):
```
참고 레퍼런스 문체 예시:
[실제 레퍼런스 텍스트 3~5개 발췌]

위 문체의 특징:
- 문장이 짧고 끊김
- 숫자·구체적 사례 먼저
- 설명 최소화, 독자가 생각하게 둠

이 스타일로 역직구 셀러 관점의 포스트를 작성해.
AI가 쓴 것처럼 보이면 안 돼.
```

---

#### 2. `src/agents/nami/tasks/submitForApproval.ts`

**역할**: Discord 메시지 수신 → 나미가 아이데이션·수정 참여 → OK 시 노션 저장.

**핵심 로직**:
- Discord 메시지 파싱 (수정 요청 / 아이데이션 / OK 판단)
- OK가 아니면: runClaude()로 수정안 생성 + Discord 재보고
  - 나미가 레퍼런스·성과 데이터 근거로 의견 제시
  - 단순 수정 기계가 아닌 콘텐츠 파트너
- OK이면: `saveContentToNotion()` 호출 (발행예정일시 포함)
  - 상태: '발행대기'
  - 논의 중 중간 저장 없음

---

#### 3. `src/agents/nami/tasks/publishThread.ts`

**역할**: 발행대기 항목 중 발행예정일시 도달한 것 → Threads 자동 발행.

**핵심 로직**:
- 콘텐츠 DB에서 `상태=발행대기` + `발행일≤now` 조회
- 이미지 있으면 미디어 업로드 후 포함, 없으면 텍스트만
- Threads Graph API로 발행
- 발행 성공: 상태 `발행완료` + 발행URL 업데이트
- Discord에 발행 완료 알림

**포스트 간격 체크**: 직전 발행 시각과 3시간 이상 차이 없으면 홀드.

---

#### 4. `src/agents/nami/tasks/measurePerformance.ts`

**역할**: 발행 후 5일간 매일 성과 수집 → 성과 DB 저장.

**핵심 로직**:
- 콘텐츠 DB에서 `상태=발행완료` + `발행일≥5일전` 조회
- 각 포스트 `fetchPostInsights()` 호출
- 성과 DB upsert (날짜별로 여러 스냅샷 가능)
- 5일 경과 포스트는 수집 스킵

---

### 기존 파일 수정

#### 5. `src/notion/databases/contentDb.ts`

- `ContentDbEntry`에 `imageUrl?: string` 추가
- `saveContentToNotion()`에서 이미지 files 속성 처리 추가
- `publishDate` → datetime 포함하도록 처리 확인

#### 6. `src/cron/scheduler.ts` + `src/cron/jobs/`

신규 cron job 3개 추가:
- `generateContent.ts` — 매일 새벽 (03:00 큐레이션 이후, 예: 04:00)
- `publishContent.ts` — 매 10분 체크 (발행대기 + 발행예정시간 도달 여부)
- `collectPerformance.ts` — 매일 1회 (예: 14:00)

---

## 구현 순서

```
1. contentDb.ts 이미지 속성 추가 (작음, 선행 필요)
2. generateThreadsPost.ts (핵심 — AI 말투 방지 프롬프트 집중)
3. submitForApproval.ts (Discord 루프)
4. publishThread.ts (Threads 발행)
5. measurePerformance.ts (성과 수집)
6. cron 등록
```

---

## 금지 사항 (CLAUDE.md 준수)

- `@anthropic-ai/sdk` import 금지 → `runClaude()` 경유만
- `ANTHROPIC_API_KEY` 참조 금지
- `process.env` 직접 접근 금지 → `env.*` 경유
- 초안 생성 중 Discord 응답 없음 처리 누락 금지 → "초안 작성 중..." 먼저 전송

---

## 성공 기준

- [ ] `npm run typecheck` 통과
- [ ] `npm run lint` 통과
- [ ] 수동 트리거로 초안 2건 Discord 전송 확인
- [ ] 텍스트 피드백 → 수정 → OK → 노션 저장 end-to-end 동작
- [ ] 발행예정일시 도달 → Threads 자동 발행 확인
- [ ] 발행 후 성과 수집 → 성과 DB 업데이트 확인

---

*작성 2026-04-17. 기획 완료 직후. 구현 준비 완료.*
