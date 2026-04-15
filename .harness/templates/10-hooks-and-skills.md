# 10. Hooks & Skills 설계 가이드
> INVAIZ 루피 사단 — 멀티 에이전트 자동화 시스템 맞춤형

---

## 개요: 3가지 확장 메커니즘

| 메커니즘 | 한 줄 설명 | 루피 사단에서의 역할 |
|----------|-----------|----------------------|
| **Hook** | 이벤트 발생 시 **결정적으로 실행**되는 셸 스크립트 | Discord 봇 토큰·Notion 키 유출 차단, cron 잡 충돌 방지 |
| **Skill** | LLM이 **자동으로 활성화**하는 도메인 전문성 | 캐릭터 인격 일관성 검토, 에이전트 도메인 경계 안내 |
| **Subagent** | **격리된 컨텍스트**에서 작동하는 특수 에이전트 | 6인 에이전트 병렬 검증, 크롤러 커버리지 테스트 |

> **핵심 원칙**: "Hooks는 실행을 **보장**한다; 프롬프트는 보장하지 않는다."
>
> Discord 봇 토큰 유출, Notion API 키 하드코딩, 무한루프 cron 배포는 Hook으로 반드시 방어해야 한다.

---

## Hooks — 루피 사단 필수 게이트

### Exit Code 원칙 (반드시 숙지)

| Exit Code | 의미 | 동작 |
|-----------|------|------|
| **0** | 성공 | 작업 진행 |
| **2** | 차단 에러 | **작업 중단** ← 토큰 유출·잘못된 cron 배포는 반드시 이것 |
| **1, 3+** | 비차단 경고 | 경고만 표시, 작업은 계속 진행 |

```bash
# ❌ 위험: Discord 봇 토큰이 에이전트 코드에 하드코딩되어도 그냥 실행됨
if grep -r "DISCORD_TOKEN\|Bot [A-Za-z0-9]" src/; then
    echo "토큰 감지됨"
    exit 1  # 커밋이 그대로 진행!
fi

# ✅ 안전: 토큰 하드코딩 시 커밋 차단
if grep -rE "(DISCORD_TOKEN|NOTION_KEY|SMTP_PASS)\s*[:=]\s*['\"][A-Za-z0-9._-]{20,}" src/ agents/; then
    echo "❌ API 자격증명 하드코딩 감지 — 환경변수(.env)를 사용하세요"
    exit 2  # 커밋 차단
fi
```

---

### 루피 사단 권장 Hook 목록

#### 1. API 자격증명 하드코딩 차단 (PreToolUse) — **최우선**
```bash
# .claude/hooks/block-credential-hardcode.sh
# Discord 봇 토큰, Notion API 키, SMTP 자격증명 하드코딩 시 차단
PATTERNS="DISCORD_TOKEN|NOTION_KEY|NOTION_SECRET|SMTP_PASS|SMTP_USER|Bot [A-Za-z0-9]{50}"
if grep -rE "$PATTERNS" "$FILE_PATH" 2>/dev/null | grep -v "\.env\|example\|#"; then
    echo "❌ 자격증명 하드코딩 차단 — process.env.DISCORD_TOKEN 형식을 사용하세요"
    exit 2
fi
```

#### 2. cron 표현식 유효성 검사 (PostToolUse)
```bash
# .claude/hooks/validate-cron.sh
# cron 스케줄 파일 수정 시 표현식 형식 검증
if echo "$FILE_PATH" | grep -E "(cron|schedule|jobs)" > /dev/null; then
    # 5필드 cron 표현식 존재 확인
    INVALID=$(grep -E "schedule:|cron:" "$FILE_PATH" | grep -vE "[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+")
    if [ -n "$INVALID" ]; then
        echo "⚠️ 잘못된 cron 표현식 감지 — 수정 후 배포하세요"
        exit 2
    fi
fi
```

#### 3. 에이전트 캐릭터 파일 보호 (PreToolUse)
```bash
# .claude/hooks/protect-persona.sh
# 각 에이전트의 인격 정의 파일(persona.md, character.json 등) 수정 시 경고
PERSONA_PATHS="luffy|nami|zoro|usopp|sanji|chopper"
if echo "$FILE_PATH" | grep -iE "$PERSONA_PATHS" | grep -E "(persona|character|identity)" > /dev/null; then
    echo "⚠️ 에이전트 인격 파일 수정 감지 — 캐릭터 일관성 유지 여부를 확인하세요"
    exit 1  # 경고만, 차단하지 않음
fi
```

