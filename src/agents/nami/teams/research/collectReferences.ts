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

import { chromium, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runClaude } from '@/claude/client.js';
import { saveToKnowledgeBase } from '@/notion/databases/knowledgeDb.js';
import { THREADS_SEED_ACCOUNTS, type ThreadsSeedAccount } from '@/agents/nami/seedAccounts.js';
import { logger } from '@/utils/logger.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 단일 포스트 수집 최소 engagement (likes+replies+reposts). 이 아래는 저장 스킵.
const MIN_TOTAL_ENGAGEMENT = 5;
// 시드 계정 간 대기 시간 (ms) — human-like pace
const INTER_ACCOUNT_DELAY_MS = 5_000;
// 포스트 최대 보관 범위 (시간)
const MAX_POST_AGE_HOURS = 72;

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
// 브라우저에서 실행되는 DOM 추출 스크립트 (string IIFE)
// - tsx __name 주입 회피를 위해 string으로 전달
// - 한글은 unicode escape(\uXXXX)로 인코딩 — persistent context SyntaxError 방지
// - trailing comma 제거 (일부 파서 호환성)
// *=  포함 매칭 사용 — Threads가 aria-label에 숫자를 붙여 렌더링해도 잡힘
// (=  완전일치는 "좋아요 5" 같은 케이스를 놓쳐 컨테이너 검출 실패)
// 한글은 \\uXXXX 형태로 보존 — persistent context UTF-8 SyntaxError 방지
const EXTRACTION_SCRIPT = `(function () {
  function parseMetric(raw) {
    if (!raw) return 0;
    var cleaned = String(raw).replace(/[,\\s]/g, '');
    var mKo = cleaned.match(/^(\\d+(?:\\.\\d+)?)(\\ucc9c|\\ub9cc)$/);
    if (mKo) {
      var nKo = parseFloat(mKo[1]);
      if (mKo[2] === '\\ucc9c') return Math.round(nKo * 1000);
      if (mKo[2] === '\\ub9cc') return Math.round(nKo * 10000);
    }
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
      var svgs = container.querySelectorAll('svg[aria-label]');
      for (var s = 0; s < svgs.length; s++) {
        var lbl = (svgs[s].getAttribute('aria-label') || '');
        if (lbl.indexOf(labels[i]) < 0) continue;
        var btn = svgs[s].closest('div[role="button"]');
        if (!btn) continue;
        var txt = (btn.innerText || '').trim();
        if (!txt) return 0;
        var match = txt.match(/^(\\d+(?:[.,]\\d+)?(?:[KkMm]|\\ucc9c|\\ub9cc)?)$/);
        if (match) return parseMetric(match[1]);
        return 0;
      }
    }
    return 0;
  }
  var postLinks = Array.prototype.slice.call(document.querySelectorAll('a[href*="/post/"]'));
  var results = {};
  var order = [];
  for (var i = 0; i < postLinks.length; i++) {
    var link = postLinks[i];
    var rawHref = link.href;
    if (!rawHref || rawHref.indexOf('/post/') < 0) continue;
    // /post/ID 이후 /media, /likes 등 suffix 제거 → 정규화된 permalink
    var postIdx = rawHref.indexOf('/post/');
    var afterPost = rawHref.slice(postIdx + 6);
    var postId = afterPost.split('/')[0].split('?')[0];
    var permalink = rawHref.slice(0, postIdx) + '/post/' + postId;
    if (results[permalink]) continue;
    var container = link.parentElement;
    var found = false;
    for (var d = 0; d < 25 && container; d++) {
      var hasLike = container.querySelector('svg[aria-label*="\\uc88b\\uc544\\uc694"]') ||
                    container.querySelector('svg[aria-label*="Like"]');
      var hasTime = container.querySelector('time[datetime]');
      if (hasLike && hasTime) { found = true; break; }
      container = container.parentElement;
    }
    if (!found || !container) continue;
    var timeEl = container.querySelector('time[datetime]');
    if (!timeEl) continue;
    var timestamp = timeEl.getAttribute('datetime') || '';
    var likes    = extractMetric(container, ['\\uc88b\\uc544\\uc694', 'Like']);
    var replies  = extractMetric(container, ['\\ub313\\uae00', '\\ub2f5\\uae00', 'Reply', 'Replies']);
    var reposts  = extractMetric(container, ['\\ub9ac\\ud3ec\\uc2a4\\ud2b8', 'Repost', 'Quote']);
    var shares   = extractMetric(container, ['\\uacf5\\uc720', 'Share']);
    var raw = container.innerText || '';
    var lines = raw.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var NOISE = /^\\d+(?:[.,]\\d+)?(?:[KMkm]|\\ucc9c|\\ub9cc)?$|^(\\ub313\\uae00|\\ub2f5\\uae00|\\ub9ac\\ud3ec\\uc2a4\\ud2b8|\\uc88b\\uc544\\uc694|\\uacf5\\uc720|\\uacf5\\uc720\\ud558\\uae30|\\uc778\\uc6a9|Reply|Replies|Repost|Like|Share|Send|Quote)$|^\\d+(\\uc77c|\\uc2dc\\uac04|\\ubd84|\\ucd08|\\uc8fc|\\uac1c\\uc6d4)\\uc804?$|^(\\ubc29\\uae08|just now)$|^\\d+[dhmsw]$|^\\/$|^\\.{1,3}$/i;
    var textLines = [];
    for (var j = 0; j < lines.length; j++) {
      if (!NOISE.test(lines[j])) textLines.push(lines[j]);
    }
    // 첫 줄이 작성자 아이디면 제거 (공백 없음, 영숫자·_·. 조합, 한글 없음)
    if (textLines.length > 0 && /^@?[\\w.]{1,50}$/.test(textLines[0]) && !/[\\uAC00-\\uD7A3]/.test(textLines[0])) {
      textLines.shift();
    }
    var text = textLines.join('\\n').trim();
    if (!text) continue;
    var imageUrls = [];
    var imgs = container.querySelectorAll('img');
    for (var im = 0; im < imgs.length; im++) {
      var src = imgs[im].src || '';
      if (src && (src.indexOf('cdninstagram.com') >= 0 || src.indexOf('fbcdn.net') >= 0) &&
          src.indexOf('s150x150') < 0 && src.indexOf('s96x96') < 0) {
        imageUrls.push(src);
      }
    }
    results[permalink] = { permalink: permalink, text: text, timestamp: timestamp, likes: likes, replies: replies, reposts: reposts, shares: shares, imageUrls: imageUrls };
    order.push(permalink);
  }
  return order.map(function(k) { return results[k]; });
})()`;

