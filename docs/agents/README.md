# 🏴‍☠️ 루피 사단 에이전트 문서

각 에이전트(팀) 별로 폴더가 있고, 안에 **playbook(전략·지침)** 과 필요한 경우 **운영 정의서**가 쌓인다.

## 팀별 인덱스

| 팀 | 역할 | 문서 |
|---|---|---|
| 👑 [luffy](./luffy/) | 대장 — 팀 얼라인먼트 / 주간 브리핑 | [playbook](./luffy/playbook.md) |
| 🍊 [nami](./nami/) | 콘텐츠 (Threads·Framer 블로그) | [playbook](./nami/playbook.md) · [reference-collection](./nami/reference-collection.md) |
| ⚔️ [zoro](./zoro/) | 리드 수집 · 콜드 아웃리치 | [playbook](./zoro/playbook.md) |
| 🎯 [usopp](./usopp/) | DOM 분석 · Automation API 확장 | [playbook](./usopp/playbook.md) |
| 🍳 [sanji](./sanji/) | 시장·경쟁사·레퍼런스 재료 공급 | [playbook](./sanji/playbook.md) |
| 🦌 [chopper](./chopper/) | 리서치 · 랜딩 CVR 개선 | [playbook](./chopper/playbook.md) |

## 작성 규칙

- **`playbook.md`** — 그 팀의 미션·타겟·판단기준·운영규칙·KPI. 전략 문서.
- **`{topic}.md`** — 특정 기능/파이프라인의 **운영 정의서** (예: nami의 `reference-collection.md`).
- 팀이 다루는 주제가 늘어나면 같은 폴더 안에 주제별 파일로 계속 추가.
- 모든 문서 상단에 "마지막 업데이트" 또는 변경 이력 섹션을 둔다.

## 팀 간 협업 관계

```
sanji ─재료→ nami (콘텐츠)
      ─재료→ zoro (리드)
      ─재료→ chopper (UT 소스)
      ─재료→ usopp (미지원 쇼핑몰 후보)

chopper ─인사이트→ nami, zoro, 랜딩팀

usopp ─신규 쇼핑몰 소식→ nami (콘텐츠 소재)
      └→ zoro (타겟 확장)

luffy ─주간 브리핑→ 전체  (무풍지대 탈출 100명 목표 대비 달성률)
```

## 팀 공통 톤·원칙

- `#무풍지대탈출` — 2026-06까지 DayZero B2C 사전 신청 **100명** 달성.
- "이번 주에 바람을 만드는가" 로 우선순위 평가.
- Pre-launch (실사용 불가) — "곧 출시 · 사전 신청 혜택" 톤 엄수.
- Claude Code CLI(Max 구독) 경유, `@anthropic-ai/sdk` 금지.