#### 4. 크롤러 robots.txt 준수 경고 (PostToolUse)
```bash
# .claude/hooks/crawl-ethics.sh
# 크롤러 코드(나미·조로·상디) 수정 시 속도 제한·딜레이 존재 여부 확인
if echo "$FILE_PATH" | grep -E "(crawler|scraper|nami|zoro|sanji)" > /dev/null; then
    if ! grep -E "(delay|sleep|throttle|rate.?limit)" "$FILE_PATH" > /dev/null; then
        echo "⚠️ 크롤러 속도 제한 코드 없음 — IP 차단 위험. delay/sleep 추가를 권장합니다"
        exit 1  # 경고만
    fi
fi
```

---

### Hook 설계 주의사항 (루피 사단 특수 사항)

- **cron 재귀 방지**: Hook 자체가 cron으로 실행되는 환경에서, Hook이 무한루프를 유발하지 않도록 `$CLAUDE_HOOK_ACTIVE` 환경변수로 중복 실행 차단
- **6개 에이전트 독립성**: 한 에이전트 Hook이 다른 에이전트 파일을 수정하지 않는지 경로 필터링으로 격리
- **노션 API Rate Limit**: 노션 쓰기 Hook은 초당 3회 이내로 제한 (429 에러 방지)
- **Discord 재연결 보호**: 봇 프로세스 재시작 Hook은 기존 연결 종료 확인 후 실행

---

## Skills — 루피 사단 권장 Skill

> **컨텍스트 예산**: Skill description 합산 ~2% 공유. **4개 이내** 유지.

### 1. 에이전트 인격 일관성 Skill
```yaml
# .claude/skills/character-consistency.md
---
name: character-consistency
description: >
  루피·나미·조로·우솝·상디·초퍼 각 에이전트의 말투, 의사결정 패턴, 업무 도메인 경계를
  검토합니다. 에이전트 응답 로직, 프롬프트 템플릿, 캐릭터 정의 파일 수정 시 활성화합니다.
allowed-tools: Read, Grep
---
```

**활성화 시나리오**: "나미 응답 스타일 바꾸고 싶어요", "루피가 팀 중재를 거부하는 케이스 추가", "초퍼가 너무 딱딱하게 말해요"

**검토 기준**:
1. 각 캐릭터의 말투 톤이 원피스 원작과 일치하는가
2. 업무 도메인을 벗어난 요청 시 적절히 다른 에이전트로 위임하는가
3. 루피의 중재 로직이 다른 에이전트 로직보다 우선순위를 갖는가

---

### 2. 크롤러·스크레이퍼 안전 설계 Skill
```yaml
# .claude/skills/crawler-safety.md
---
name: crawler-safety
description: >
  나미(콘텐츠 크롤링), 조로(리드 수집), 상디(시장 정보) 에이전트의
  크롤러 안전성, 속도 제한, 차단 대응 패턴을 검토합니다.
  크롤러·스크레이퍼 코드 수정, 새 소싱처 추가, Puppeteer 로직 변경 시 활성화합니다.
allowed-tools: Read, Grep, Glob
---
```

**검토 기준**:
1. 요청 간 딜레이(1~3초 이상) 및 Rate Limit 로직 존재 여부
2. User-Agent 로테이션 또는 헤더 위장 여부
3. 크롤링 실패 시 재시도 횟수 상한 설정 여부
4. 우솝(DOM 분석)의 Puppeteer 코드에 `waitForSelector` 타임아웃 설정 여부
5. 수집 데이터에 개인정보(이메일, 연락처) 포함 시 마스킹 처리 여부

---

### 3. 디스코드 ↔ 노션 통합 패턴 Skill
```yaml
# .claude/skills/discord-notion-integration.md
---
name: discord-notion-integration
description: >
  Discord 봇 이벤트 핸들링, 명령어 파싱, Notion API 페이지·데이터베이스 쓰기 패턴을
  안내합니다. Discord 명령어 추가, Notion 저장 로직 변경, 에이전트 응답 흐름 수정 시 활성화합니다.
allowed-tools: Read, Grep
---
```

**검토 기준**:
1. Discord Slash Command vs 메시지 파싱 — 어떤 방식이 적합한가
2. Notion 데이터베이스 스키마 변경 시 기존 페이지 마이그레이션 고려 여부
3. 비동기 작업(크롤링, 메일 발송) 결과를 Discord로 알림 전송하는 패턴
4. Notion Rate Limit(초당 3회) 초과 방지 큐 처리 여부

