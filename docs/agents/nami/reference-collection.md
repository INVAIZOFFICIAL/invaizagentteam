# 🍊 나미 레퍼런스 수집 정의서 (v0)

> **코드가 진실 공급원(source of truth)**. 이 문서는 현재 설정의 스냅샷.
> 설정을 바꿀 때는 먼저 이 문서를 보고 → **§7 편집 방법** 따라 해당 파일 수정 →
> 여기 숫자·리스트·버전 섹션을 동기화한다.
>
> **마지막 업데이트**: 2026-04-16 (v0 최초 작성)

---

## 1. 누구에게서 수집하나 — 시드 계정 (총 21개)

업종·언어 분포 **목표**: 마케팅 30% / 생산성 20% / 창업 20% / 창작자 15% / 커머스 10% / 기타 5%, 한국어 70% + 영어 30%.

**현재 상태**: 한국어 21건 / 영어 0건 — 영어 시드 확장 예정.

### 마케팅·브랜딩 (8건)
| 핸들 | 메모 |
|---|---|
| @storyteller_jhk | 17.9K · 스토리텔링·브랜딩 |
| @iboss_official | 아이보스 공식 · 7.2K · 마케팅 실무 |
| @mijeongyun_kr | 더마그넷 · 마케팅 전략·브랜드 성장 |
| @viral.marketing.lab | 바이럴 마케팅 연구소 |
| @jin.92jin | 바이럴 마케팅 기본 원칙 |
| @humanmedia_official | 휴먼미디어그룹 · 바이럴·블로그 |
| @rise_c1 | 온라인 바이럴·인플루언서 |
| @unclejobs.ai | AI 콘텐츠 마케팅 프롬프트 |

### 생산성·1인기업 (3건)
| 핸들 | 메모 |
|---|---|
| @lecor_txt | 르코 Text Influencer · 1만+ |
| @solopreneur_octo | 솔로프레너 · 바이럴 메시지 설계 |
| @nyandy | 트렌드·생산성·AI 요약형 |

### 창업·스타트업 (5건)
| 핸들 | 메모 |
|---|---|
| @dongwoo_ha | 예비 창업자 팁·정부 지원 |
| @aeri.heo | 창업 지원금·예비창업패키지 |
| @lawhoonhoon2 | 법학자훈훈 · 창업·법률 |
| @andytechcan | 테크 창업·글로벌 전략 |
| @nmsvc2024 | 초기 스타트업 실패·BM 가이드 |

### 창작자·콘텐츠 (2건)
| 핸들 | 메모 |
|---|---|
| @action_exploration | 시설업 창업 경험담 |
| @threadsight.xyz | 스레드 뉴스·메타 분석 |

### 커머스·셀러 (3건)
| 핸들 | 메모 |
|---|---|
| @sell.info | 스마트스토어 초보자 가이드 |
| @limonsparkk | Etsy 한국 셀러 가입·재고 관리 |
| @kodeok.kr | KODEOK · 뷰티 커머스·리테일 |

**편집**: [`src/agents/nami/seedAccounts.ts`](../../../src/agents/nami/seedAccounts.ts) — `THREADS_SEED_ACCOUNTS` 배열.
자동 편입 규칙(학습 루프)은 §5.

---

## 2. 무엇을 수집하나 — 포스트 선정 기준

수집 단계에서 포스트별로 다음을 모두 만족해야 저장됨.

| 기준 | 현재값 | 근거 |
|---|---|---|
| 작성 시각 최대 나이 | **36시간** | 03:00 크롤이 어제 00:00~현재분을 커버하는 안전 마진 |
| 최소 engagement (좋아요+댓글+리포스트) | **20** | 초저반응 스팸·일기형 제거 |
| 로그인 필요 여부 | 공개 프로필만 | 로그인 벽 감지 시 해당 계정 스킵 |
| 본문 존재 여부 | 필수 | 미디어 전용 포스트·빈 텍스트는 제외 |

**편집**: [`src/agents/nami/teams/research/collectReferences.ts`](../../../src/agents/nami/teams/research/collectReferences.ts)
- `MIN_TOTAL_ENGAGEMENT` (현재 `20`)
- `MAX_POST_AGE_HOURS` (현재 `36`)

---

## 3. 어떻게 수집하나 — 파이프라인 (맥미니 cron)

