// Threads 공개 프로필 페이지에서 사용되는 실제 aria-label 값 전수 덤프
import { chromium } from 'playwright';

const URL = 'https://www.threads.com/@storyteller_jhk';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('time[datetime]', { timeout: 10_000 });

  const allLabels = await page.evaluate(`
    (function () {
      var set = {};
      var els = document.querySelectorAll('svg[aria-label]');
      for (var i = 0; i < els.length; i++) {
        var v = els[i].getAttribute('aria-label');
        if (!v) continue;
        set[v] = (set[v] || 0) + 1;
      }
      var out = [];
      for (var k in set) out.push({ label: k, count: set[k] });
      out.sort(function (a, b) { return b.count - a.count; });
      return out;
    })();
  `);

  console.log('svg[aria-label] 전수 목록:');
  console.log(allLabels);

  // 첫 포스트 컨테이너 안에서 버튼 구조 덤프
  const firstPostDump = await page.evaluate(`
    (function () {
      var link = document.querySelector('a[href*="/post/"]');
      if (!link) return 'no link';
      var container = link.parentElement;
      for (var d = 0; d < 15 && container; d++) {
        if (container.querySelector('svg[aria-label*="좋아요"], svg[aria-label*="Like"]')) break;
        container = container.parentElement;
      }
      if (!container) return 'no container';
      var buttons = container.querySelectorAll('div[role="button"]');
      var result = [];
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        var svg = b.querySelector('svg[aria-label]');
        result.push({
          idx: i,
          innerText: (b.innerText || '').replace(/\\n+/g, ' ').slice(0, 80),
          svgLabel: svg ? svg.getAttribute('aria-label') : null,
        });
      }
      return result;
    })();
  `);

  console.log('\n첫 포스트 컨테이너 내부 div[role=button] 덤프:');
  console.log(firstPostDump);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
