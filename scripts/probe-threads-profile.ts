// Playwright Threads 프로필 DOM 실측 스크립트
//
// 목적: threads.com/@user 공개 프로필 페이지에서 Playwright로 DOM 파싱 가능한지 확인.
// 확인 포인트:
//   1. 로그인 벽 없이 접근되는가
//   2. 최근 포스트 본문·작성시각 추출 가능한가
//   3. 좋아요·리포스트·리플 수치 DOM 노출 여부
//   4. 팔로워 수 추출 가능 여부
//
// 실행: npx tsx scripts/probe-threads-profile.ts

import { chromium } from 'playwright';

const TARGET_URL = 'https://www.threads.com/@storyteller_jhk';

async function probe(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log(`\n▶ Fetching ${TARGET_URL}`);
  const response = await page.goto(TARGET_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  console.log(`  HTTP status: ${response?.status()}`);
  console.log(`  Final URL:   ${page.url()}`);

  // 로그인 벽 감지
  const title = await page.title();
  console.log(`  Page title:  ${title}`);

  // 간단 DOM 덤프 — 몇 개 후보 selector 로 실측
  console.log('\n--- DOM 구조 실측 ---');

  const candidates: Array<{ label: string; selector: string }> = [
    { label: '메인 article 개수', selector: 'article' },
    { label: 'div[role="button"] (좋아요 등 액션)', selector: 'div[role="button"]' },
    { label: 'a[href*="/liked_by/"]', selector: 'a[href*="/liked_by/"]' },
    { label: 'svg[aria-label*="좋아요"]', selector: 'svg[aria-label*="좋아요"]' },
    { label: 'svg[aria-label*="Like"]', selector: 'svg[aria-label*="Like"]' },
    { label: '시간 표시 time[datetime]', selector: 'time[datetime]' },
    { label: '팔로워 포함 텍스트', selector: 'text=/팔로워/' },
  ];

  for (const { label, selector } of candidates) {
    try {
      const count = await page.locator(selector).count();
      console.log(`  ${label}: ${count}개`);
    } catch (err) {
      console.log(`  ${label}: ERROR ${(err as Error).message}`);
    }
  }

  // 첫 article 주변 텍스트 샘플
  const firstArticleText = await page
    .locator('article')
    .first()
    .innerText()
    .catch(() => '(article 없음)');
  console.log('\n--- 첫 article innerText (앞 500자) ---');
  console.log(firstArticleText.slice(0, 500));

  // 페이지 전체 텍스트 일부 (좋아요 수치 어떻게 나타나는지)
  const bodyText = await page.locator('body').innerText();
  const metricHints = bodyText
    .split('\n')
    .filter((l) => /^\d+[\d,.KM]*$/.test(l.trim()) || /좋아요|리포스트|답글|Likes|Reposts|Replies/.test(l))
    .slice(0, 30);
  console.log('\n--- 수치·지표 힌트 (body text 기준) ---');
  for (const l of metricHints) {
    console.log(`  | ${l.trim()}`);
  }

  // HTML 앞부분 덤프 (수동 분석용)
  const html = await page.content();
  console.log('\n--- HTML 앞 3000자 ---');
  console.log(html.slice(0, 3000));

  await browser.close();
}

probe().catch((err) => {
  console.error('probe 실패:', err);
  process.exit(1);
});