// Node.js에서 노이즈 필터링 (한글 포함 정규식)
const NOISE_EN = /^\d+[.,\d]*[KMkm]?$|^(Reply|Replies|Repost|Like|Share|Send|Quote|just now)$/i;
const NOISE_KO = /^(\ub313\uae00|\ub2f5\uae00|\ub9ac\ud3ec\uc2a4\ud2b8|\uc88b\uc544\uc694|\uacf5\uc720|\uacf5\uc720\ud558\uae30|\uc778\uc6a9|\ubc29\uae08)$|^\d+(\uc77c|\uc2dc\uac04|\ubd84|\ucd08|\uc8fc|\uac1c\uc6d4)\uc804?$/;

function filterRawPosts(raw: RawThreadsPost[], authorHandle: string): RawThreadsPost[] {
  const bareHandle = authorHandle.replace('@', '');
  return raw.map(p => ({
    ...p,
    text: p.text
      .split('\n')
      .filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (NOISE_EN.test(t) || NOISE_KO.test(t)) return false;
        if (t === bareHandle || t === authorHandle) return false;
        return true;
      })
      .join('\n')
      .trim()
  })).filter(p => p.text.length > 0);
}

export interface PostClassification {
  hookingType: string;
  topicCategory: string;
  language: string;
  learning: string;
}

// ─────────────────────────────────────────────────────────
// Threads 지속 세션 관리
// ─────────────────────────────────────────────────────────

// 로그인 상태를 Chrome 프로필처럼 보존하는 전용 디렉토리.
// 최초 1회 `npm run setup:threads` 실행 → 브라우저에서 수동 로그인 → 이후 자동 재사용.
export const PLAYWRIGHT_PROFILE_DIR = path.resolve(os.homedir(), '.threads-playwright');

