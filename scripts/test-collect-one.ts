// 단일 시드 계정 대상 수집 로직 검증 스크립트 (노션 저장 안 함)
//
// 실행: ./node_modules/.bin/tsx scripts/test-collect-one.ts [@handle]

import { chromium } from 'playwright';
import { THREADS_SEED_ACCOUNTS } from '../src/agents/nami/seedAccounts.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EXTRACTION_SCRIPT = `
(function () {
  function parseMetric(raw) {
    if (!raw) return 0;
    var cleaned = String(raw).replace(/[,\\s]/g, '');
    var m = cleaned.match(/^(\\d+(?:\\.\\d+)?)([KkMm]?)$/);
    if (!m) return 0;
    var n = parseFloat(m[1]);
    var suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') return Math.round(n * 1000);
    if (suffix === 'm') return Math.round(n * 1000000);
    return Math.round(n);
  }

  function extractMetric(container, labels) {
    for (var i = 0; i < labels.length; i++) {
      var svg = container.querySelector('svg[aria-label="' + labels[i] + '"]');
      if (!svg) continue;
      var btn = svg.closest('div[role="button"]');
      if (!btn) continue;
      var txt = (btn.innerText || '').trim();
      if (!txt) return 0;
      var match = txt.match(/^(\\d+(?:[.,]\\d+)?[KkMm]?)$/);
      if (match) return parseMetric(match[1]);
    }
    return 0;
  }

  var postLinks = Array.prototype.slice.call(
    document.querySelectorAll('a[href*="/post/"]')
  );
  var results = {};
  var order = [];

  for (var i = 0; i < postLinks.length; i++) {
    var link = postLinks[i];
    var permalink = link.href;
    if (!permalink || permalink.indexOf('/post/') < 0) continue;
    if (results[permalink]) continue;

    var container = link.parentElement;
    var found = false;
    for (var d = 0; d < 15 && container; d++) {
      if (container.querySelector('svg[aria-label*="좋아요"], svg[aria-label*="Like"]')) {
        found = true;
        break;
      }
      container = container.parentElement;
    }
    if (!found || !container) continue;

    var timeEl = container.querySelector('time[datetime]');
    if (!timeEl) continue;
    var timestamp = timeEl.getAttribute('datetime') || '';

    var likes = extractMetric(container, ['좋아요', 'Like']);
    var replies = extractMetric(container, ['댓글', '답글', 'Reply', 'Replies']);
    var reposts = extractMetric(container, ['리포스트', 'Repost']);
    var shares = extractMetric(container, ['공유하기', '공유', 'Share']);

    var raw = container.innerText || '';
    var lines = raw.split('\\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var textLines = [];
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      if (/^\\d+[.,\\d]*[KMkm]?$/.test(l)) continue;
      if (/^(답글|댓글|리포스트|좋아요|공유|공유하기|Reply|Replies|Repost|Like|Share|Send)$/.test(l)) continue;
      textLines.push(l);
    }
    var text = textLines.join('\\n').trim();
    if (!text) continue;

    results[permalink] = {
      permalink: permalink, text: text, timestamp: timestamp,
      likes: likes, replies: replies, reposts: reposts, shares: shares,
    };
    order.push(permalink);
  }
  return order.map(function (k) { return results[k]; });
})();
`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  const acc =
    THREADS_SEED_ACCOUNTS.find((a) => a.handle === arg) ??
    THREADS_SEED_ACCOUNTS[0];

  console.log(`▶ 대상: ${acc.handle} (${acc.url})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(acc.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('time[datetime]', { timeout: 10_000 });

  const raw = (await page.evaluate(EXTRACTION_SCRIPT)) as Array<{
    permalink: string;
    text: string;
    timestamp: string;
    likes: number;
    replies: number;
    reposts: number;
    shares: number;
  }>;

  console.log(`\n수집된 포스트: ${raw.length}건\n`);
  for (const p of raw) {
    console.log(`─────────────────────────────────`);
    console.log(`🔗 ${p.permalink}`);
    console.log(`🕐 ${p.timestamp}`);
    console.log(`❤ ${p.likes} · 💬 ${p.replies} · 🔁 ${p.reposts} · ↗ ${p.shares}`);
    console.log(`📝 ${p.text.slice(0, 300).replace(/\n+/g, ' / ')}`);
    console.log();
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
