// Threads 레퍼런스 수집 태스크 (나미·매일 03:00 cron)
//
// 역할: 시드 계정 공개 프로필을 Playwright 로 방문 → 최근 포스트 + 수치 추출 →
//       Claude CLI 로 배치 분류 (후킹유형·업종·언어·배울점) → 지식 베이스 DB 저장.
//
// 주의:
//   - 공식 Threads Graph API 는 본인 계정만 조회 가능 → 공개 프로필 DOM 스크래핑 불가피
//   - 일반 Chrome UA 사용, 계정당 5초 대기로 인간적 속도 유지
//   - robots.txt: ClaudeBot·Scrapy 등 명시 봇만 차단, 일반 Chrome UA 는 Googlebot/기본허용 그룹에 속하지 않지만
//     실제 브라우저 트래픽과 구별 불가. 내부 리서치 용도 소량·저속으로 한정.

import { chromium, type Browser } from 'playwright';
import { runClaude } from '@/claude/client.js';
import { saveToKnowledgeBase } from '@/notion/databases/knowledgeDb.js';
import { THREADS_SEED_ACCOUNTS, type ThreadsSeedAccount } from '@/agents/nami/seedAccounts.js';
import { logger } from '@/utils/logger.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 단일 포스트 수집 최소 engagement (likes+replies+reposts). 이 아래는 저장 스킵.
const MIN_TOTAL_ENGAGEMENT = 20;
// 시드 계정 간 대기 시간 (ms) — human-like pace
const INTER_ACCOUNT_DELAY_MS = 5_000;
// 포스트 최대 보관 범위 (시간)
const MAX_POST_AGE_HOURS = 36;

export interface RawThreadsPost {
  permalink: string;
  text: string;
  timestamp: string; // ISO
  likes: number;
  replies: number;
  reposts: number;
  shares: number;
}

// 브라우저 컨텍스트에서 직접 실행되는 DOM 추출 스크립트.
// 문자열로 전달하면 tsx(esbuild) 의 __name 헬퍼 주입을 피할 수 있다.
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
      // 버튼의 innerText 만 본다 (walk-up 하면 형제 버튼 숫자까지 끌려옴)
      var btn = svg.closest('div[role="button"]');
      if (!btn) continue;
      var txt = (btn.innerText || '').trim();
      if (!txt) return 0; // 0인 경우 숫자 비노출
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

    // 포스트 컨테이너: svg[좋아요] 가진 가장 가까운 조상
    var container = link.parentElement;
    var found = false;
    for (var d = 0; d < 15 && container; d++) {
      if (
        container.querySelector(
          'svg[aria-label*="좋아요"], svg[aria-label*="Like"]'
        )
      ) {
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
    var lines = raw.split('\\n').map(function (l) {
      return l.trim();
    }).filter(Boolean);
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
      permalink: permalink,
      text: text,
      timestamp: timestamp,
      likes: likes,
      replies: replies,
      reposts: reposts,
      shares: shares,
    };
    order.push(permalink);
  }

  return order.map(function (k) { return results[k]; });
})();
`;

export interface PostClassification {
  hookingType: string;
  topicCategory: string;
  language: string;
  learning: string;
}

// ─────────────────────────────────────────────────────────
// Playwright 프로필 스크래퍼
// ─────────────────────────────────────────────────────────

async function fetchProfilePosts(
  browser: Browser,
  acc: ThreadsSeedAccount,
): Promise<RawThreadsPost[]> {
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(acc.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    if (!response || !response.ok()) {
      logger.warn('nami', `${acc.handle} — HTTP ${response?.status() ?? 'no-response'}`);
      return [];
    }

    // 포스트가 렌더되는지 (첫 time 요소 기준)
    try {
      await page.waitForSelector('time[datetime]', { timeout: 10_000 });
    } catch {
      logger.warn('nami', `${acc.handle} — time 요소 미노출 (로그인 벽 가능성)`);
      return [];
    }

    // 페이지 내 DOM 파싱 — tsx 가 evaluate 안 함수를 __name() 으로 감싸는 이슈 회피 위해
    // 문자열 IIFE 로 전달해서 브라우저에서 직접 평가.
    const raw = (await page.evaluate(EXTRACTION_SCRIPT)) as RawThreadsPost[];

    return raw;
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────
// Claude 배치 분류 (후킹유형·업종·언어·배울점)
// ─────────────────────────────────────────────────────────

async function classifyPostsBatch(posts: RawThreadsPost[]): Promise<PostClassification[]> {
  if (posts.length === 0) return [];

  const prompt = `다음 Threads 포스트 ${posts.length}개를 JSON 배열로 분류해라.

각 원소 형식:
{
  "hookingType": "질문형" | "숫자리스트형" | "대조형" | "고백형" | "반전형" | "인사이트선언형" | "기타",
  "topicCategory": "마케팅" | "생산성" | "창업" | "창작자" | "커머스" | "기타",
  "language": "한국어" | "영어",
  "learning": "역직구 셀러 콘텐츠에 응용할 수 있는 배울 점 1줄 (50자 이내)"
}

