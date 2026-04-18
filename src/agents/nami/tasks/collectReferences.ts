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

import { chromium, type Browser, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { runClaude } from '@/claude/client.js';
import { saveToKnowledgeBase } from '@/notion/databases/knowledgeDb.js';
import { THREADS_SEED_ACCOUNTS, type ThreadsSeedAccount } from '@/agents/nami/seedAccounts.js';
import { logger } from '@/utils/logger.js';
import { env } from '@/config/env.js';

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
  imageUrls: string[];
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

  // 해시태그 링크 텍스트에 # 접두사 보정 (Threads 가 a 태그로 처리시 # 생략 케이스)
  var hashLinks = document.querySelectorAll('a[href*="/tags/"]');
  for (var h = 0; h < hashLinks.length; h++) {
    var ht = (hashLinks[h].innerText || '').trim();
    if (ht && !ht.startsWith('#')) hashLinks[h].innerText = '#' + ht;
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
    var reposts = extractMetric(container, ['리포스트', '인용', 'Repost', 'Quote']);
    var shares = extractMetric(container, ['공유하기', '공유', 'Share']);

    // DOM 재귀 탐색으로 단락·이미지 추출 (<div>/<p> 경계 → \n\n, img → [Image #N])
    var imageUrls = [];
    var parts = [];
    var buf = '';
    var walk = function(node) {
      if (node.nodeType === 3) {
        buf += node.textContent;
      } else if (node.nodeType === 1) {
        var tag = (node.tagName || '').toLowerCase();
        if (tag === 'svg' || tag === 'script' || tag === 'style') return;
        if (tag === 'br') { buf += '\\n'; return; }
        if (tag === 'img') {
          var src = node.src || '';
          if (src &&
              (src.indexOf('cdninstagram.com') >= 0 || src.indexOf('fbcdn.net') >= 0) &&
              src.indexOf('s150x150') < 0 && src.indexOf('s320x320') < 0 && src.indexOf('s96x96') < 0) {
            imageUrls.push(src);
            if (buf.trim()) { parts.push(buf.trim()); buf = ''; }
            parts.push('[Image #' + imageUrls.length + ']');
          }
          return;
        }
        var snapBuf = buf;
        for (var ci = 0; ci < node.childNodes.length; ci++) walk(node.childNodes[ci]);
        if (tag === 'div' || tag === 'p') {
          var added = buf.slice(snapBuf.length).trim();
          if (added) {
            if (snapBuf.trim()) parts.push(snapBuf.trim());
            parts.push(added);
            buf = '';
          }
        }
      }
    };
    walk(container);
    if (buf.trim()) parts.push(buf.trim());

    var NOISE = /^\\d+[.,\\d]*[KMkm]?$|^(답글|댓글|리포스트|좋아요|공유|공유하기|Reply|Replies|Repost|Like|Share|Send)$|^\\d+(일|시간|분|초|주|개월)전?$|^(방금|just now)$|^\\d+[dhmsw]$/i;
    var authorHandle = (permalink.match(/\\/@([\\w.]+)\\/post\\//) || [])[1] || '';

    var filtered = parts.map(function(p) {
      if (p.startsWith('[Image #')) return p;
      var lines = p.split('\\n').filter(function(l) {
        l = l.trim();
        if (!l) return false;
        if (NOISE.test(l)) return false;
        if (authorHandle && (l === authorHandle || l === '@' + authorHandle)) return false;
        return true;
      });
      return lines.join('\\n');
    }).filter(function(p) {
      return p.startsWith('[Image #') || p.trim().length > 0;
    });

    var text = filtered.join('\\n\\n').trim();
    if (!text) continue;

    results[permalink] = {
      permalink: permalink,
      text: text,
      timestamp: timestamp,
      likes: likes,
      replies: replies,
      reposts: reposts,
      shares: shares,
      imageUrls: imageUrls,
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
// Threads 로그인 & 세션 관리
// ─────────────────────────────────────────────────────────

const SESSION_PATH = path.resolve(process.cwd(), '.threads-session.json');
// 세션 파일 최대 수명 (12시간 — 그 이상 지나면 재로그인)
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isSessionFresh(): boolean {
  try {
    const stat = fs.statSync(SESSION_PATH);
    return Date.now() - stat.mtimeMs < SESSION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function loginToThreads(browser: Browser): Promise<void> {
  const username = env.THREADS_USERNAME;
  const password = env.THREADS_PASSWORD;
  if (!username || !password) {
    throw new Error('THREADS_USERNAME / THREADS_PASSWORD 환경변수 미설정');
  }

  logger.info('nami', 'Threads 로그인 시작');
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.threads.com/login/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 사용자명 입력
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 15_000 });
    await page.fill('input[autocomplete="username"]', username);

    // 비밀번호 입력
    await page.fill('input[autocomplete="current-password"]', password);

    // 로그인 제출 — Threads는 <input type="submit"> 사용
    await page.click('input[type="submit"]');

    // 로그인 성공 확인 — 피드 또는 프로필 URL로 이동될 때까지 대기
    await page.waitForURL((url) => !url.toString().includes('/login/'), { timeout: 30_000 });

    await context.storageState({ path: SESSION_PATH });
    logger.info('nami', `Threads 로그인 성공 — 세션 저장: ${SESSION_PATH}`);
  } finally {
    await context.close();
  }
}

async function getLoggedInContext(browser: Browser): Promise<BrowserContext> {
  if (!isSessionFresh()) {
    await loginToThreads(browser);
  }
  return browser.newContext({
    storageState: SESSION_PATH,
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
}

// ─────────────────────────────────────────────────────────
// Playwright 프로필 스크래퍼
// ─────────────────────────────────────────────────────────

async function fetchProfilePosts(
  browser: Browser,
  acc: ThreadsSeedAccount,
): Promise<RawThreadsPost[]> {
  const context = await getLoggedInContext(browser);
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

    // 작성자 핸들·표시이름이 본문 첫 줄에 섞이는 경우 제거
    const bareHandle = acc.handle.replace('@', '');
    return raw.map((p) => ({
      ...p,
      text: p.text
        .split('\n')
        .filter((l) => l.trim() !== bareHandle && l.trim() !== acc.handle)
        .join('\n')
        .trim(),
    }));
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────
// 작성자 self-reply 수집 (포스트 permalink 방문)
// ─────────────────────────────────────────────────────────

function buildSelfReplyScript(handle: string): string {
  // handle은 seedAccounts config에서 온 고정값 (외부 입력 아님)
  const safeHandle = handle.replace('@', '').replace(/[^a-zA-Z0-9_.]/g, '');
  return `
(function () {
  var authorHandle = '${safeHandle}';
  var allLinks = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
  var authorLinks = allLinks.filter(function(a) {
    return a.href && a.href.indexOf('/' + authorHandle + '/') >= 0;
  });

  var seen = {};
  var selfReplies = [];

  for (var i = 0; i < authorLinks.length; i++) {
    var link = authorLinks[i];
    var container = link.parentElement;
    var found = false;
    for (var d = 0; d < 12 && container; d++) {
      if (container.querySelector('time[datetime]')) {
        found = true;
        break;
      }
      container = container.parentElement;
    }
    if (!found || !container) continue;

    var timeEl = container.querySelector('time[datetime]');
    var ts = timeEl ? timeEl.getAttribute('datetime') : '';
    var key = ts + '|' + (container.innerText || '').slice(0, 40);
    if (seen[key]) continue;
    seen[key] = true;

    var raw = container.innerText || '';
    var lines = raw.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var textLines = [];
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      if (/^\\d+[.,\\d]*[KMkm]?$/.test(l)) continue;
      if (/^(답글|댓글|리포스트|좋아요|공유|공유하기|Reply|Replies|Repost|Like|Share|Send)$/.test(l)) continue;
      textLines.push(l);
    }
    var text = textLines.join('\\n').trim();
    if (text) selfReplies.push(text);
  }

  return selfReplies;
})()
`;
}

async function fetchSelfReplies(
  browser: Browser,
  permalink: string,
  authorHandle: string,
): Promise<string[]> {
  const context = await getLoggedInContext(browser);
  const page = await context.newPage();
  try {
    const response = await page.goto(permalink, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    if (!response || !response.ok()) return [];

    try {
      await page.waitForSelector('time[datetime]', { timeout: 8_000 });
    } catch {
      return [];
    }

    // tsx의 __name 헬퍼 주입 회피를 위해 문자열 IIFE로 전달 (EXTRACTION_SCRIPT 동일 패턴)
    const script = buildSelfReplyScript(authorHandle);
    const replies = (await page.evaluate(script)) as string[];

    // 첫 번째 원소는 원본 포스트 본문과 겹칠 가능성 높으므로 제거
    return replies.slice(1);
  } catch {
    return [];
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

function buildContentText(post: RawThreadsPost, selfReplies: string[]): string {
  const parts = [post.text, ...selfReplies];
  return parts.join('\n---\n');
}

async function saveReference(
  acc: ThreadsSeedAccount,
  post: RawThreadsPost,
  cls: PostClassification,
  selfReplies: string[],
): Promise<void> {
  // 포스트 첫 줄을 제목으로 — 훅 문장이 곧 콘텐츠 제목
  const firstLine = post.text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? post.text.slice(0, 60);
  const title = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
  const contentText = buildContentText(post, selfReplies);

  const body = `## 배울 점

${cls.learning || '(미분류)'}

---

## 메타 정보

- **작성자**: ${acc.handle} (시드: ${acc.category})
- **작성시각**: ${post.timestamp}
- **링크**: ${post.permalink}
- **분류**: ${cls.hookingType} · ${cls.topicCategory} · ${cls.language}
`;

  await saveToKnowledgeBase({
    title,
    category: '스레드 레퍼런스',
    collector: 'nami',
    content: body,
    contentText,
    author: acc.handle,
    likes: post.likes,
    replies: post.replies,
    reposts: post.reposts,
    shares: post.shares,
    imageUrls: post.imageUrls,
    summary: post.text.slice(0, 180).replace(/\s+/g, ' '),
    sourceUrl: post.permalink,
    tags: [
      `후킹:${cls.hookingType}`,
      `업종:${cls.topicCategory}`,
      `언어:${cls.language}`,
      `seed:${acc.category}`,
    ],
    reliability: '1차자료',
    status: 'Raw',
  });
}

// ─────────────────────────────────────────────────────────
// 최상위 오케스트레이터 (cron 진입점)
// ─────────────────────────────────────────────────────────

export async function collectReferencesOnce(targetHandle?: string): Promise<{
  attempted: number;
  collected: number;
  saved: number;
}> {
  const browser = await chromium.launch({ headless: true });
  // 수동 지정 계정은 필터 완화 (시간 제한 7일, engagement 최소 1)
  const isManual = !!targetHandle;
  const cutoff = isManual
    ? Date.now() - 7 * 24 * 3_600_000
    : Date.now() - MAX_POST_AGE_HOURS * 3_600_000;
  const minEngagement = isManual ? 1 : MIN_TOTAL_ENGAGEMENT;
  const batch: Array<{ acc: ThreadsSeedAccount; post: RawThreadsPost }> = [];

  // 특정 계정만 수집 시 임시 계정 객체 생성
  const handle = targetHandle?.startsWith('@') ? targetHandle : targetHandle ? `@${targetHandle}` : null;
  const accounts: ThreadsSeedAccount[] = handle
    ? [{
        handle,
        url: `https://www.threads.com/${handle}`,
        category: '마케팅',
        language: '한국어',
        addedAt: new Date().toISOString().split('T')[0],
      }]
    : THREADS_SEED_ACCOUNTS;

  try {
    for (const acc of accounts) {
      try {
        const posts = await fetchProfilePosts(browser, acc);
        for (const p of posts) {
          if (!p.timestamp) continue;
          const ts = Date.parse(p.timestamp);
          if (isNaN(ts) || ts < cutoff) continue;
          if (p.likes + p.replies + p.reposts < minEngagement) continue;
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

  // self-reply 수집 — permalink당 추가 방문이 필요하므로 브라우저 재사용
  const selfRepliesMap = new Map<string, string[]>();
  const replyBrowser = await chromium.launch({ headless: true });
  try {
    for (const { acc, post } of batch) {
      try {
        const replies = await fetchSelfReplies(replyBrowser, post.permalink, acc.handle);
        selfRepliesMap.set(post.permalink, replies);
        if (replies.length > 0) {
          logger.info('nami', `self-reply ${replies.length}건: ${acc.handle}`);
        }
      } catch (err) {
        logger.warn('nami', `self-reply 수집 실패: ${post.permalink}`, err);
        selfRepliesMap.set(post.permalink, []);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } finally {
    await replyBrowser.close();
  }

  let saved = 0;
  for (let i = 0; i < batch.length; i++) {
    const { acc, post } = batch[i];
    const cls = classifications[i];
    const selfReplies = selfRepliesMap.get(post.permalink) ?? [];
    try {
      await saveReference(acc, post, cls, selfReplies);
      saved += 1;
    } catch (err) {
      logger.warn('nami', `저장 실패: ${acc.handle} ${post.permalink}`, err);
    }
  }

  logger.info('nami', `수집 완료: 시드 ${accounts.length}개 방문, 통과 ${batch.length}건, 저장 ${saved}건`);
  return {
    attempted: accounts.length,
    collected: batch.length,
    saved,
  };
}