```
매일 03:00  ▶ collectReferences
           │ Playwright (Chrome UA, ko-KR, 시드 간 5초)
           │ 시드 계정 공개 프로필 방문 → DOM 추출
           │ (좋아요·댓글·리포스트·공유·timestamp·permalink·본문)
           │ 
           ▼
           ▶ classifyPostsBatch (Claude Code CLI, 일 1회)
           │ 후킹유형 / 업종 / 언어 / 배울 점 분류
           │
           ▼
           ▶ saveToKnowledgeBase (Notion API)
             지식 베이스 DB '레퍼런스콘텐츠' 카테고리로 저장

매일 06:00  ▶ curateMorningReport
           │ 지식 베이스 조회 (어제 00:00~지금 수집분)
           │ Engagement score 정렬 + 다양성 제약
           │ TOP 10 선정 (§5 참조)
           │
           ▼
           ▶ 노션에 "🍊 오늘의 레퍼런스 — YYYY-MM-DD" 페이지 생성
             (NOTION_PARENT_PAGE_ID 아래)

매일 07:00  ▶ deliverMorningReport
             #콘텐츠팀-나미 채널에 TOP 3 미리보기 + 노션 페이지 링크
```

**robots.txt 포지션**: threads.com robots.txt는 `ClaudeBot·GPTBot·Scrapy` 등 자동화 봇을 명시 차단, 일반 Chrome UA는 대상 명시 없음. 우리는 **일반 브라우저 UA + 인간적 속도(시드 간 5초)** 로 공개 페이지만 방문 — 개인 리서처가 수동으로 훑는 것과 기술·트래픽 패턴상 동등. **법적 안전판**으로는 Threads Graph API `threads_keyword_search` Advanced Access 신청을 병행 (§8).

**편집**:
- 크롤 딜레이: `INTER_ACCOUNT_DELAY_MS` (현재 `5000ms`)
- User-Agent: `CHROME_UA` 상수
- cron 시각: [`src/cron/cronConfig.ts`](../../../src/cron/cronConfig.ts) — `DAILY_03`, `DAILY_06`, `DAILY_07`

---

## 4. 무엇을 저장하나 — 노션 포맷

### DB 위치
지식 베이스 DB (`NOTION_KNOWLEDGE_DB_ID`), `카테고리 = 레퍼런스콘텐츠`.

### 속성 (필터·정렬용)
| 속성 | 타입 | 예시 |
|---|---|---|
| 이름 | Title | `[나미] 레퍼런스 — @storyteller_jhk — <언젠간 닥쳐올…>…` |
| 카테고리 | Select | `레퍼런스콘텐츠` 고정 |
| 수집자 | Select | `nami` |
| 상태 | Select | `Raw`(기본) → 활용 시 `활용됨` |
| 신뢰도 | Select | `1차자료` |
| 수집일 | Date | `2026-04-16` |
| 한줄요약 | rich_text | 본문 첫 180자 |
| 원본URL | URL | Threads permalink |
| 태그 | multi_select | `후킹:인사이트선언형` `업종:창작자` `언어:한국어` `score:113` `seed:마케팅` |

### 페이지 본문 (읽기용, 가독성 우선 순서)
```
## 본문
(원문 전체)

──── divider ────

## 배울 점
(Claude 분류 결과 — 역직구 셀러 콘텐츠에 응용할 포인트)

──── divider ────

## 메타 정보
- 작성자: @handle (시드: 업종)
- 작성시각: ISO
- 링크: permalink
- 지표: ❤ X · 💬 X · 🔁 X · ↗ X · Score N
- 분류: 후킹 · 업종 · 언어
```

**편집**: 본문 포맷은 [`src/agents/nami/teams/research/collectReferences.ts`](../../../src/agents/nami/teams/research/collectReferences.ts) `saveReference()`.

---

## 5. 어떻게 TOP 10을 고르나 — 큐레이션 룰

### Engagement score
`score = likes + reposts × 3 + replies × 2`
- 공유(shares)는 현재 score에 미반영 (Threads 공유 수치 0이 대부분)

### 다양성 제약
- **업종 최대**: 한 업종 3건까지
- **작가 최대**: 한 작가 1건까지
- 10개 못 채우면 제약 완화해서 보충

### 학습 루프 (향후)
- 나미가 실제 활용한 레퍼런스 → 상태 `활용됨` 전환 → 해당 작성자 가중치↑
- 2주 동안 `활용됨` 0건인 시드는 자동 후순위 (※ 미구현, v1 계획)