포스트 번호는 유지, 정확히 ${posts.length}개 원소 JSON 배열만 출력. 다른 텍스트 금지.

포스트 목록:
${posts
  .map(
    (p, i) =>
      `[${i + 1}] ${p.text.slice(0, 400).replace(/\n+/g, ' / ')}`,
  )
  .join('\n')}
`;

  try {
    const response = await runClaude(prompt, 'nami', { maxTurns: 3, timeoutMs: 90_000 });
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 배열 찾지 못함');
    const parsed = JSON.parse(match[0]) as PostClassification[];
    if (!Array.isArray(parsed) || parsed.length !== posts.length) {
      throw new Error(`예상 ${posts.length}개, 받음 ${parsed.length}`);
    }
    return parsed;
  } catch (err) {
    logger.error('nami', '배치 분류 실패 — fallback 사용', err);
    // fallback: 미분류
    return posts.map(() => ({
      hookingType: '기타',
      topicCategory: '기타',
      language: '한국어',
      learning: '',
    }));
  }
}

// ─────────────────────────────────────────────────────────
// 지식 베이스 DB 저장
// ─────────────────────────────────────────────────────────

function engagementScore(p: RawThreadsPost): number {
  return p.likes + p.reposts * 3 + p.replies * 2;
}

async function saveReference(
  acc: ThreadsSeedAccount,
  post: RawThreadsPost,
  cls: PostClassification,
): Promise<void> {
  const score = engagementScore(post);
  const titleExcerpt = post.text.slice(0, 40).replace(/\s+/g, ' ');
  const title = `[나미] 레퍼런스 — ${acc.handle} — ${titleExcerpt}…`;

  // 본문 먼저, 배울 점 다음, 메타 정보는 맨 아래 — 가독성 우선.
  const body = `## 본문

${post.text}

---

## 배울 점

${cls.learning || '(미분류)'}

---

## 메타 정보

- **작성자**: ${acc.handle} (시드: ${acc.category})
- **작성시각**: ${post.timestamp}
- **링크**: ${post.permalink}
- **지표**: ❤ ${post.likes} · 💬 ${post.replies} · 🔁 ${post.reposts} · ↗ ${post.shares} · **Score ${score}**
- **분류**: ${cls.hookingType} · ${cls.topicCategory} · ${cls.language}
`;

  await saveToKnowledgeBase({
    title,
    category: '레퍼런스콘텐츠',
    collector: 'nami',
    content: body,
    summary: post.text.slice(0, 180).replace(/\s+/g, ' '),
    sourceUrl: post.permalink,
    tags: [
      `후킹:${cls.hookingType}`,
      `업종:${cls.topicCategory}`,
      `언어:${cls.language}`,
      `score:${score}`,
      `seed:${acc.category}`,
    ],
    reliability: '1차자료',
    status: 'Raw',
  });
}

// ─────────────────────────────────────────────────────────
// 최상위 오케스트레이터 (cron 진입점)
// ─────────────────────────────────────────────────────────

export async function collectReferencesOnce(): Promise<{
  attempted: number;
  collected: number;
  saved: number;
}> {
  const browser = await chromium.launch({ headless: true });
  const cutoff = Date.now() - MAX_POST_AGE_HOURS * 3_600_000;
  const batch: Array<{ acc: ThreadsSeedAccount; post: RawThreadsPost }> = [];

  try {
    for (const acc of THREADS_SEED_ACCOUNTS) {
      try {
        const posts = await fetchProfilePosts(browser, acc);
        for (const p of posts) {
          if (!p.timestamp) continue;
          const ts = Date.parse(p.timestamp);
          if (isNaN(ts) || ts < cutoff) continue;
          if (p.likes + p.replies + p.reposts < MIN_TOTAL_ENGAGEMENT) continue;
          batch.push({ acc, post: p });
        }
        logger.info('nami', `수집: ${acc.handle} — ${posts.length}건 중 ${batch.filter(b => b.acc.handle === acc.handle).length}건 통과`);
      } catch (err) {
        logger.warn('nami', `${acc.handle} 수집 실패`, err);
      }
      await new Promise((r) => setTimeout(r, INTER_ACCOUNT_DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  logger.info('nami', `총 ${batch.length}건 큐레이션 대상. 배치 분류 시작.`);
  const classifications = await classifyPostsBatch(batch.map((b) => b.post));

  let saved = 0;
  for (let i = 0; i < batch.length; i++) {
    const { acc, post } = batch[i];
    const cls = classifications[i];
    try {
      await saveReference(acc, post, cls);
      saved += 1;
    } catch (err) {
      logger.warn('nami', `저장 실패: ${acc.handle} ${post.permalink}`, err);
    }
  }

  logger.info('nami', `수집 완료: 시드 ${THREADS_SEED_ACCOUNTS.length}개 방문, 통과 ${batch.length}건, 저장 ${saved}건`);
  return {
    attempted: THREADS_SEED_ACCOUNTS.length,
    collected: batch.length,
    saved,
  };
}