export async function openPersistentContext(): Promise<BrowserContext> {
  if (!fs.existsSync(PLAYWRIGHT_PROFILE_DIR)) {
    throw new Error(
      'Threads 세션 미설정 — 터미널에서 `npm run setup:threads` 실행 후 브라우저에서 로그인하세요.',
    );
  }
  const context = await chromium.launchPersistentContext(PLAYWRIGHT_PROFILE_DIR, {
    headless: true,
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  return context;
}

async function checkLoggedIn(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const isLogin = page.url().includes('/login');
    if (isLogin) {
      logger.error('nami', 'Threads 세션 만료 — `npm run setup:threads` 재실행 필요');
    }
    return !isLogin;
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────
// Playwright 프로필 스크래퍼
// ─────────────────────────────────────────────────────────

async function fetchProfilePosts(
  context: BrowserContext,
  acc: ThreadsSeedAccount,
): Promise<RawThreadsPost[]> {
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

    logger.info('nami', `${acc.handle} 페이지 URL: ${page.url()}`);

    // 무한 스크롤 — 새 포스트가 2회 연속 안 늘면 중단, 최대 20회
    let prevCount = 0;
    let staleRounds = 0;
    for (let scroll = 0; scroll < 20; scroll++) {
      const cur = await page.evaluate(() => document.querySelectorAll('a[href*="/post/"]').length);
      if (cur === prevCount) {
        staleRounds++;
        if (staleRounds >= 2) break;
      } else {
        staleRounds = 0;
      }
      prevCount = cur;
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise((r) => setTimeout(r, 2_000));
    }
    logger.info('nami', `${acc.handle} 스크롤 후 포스트 링크 수: ${prevCount}`);

    const raw = (await page.evaluate(EXTRACTION_SCRIPT)) as RawThreadsPost[];
    return filterRawPosts(raw, acc.handle);
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────
// 홈 피드 트렌딩 수집 (engagement 상위 포스트)
// ─────────────────────────────────────────────────────────

async function fetchFeedPosts(context: BrowserContext): Promise<Array<{ acc: ThreadsSeedAccount; post: RawThreadsPost }>> {
  const page = await context.newPage();
  try {
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      await page.waitForSelector('time[datetime]', { timeout: 12_000 });
    } catch {
      logger.warn('nami', '홈 피드 — time 요소 미노출');
      return [];
    }

    let prevCount = 0;
    let staleRounds = 0;
    for (let scroll = 0; scroll < 15; scroll++) {
      const cur = await page.evaluate(() => document.querySelectorAll('a[href*="/post/"]').length);
      if (cur === prevCount) {
        staleRounds++;
        if (staleRounds >= 2) break;
      } else {
        staleRounds = 0;
      }
      prevCount = cur;
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise((r) => setTimeout(r, 2_000));
    }
    logger.info('nami', `홈 피드 스크롤 후 포스트 링크 수: ${prevCount}`);

    const raw = (await page.evaluate(EXTRACTION_SCRIPT)) as RawThreadsPost[];

    // permalink에서 작성자 핸들 추출 → 계정별 acc 생성
    return raw
      .filter((p) => p.text && p.text.length > 0)
      .map((p) => {
        const m = p.permalink.match(/threads\.com\/@([\w.]+)/);
        const handle = m ? `@${m[1]}` : '@unknown';
        const acc: ThreadsSeedAccount = {
          handle,
          url: `https://www.threads.com/${handle}`,
          category: '기타',
          language: '한국어',
          addedAt: new Date().toISOString().split('T')[0],
        };
        return { acc, post: p };
      });
  } finally {
    await page.close();
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
  context: BrowserContext,
  permalink: string,
  authorHandle: string,
): Promise<string[]> {
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
    await page.close();
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

  const selfReplySection = selfReplies.length > 0
    ? `\n\n---\n\n${selfReplies.join('\n\n---\n\n')}`
    : '';

  const body = `## 원문

${post.text}${selfReplySection}

---

## 배울 점

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
    publishedAt: post.timestamp ? post.timestamp.split('T')[0] : undefined,
    status: 'Inbox',
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
  const context = await openPersistentContext();
  const loggedIn = await checkLoggedIn(context);
  if (!loggedIn) {
    await context.close();
    return { attempted: 0, collected: 0, saved: 0 };
  }

  // 수동 지정 계정은 필터 완화 (시간 제한 7일, engagement 0 — 전부 수집)
  const isManual = !!targetHandle;
  const cutoff = isManual
    ? Date.now() - 7 * 24 * 3_600_000
    : Date.now() - MAX_POST_AGE_HOURS * 3_600_000;
  const minEngagement = isManual ? 0 : MIN_TOTAL_ENGAGEMENT;
  const batch: Array<{ acc: ThreadsSeedAccount; post: RawThreadsPost }> = [];
  const seenPermalinks = new Set<string>();

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
        const posts = await fetchProfilePosts(context, acc);
        for (const p of posts) {
          if (!p.timestamp) continue;
          const ts = Date.parse(p.timestamp);
          if (isNaN(ts) || ts < cutoff) continue;
          if (p.likes + p.replies + p.reposts < minEngagement) continue;
          if (seenPermalinks.has(p.permalink)) continue;
          seenPermalinks.add(p.permalink);
          batch.push({ acc, post: p });
        }
        logger.info('nami', `수집: ${acc.handle} — ${posts.length}건 중 ${batch.filter(b => b.acc.handle === acc.handle).length}건 통과`);
      } catch (err) {
        logger.warn('nami', `${acc.handle} 수집 실패`, err);
      }
      await new Promise((r) => setTimeout(r, INTER_ACCOUNT_DELAY_MS));
    }

    // cron 자동 실행일 때만 홈 피드 트렌딩 수집
    if (!isManual) {
      try {
        const feedItems = await fetchFeedPosts(context);
        let feedAdded = 0;
        for (const { acc, post } of feedItems) {
          if (!post.timestamp) continue;
          const ts = Date.parse(post.timestamp);
          if (isNaN(ts) || ts < cutoff) continue;
          if (post.likes + post.replies + post.reposts < minEngagement) continue;
          if (seenPermalinks.has(post.permalink)) continue;
          seenPermalinks.add(post.permalink);
          batch.push({ acc, post });
          feedAdded++;
        }
        logger.info('nami', `홈 피드 — ${feedItems.length}건 중 ${feedAdded}건 통과`);
      } catch (err) {
        logger.warn('nami', '홈 피드 수집 실패', err);
      }
    }

    logger.info('nami', `총 ${batch.length}건 큐레이션 대상. 배치 분류 시작.`);
    const classifications = await classifyPostsBatch(batch.map((b) => b.post));

    // self-reply 수집 — 같은 컨텍스트 재사용 (세션 유지)
    const selfRepliesMap = new Map<string, string[]>();
    for (const { acc, post } of batch) {
      try {
        const replies = await fetchSelfReplies(context, post.permalink, acc.handle);
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
    return { attempted: accounts.length, collected: batch.length, saved };
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────
// 홈 피드 수동 수집 (Discord 트리거)
// ─────────────────────────────────────────────────────────

export async function collectFeedOnce(): Promise<{ collected: number; saved: number }> {
  const context = await openPersistentContext();
  const loggedIn = await checkLoggedIn(context);
  if (!loggedIn) {
    await context.close();
    return { collected: 0, saved: 0 };
  }

  try {
    const feedItems = await fetchFeedPosts(context);
    const cutoff = Date.now() - 7 * 24 * 3_600_000;
    const batch: Array<{ acc: ThreadsSeedAccount; post: RawThreadsPost }> = [];
    const seen = new Set<string>();

    for (const { acc, post } of feedItems) {
      if (!post.timestamp) continue;
      const ts = Date.parse(post.timestamp);
      if (isNaN(ts) || ts < cutoff) continue;
      if (seen.has(post.permalink)) continue;
      seen.add(post.permalink);
      batch.push({ acc, post });
    }

    logger.info('nami', `피드 수집 — ${feedItems.length}건 중 ${batch.length}건 통과`);

    const classifications = await classifyPostsBatch(batch.map((b) => b.post));
    let saved = 0;
    for (let i = 0; i < batch.length; i++) {
      try {
        await saveReference(batch[i].acc, batch[i].post, classifications[i], []);
        saved++;
      } catch (err) {
        logger.warn('nami', `피드 저장 실패: ${batch[i].post.permalink}`, err);
      }
    }

    return { collected: batch.length, saved };
  } finally {
    await context.close();
  }
}
