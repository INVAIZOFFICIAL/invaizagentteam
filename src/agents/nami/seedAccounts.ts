// Threads 레퍼런스 수집 seed 계정 리스트 v0
//
// 업종 분포 기준: 마케팅 30% / 생산성 20% / 창업 20% / 창작자 15% / 커머스 10% / 기타 5%
// 언어 기본값: 한국어 70% + 영어 30%
//
// 이 리스트는 "잘된 포스트 작성자 자동 편입" 로직으로 점진적으로 확장됨.
// 초기 계정은 WebSearch 기반 발견 — 팔로워·활동성 실측 후 튜닝 대상.

export type ReferenceCategory =
  | '마케팅'
  | '생산성'
  | '창업'
  | '창작자'
  | '커머스'
  | '기타';

export type ReferenceLanguage = '한국어' | '영어';

export interface ThreadsSeedAccount {
  handle: string; // 예: '@storyteller_jhk'
  url: string; // 전체 threads.com 프로필 URL
  category: ReferenceCategory;
  language: ReferenceLanguage;
  note?: string; // 팔로워·특성 메모 (튜닝용)
  addedAt: string; // ISO date — 편입 기록
}

export const THREADS_SEED_ACCOUNTS: ThreadsSeedAccount[] = [
  // ─────────── 마케팅·브랜딩 (30%) ───────────
  {
    handle: '@storyteller_jhk',
    url: 'https://www.threads.com/@storyteller_jhk',
    category: '마케팅',
    language: '한국어',
    note: '17.9K · 스토리텔링·브랜딩',
    addedAt: '2026-04-16',
  },
  {
    handle: '@iboss_official',
    url: 'https://www.threads.com/@iboss_official',
    category: '마케팅',
    language: '한국어',
    note: '아이보스 공식 · 7.2K · 마케팅 실무',
    addedAt: '2026-04-16',
  },
  {
    handle: '@mijeongyun_kr',
    url: 'https://www.threads.com/@mijeongyun_kr',
    category: '마케팅',
    language: '한국어',
    note: '더마그넷 · 마케팅 전략·브랜드 성장',
    addedAt: '2026-04-16',
  },
  {
    handle: '@viral.marketing.lab',
    url: 'https://www.threads.com/@viral.marketing.lab',
    category: '마케팅',
    language: '한국어',
    note: '바이럴 마케팅 연구소',
    addedAt: '2026-04-16',
  },
  {
    handle: '@jin.92jin',
    url: 'https://www.threads.com/@jin.92jin',
    category: '마케팅',
    language: '한국어',
    note: '바이럴 마케팅 기본 원칙',
    addedAt: '2026-04-16',
  },
  {
    handle: '@humanmedia_official',
    url: 'https://www.threads.com/@humanmedia_official',
    category: '마케팅',
    language: '한국어',
    note: '휴먼미디어그룹 · 바이럴·블로그 마케팅',
    addedAt: '2026-04-16',
  },
  {
    handle: '@rise_c1',
    url: 'https://www.threads.com/@rise_c1',
    category: '마케팅',
    language: '한국어',
    note: '온라인 바이럴·인플루언서 마케팅',
    addedAt: '2026-04-16',
  },
  {
    handle: '@unclejobs.ai',
    url: 'https://www.threads.com/@unclejobs.ai',
    category: '마케팅',
    language: '한국어',
    note: 'AI 콘텐츠 마케팅 프롬프트',
    addedAt: '2026-04-16',
  },

  // ─────────── 생산성·1인기업 (20%) ───────────
  {
    handle: '@lecor_txt',
    url: 'https://www.threads.com/@lecor_txt',
    category: '생산성',
    language: '한국어',
    note: '르코 Text Influencer · 4개월 3.3K→1만+',
    addedAt: '2026-04-16',
  },
  {
    handle: '@solopreneur_octo',
    url: 'https://www.threads.com/@solopreneur_octo',
    category: '생산성',
    language: '한국어',
    note: '솔로프레너 · 바이럴 메시지 설계',
    addedAt: '2026-04-16',
  },
  {
    handle: '@nyandy',
    url: 'https://www.threads.com/@nyandy',
    category: '생산성',
    language: '한국어',
    note: '트렌드·생산성·AI 요약형',
    addedAt: '2026-04-16',
  },

  // ─────────── 창업·스타트업 (20%) ───────────
  {
    handle: '@dongwoo_ha',
    url: 'https://www.threads.com/@dongwoo_ha',
    category: '창업',
    language: '한국어',
    note: '예비 창업자 팁·정부 지원',
    addedAt: '2026-04-16',
  },
  {
    handle: '@aeri.heo',
    url: 'https://www.threads.com/@aeri.heo',
    category: '창업',
    language: '한국어',
    note: '창업 지원금·예비창업패키지',
    addedAt: '2026-04-16',
  },
  {
    handle: '@lawhoonhoon2',
    url: 'https://www.threads.com/@lawhoonhoon2',
    category: '창업',
    language: '한국어',
    note: '법학자훈훈 · 창업·정부 지원 법률',
    addedAt: '2026-04-16',
  },
  {
    handle: '@andytechcan',
    url: 'https://www.threads.com/@andytechcan',
    category: '창업',
    language: '한국어',
    note: '테크 창업·글로벌 전략',
    addedAt: '2026-04-16',
  },
  {
    handle: '@nmsvc2024',
    url: 'https://www.threads.com/@nmsvc2024',
    category: '창업',
    language: '한국어',
    note: '초기 스타트업 실패·BM 가이드',
    addedAt: '2026-04-16',
  },

  // ─────────── 창작자·콘텐츠 (15%) ───────────
  {
    handle: '@action_exploration',
    url: 'https://www.threads.com/@action_exploration',
    category: '창작자',
    language: '한국어',
    note: '시설업 창업 경험담',
    addedAt: '2026-04-16',
  },
  {
    handle: '@threadsight.xyz',
    url: 'https://www.threads.com/@threadsight.xyz',
    category: '창작자',
    language: '한국어',
    note: '스레드 뉴스·메타 분석 전문',
    addedAt: '2026-04-16',
  },

  // ─────────── 커머스·셀러 (10%) ───────────
  {
    handle: '@sell.info',
    url: 'https://www.threads.com/@sell.info',
    category: '커머스',
    language: '한국어',
    note: '스마트스토어 초보자 가이드',
    addedAt: '2026-04-16',
  },
  {
    handle: '@limonsparkk',
    url: 'https://www.threads.com/@limonsparkk',
    category: '커머스',
    language: '한국어',
    note: 'Etsy 한국 셀러 가입·재고 관리',
    addedAt: '2026-04-16',
  },
  {
    handle: '@kodeok.kr',
    url: 'https://www.threads.com/@kodeok.kr',
    category: '커머스',
    language: '한국어',
    note: 'KODEOK · 뷰티 커머스·리테일 관찰',
    addedAt: '2026-04-16',
  },

  // 기타(라이프·재테크 등)는 이후 확장 시 추가.
];