---

### 4. 루피 중재 & 에스컬레이션 Skill
```yaml
# .claude/skills/luffy-coordination.md
---
name: luffy-coordination
description: >
  루피 에이전트의 팀 방향 충돌 감지, 중재 로직, 에스컬레이션 기준을 검토합니다.
  루피 에이전트 로직, 충돌 감지 규칙, 팀 조율 흐름 수정 시 활성화합니다.
allowed-tools: Read, Grep
---
```

**검토 기준**:
1. 충돌 감지 기준이 명확한가 (예: 동일 리소스 동시 접근, 상충 업무 지시)
2. 중재 우선순위 규칙이 하드코딩되어 있는가 (규칙 기반) vs 동적 판단인가
3. 루피 중재 실패 시 사람(직원)에게 에스컬레이션하는 경로가 있는가

---

## Subagents — 에이전트 병렬 검증 패턴

### 6인 에이전트 독립 검증
```
에이전트 공통 인프라(Discord 연결, Notion 쓰기) 변경 시
  ├── Subagent A — 나미(콘텐츠) 시나리오 검증
  ├── Subagent B — 조로(리드수집) + 상디(시장정보) 검증
  ├── Subagent C — 우솝(DOM분석) + 초퍼(리서치) 검증
  └── Subagent D — 루피(중재) 충돌 시나리오 검증
  = 병렬로 각 도메인 영향도 확인, 메인 컨텍스트 보호
```

### Worktree 격리 — 크롤러 전략 실험
```
메인 코드베이스 (안정)
    │
    └── Worktree (임시)
        ├── 새 크롤링 전략(Playwright vs Puppeteer) 시도
        ├── 성공 시 → 병합
        └── 실패 시 → 폐기 (메인 무영향)
```

**적합한 상황:**
- Puppeteer → Playwright 마이그레이션 실험
- 이메일 발송 라이브러리 교체 (nodemailer → Resend 등)
- 에이전트 프레임워크 전환 (직접 구현 → LangGraph 등)

---

## 설계 의사결정 플로우

```
이 규칙이 매번 반드시 실행되어야 하는가?
├── 예 → Hook
│   예시: Discord/Notion 토큰 하드코딩 차단, cron 표현식 검증,
│         크롤러 딜레이 누락 경고, 인격 파일 보호
│
└── 아니오
    │
    특정 도메인 전문성이 필요한가?
    ├── 예 → Skill
    │   예시: 캐릭터 일관성 검토, 크롤러 안전 패턴,
    │         Discord↔Notion 통합 안내, 루피 중재 로직
    │
    └── 아니오
        │
        메인 컨텍스트를 보호해야 하는가?
        ├── 예 → Subagent
        │   예시: 6개 에이전트 병렬 회귀 검증,
        │         새 소싱처 DOM 파서 커버리지 테스트
        │
        └── 아니오 → 메인 세션에서 직접 처리
```

---

## 실전 체크리스트

### Hook
- [ ] **Discord 봇 토큰·Notion API 키·SMTP 자격증명** 하드코딩에 `exit 2` 적용 (`exit 1` 금지)
- [ ] cron 표현식 검증 Hook이 `*/` 같은 위험 패턴(1분 이하 반복)을 경고하는가
- [ ] 크롤러 코드(나미·조로·상디·우솝) 수정 시 딜레이 누락 경고 Hook 동작 확인
- [ ] Hook 실행 시간 2초 이내 — cron 환경에서 Hook 재귀 실행 방지 확인

### Skill
- [ ] `character-consistency` Skill이 에이전트 프롬프트 수정 시 실제로 활성화되는가
- [ ] `crawler-safety` Skill description이 나미·조로·상디·우솝 파일명을 명시적으로 포함하는가
- [ ] Skill 총 **4개 이내** 유지 (컨텍스트 예산 준수)
- [ ] 새 에이전트 추가 시 해당 도메인에 맞는 Skill이 활성화되는지 테스트

### Subagent
- [ ] 6개 에이전트 병렬 검증 시 **Haiku 모델** 사용 (비용 절감)
- [ ] 각 Subagent가 다른 에이전트 검증 결과를 보지 않고 **독립 평가**하는지 확인
- [ ] 크롤러 전략 교체 실험은 반드시 Worktree 격리 후 진행
- [ ] 루피 중재 시나리오 검증은 실제 충돌 케이스 3가지 이상 포함