**편집**: [`src/agents/nami/teams/research/curateMorningReport.ts`](../../../src/agents/nami/teams/research/curateMorningReport.ts)
- `TOP_N` (현재 `10`)
- `MAX_PER_TOPIC` (현재 `3`)
- `MAX_PER_AUTHOR` (현재 `1`)
- score 가중치는 [`collectReferences.ts`](../../../src/agents/nami/teams/research/collectReferences.ts) `engagementScore()`

---

## 6. 어떻게 배달하나 — 07:00 아침 리포트

### 디스코드 메시지 포맷 (#콘텐츠팀-나미)
```
🍊 오늘의 레퍼런스 — 2026-04-16

어제~오늘 수집 N건 중 TOP 10 나미가 골랐어 — 숫자가 말해주잖아.
🔗 전체 리포트: (노션 페이지 URL)

미리보기 TOP 3

1. @handle · score 123 · 창작자 · 인사이트선언형
> 본문 120자 미리보기…
(permalink)

2. ...
3. ...
```

### 수집 실패·부족 시
"오늘은 재료가 부족해. 기다려줘." 로 대체 발송.

**편집**: [`src/agents/nami/teams/research/deliverMorningReport.ts`](../../../src/agents/nami/teams/research/deliverMorningReport.ts)

---

## 7. 편집 방법 (어디서 뭐를 바꾸나)

| 바꾸고 싶은 것 | 파일 | 상수·위치 |
|---|---|---|
| 시드 계정 추가/제거 | `src/agents/nami/seedAccounts.ts` | `THREADS_SEED_ACCOUNTS` 배열 |
| 수집 최소 engagement | `src/agents/nami/teams/research/collectReferences.ts` | `MIN_TOTAL_ENGAGEMENT` |
| 포스트 최대 나이 | 동일 | `MAX_POST_AGE_HOURS` |
| 계정 간 크롤 딜레이 | 동일 | `INTER_ACCOUNT_DELAY_MS` |
| Chrome User-Agent | 동일 | `CHROME_UA` |
| 본문 markdown 포맷 | 동일 `saveReference()` | body 템플릿 문자열 |
| TOP N 개수 | `src/agents/nami/teams/research/curateMorningReport.ts` | `TOP_N` |
| 업종/작가 다양성 최대 | 동일 | `MAX_PER_TOPIC`, `MAX_PER_AUTHOR` |
| 큐레이션 페이지 노션 위치 | 동일 | `env.NOTION_PARENT_PAGE_ID` |
| 디스코드 메시지 문구 | `src/agents/nami/teams/research/deliverMorningReport.ts` | `lines` 빌드 |
| 배달 채널 | `src/config/env.ts` + `.env.local` | `DISCORD_CHANNEL_NAMI` |
| cron 시각 (03/06/07) | `src/cron/cronConfig.ts` | `CRON.DAILY_03/06/07` |
| cron 등록 on/off | `src/cron/jobs/namiReferences.ts` | `registerNamiReferenceJobs()` |

**변경 후 체크**
1. `npm run typecheck` 통과
2. `npm run lint` 통과
3. `./node_modules/.bin/tsx scripts/test-collect-one.ts @handle` 로 단일 계정 스모크 테스트 (선택)
4. 맥미니에 배포 (`git push` → 맥미니 pull)
5. 이 문서의 **§1 현재 상태·목록**, **§2 기준값**, **§5 상수**, **마지막 업데이트** 섹션 동기화

---

## 8. 병행 작업 — Threads API Advanced Access 신청

현재 Playwright 스크래핑 경로는 법적 회색지대. 장기적으로 공식 API 이관 목표.
- 엔드포인트: `threads_keyword_search` Advanced Access
- 요건: Meta App Review + Business Verification (예상 1~4주)
- 승인 시: Playwright 제거 → `threads_keyword_search` 호출로 교체 (rate limit 7일 500 쿼리 = 일 70건)
- 진행 상태: **미신청** (담당자 배정 필요)

---

## 9. 변경 이력

| 일자 | 버전 | 변경 |
|---|---|---|
| 2026-04-16 | v0 | 최초 정의서 작성. 시드 21개, 수집 기준 20/36h, TOP 10/업종3/작가1. |

