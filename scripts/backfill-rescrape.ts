// 원본URL 재방문해서 제목·콘텐츠·이미지 완전 재수집
//
// 페이지 블록과 한줄요약이 날아간 레코드들을 원본 Threads 포스트에서 복구.
// 실행: ./node_modules/.bin/tsx scripts/backfill-rescrape.ts

import { chromium, type Browser } from 'playwright';
import { notionClient } from '../src/notion/client.js';
import { markdownToBlocks } from '../src/notion/pages/pageBuilder.js';
import { env } from '../src/config/env.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 포스트 permalink 페이지에서 본문 + 이미지 추출
function buildPostScript(authorHandle: string): string {
  const safe = authorHandle.replace('@', '').replace(/[^a-zA-Z0-9_.]/g, '');
  return `
(function () {
  // 해시태그 링크에 # 보정
  var hashLinks = document.querySelectorAll('a[href*="/tags/"]');
  for (var h = 0; h < hashLinks.length; h++) {
    var ht = (hashLinks[h].innerText || '').trim();
    if (ht && !ht.startsWith('#')) hashLinks[h].innerText = '#' + ht;
  }

  // CDN 이미지를 [Image #N] 플레이스홀더로 교체
  var allImgs = document.querySelectorAll('img[src]');
  var imageUrls = [];
  for (var k = 0; k < allImgs.length; k++) {
    var src = allImgs[k].src;
    if (
      src &&
      (src.indexOf('cdninstagram.com') >= 0 || src.indexOf('fbcdn.net') >= 0) &&
      src.indexOf('s150x150') < 0 && src.indexOf('s320x320') < 0 && src.indexOf('s96x96') < 0
    ) {
      imageUrls.push(src);
      var node = document.createTextNode('\\n[Image #' + imageUrls.length + ']\\n');
      if (allImgs[k].parentNode) allImgs[k].parentNode.replaceChild(node, allImgs[k]);
    }
  }

  // 작성자 링크 기반 포스트 컨테이너 찾기
  var authorHandle = '${safe}';
  var allLinks = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
  var authorLinks = allLinks.filter(function(a) {
    return a.href && a.href.indexOf('/' + authorHandle + '/') >= 0;
  });

  var seen = {};
  var posts = [];

  for (var i = 0; i < authorLinks.length; i++) {
    var link = authorLinks[i];
    var container = link.parentElement;
    var found = false;
    for (var d = 0; d < 15 && container; d++) {
      if (container.querySelector('time[datetime]')) { found = true; break; }
      container = container.parentElement;
    }
    if (!found || !container) continue;

    var timeEl = container.querySelector('time[datetime]');
    var ts = timeEl ? timeEl.getAttribute('datetime') : '';
    var key = ts + '|' + (container.innerText || '').slice(0, 30);
    if (seen[key]) continue;
    seen[key] = true;

    var raw = container.innerText || '';
    raw = raw.replace(/\\n{3,}/g, '\\n\\n');
    var paragraphs = raw.split('\\n\\n');
    var textParas = [];
    for (var pi = 0; pi < paragraphs.length; pi++) {
      var pLines = paragraphs[pi].split('\\n').map(function(l) { return l.trim(); });
      var filteredLines = [];
      for (var j = 0; j < pLines.length; j++) {
        var l = pLines[j];
        if (!l) continue;
        if (/^\\d+[.,\\d]*[KMkm]?$/.test(l)) continue;
        if (/^(답글|댓글|리포스트|좋아요|공유|공유하기|Reply|Replies|Repost|Like|Share|Send)$/.test(l)) continue;
        if (/^\\d+(일|시간|분|초|주|개월)전?$/.test(l)) continue;
        if (/^(방금|just now)$/i.test(l)) continue;
        if (/^\\d+[dhmsw]$/.test(l)) continue;
        if (l === authorHandle || l === '@' + authorHandle) continue;
        filteredLines.push(l);
      }
      if (filteredLines.length > 0) textParas.push(filteredLines.join('\\n'));
    }
    var text = textParas.join('\\n\\n').trim();
    if (text) posts.push(text);
  }

  return { posts: posts, imageUrls: imageUrls };
})()
`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// 원본URL에서 handle 추출 — threads.com/@handle/post/XXX
function handleFromUrl(url: string): string {
  const m = url.match(/\/@([\w.]+)\/post\//);
  return m ? m[1] : '';
}

// 포스트 ID 추출 — threads.com/@handle/post/POST_ID
function postIdFromUrl(url: string): string {
  const m = url.match(/\/post\/([\w-]+)/);
  return m ? m[1] : '';
}

// 프로필 페이지에서 특정 포스트 컨테이너 텍스트·이미지 추출
// DOM 재귀 탐색으로 <div> 경계 → \n\n 단락 보존, 핸들 필터링
function buildProfileFindScript(postId: string, authorHandle: string): string {
  const safeId = postId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeHandle = authorHandle.replace(/[^a-zA-Z0-9_.]/g, '');
  return `
(function () {
  // 해시태그 링크 # 보정
  var hashLinks = document.querySelectorAll('a[href*="/tags/"]');
  for (var h = 0; h < hashLinks.length; h++) {
    var ht = (hashLinks[h].innerText || '').trim();
    if (ht && !ht.startsWith('#')) hashLinks[h].innerText = '#' + ht;
  }

  var postId = '${safeId}';
  var authorHandle = '${safeHandle}';
  var postLink = document.querySelector('a[href*="/post/' + postId + '"]');
  if (!postLink) return { text: '', imageUrls: [] };

  var container = postLink.parentElement;
  var found = false;
  for (var d = 0; d < 15 && container; d++) {
    if (container.querySelector('svg[aria-label*="좋아요"], svg[aria-label*="Like"]')) {
      found = true; break;
    }
    container = container.parentElement;
  }
  if (!found || !container) return { text: '', imageUrls: [] };

  // DOM 재귀 탐색: div/p 경계를 단락 구분으로, img를 [Image #N]으로 처리
  var imageUrls = [];
  var parts = [];
  var buf = '';

  function walk(node) {
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
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      if (tag === 'div' || tag === 'p') {
        var added = buf.slice(snapBuf.length).trim();
        if (added) {
          if (snapBuf.trim()) parts.push(snapBuf.trim());
          parts.push(added);
          buf = '';
        }
      }
    }
  }

  walk(container);
  if (buf.trim()) parts.push(buf.trim());

  var NOISE = /^\\d+[.,\\d]*[KMkm]?$|^(답글|댓글|리포스트|좋아요|공유|공유하기|Reply|Replies|Repost|Like|Share|Send)$|^\\d+(일|시간|분|초|주|개월)전?$|^(방금|just now)$|^\\d+[dhmsw]$/i;

  var filtered = parts.map(function(p) {
    if (p.startsWith('[Image #')) return p;
    var lines = p.split('\\n').filter(function(l) {
      l = l.trim();
      if (!l) return false;
      if (NOISE.test(l)) return false;
      // 작성자 핸들 단독 라인 제거
      if (l === authorHandle || l === '@' + authorHandle) return false;
      return true;
    });
    return lines.join('\\n');
  }).filter(function(p) {
    return p.startsWith('[Image #') || p.trim().length > 0;
  });

  return { text: filtered.join('\\n\\n').trim(), imageUrls: imageUrls };
})()
`;
}

async function scrapePost(
  browser: Browser,
  permalink: string,
  authorHandle: string,
): Promise<{ text: string; imageUrls: string[] } | null> {
  const postId = postIdFromUrl(permalink);
  if (!postId) return null;

  // 프로필 페이지에서 해당 포스트 찾기 (포스트 페이지는 로그인 벽 있음)
  const profileUrl = `https://www.threads.com/@${authorHandle}`;
  const context = await browser.newContext({
    userAgent: CHROME_UA, locale: 'ko-KR', viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    const res = await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!res || !res.ok()) return null;
    try {
      await page.waitForSelector('time[datetime]', { timeout: 10_000 });
    } catch { return null; }

    const result = (await page.evaluate(buildProfileFindScript(postId, authorHandle))) as {
      text: string;
      imageUrls: string[];
    };
    return result;
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

async function fetchAllBlocks(pageId: string): Promise<AnyRecord[]> {
  const all: AnyRecord[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    all.push(...(res.results as AnyRecord[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

async function deleteAllBlocks(blocks: AnyRecord[]): Promise<void> {
  for (const b of blocks) {
    try { await notionClient.blocks.delete({ block_id: b.id }); } catch { /* skip */ }
  }
}

async function main(): Promise<void> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) { console.error('❌ NOTION_KNOWLEDGE_DB_ID 미설정'); process.exit(1); }

  const dbInfo = await notionClient.databases.retrieve({ database_id: env.NOTION_KNOWLEDGE_DB_ID });
  const titlePropName = Object.entries(dbInfo.properties).find(([, p]) => p.type === 'title')?.[0] ?? '제목';

  console.log('▶ 스레드 레퍼런스 레코드 조회 중...');
  const pages: AnyRecord[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_KNOWLEDGE_DB_ID,
      start_cursor: cursor, page_size: 100,
      filter: { property: '카테고리', select: { equals: '스레드 레퍼런스' } },
    });
    pages.push(...(res.results as AnyRecord[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`총 ${pages.length}건 재스크래핑 대상\n`);

  const browser = await chromium.launch({ headless: true });
  let success = 0, fail = 0;

  try {
    for (const page of pages) {
      const pageId: string = page.id;
      const permalink: string = page.properties?.['원본URL']?.url ?? '';
      // URL에서 handle 추출이 우선, 작성자 속성은 폴백
      const authorHandle =
        handleFromUrl(permalink) ||
        (page.properties?.['작성자']?.multi_select?.[0]?.name ?? '');

      if (!permalink || !authorHandle) { console.log(`— handle 없음: ${permalink}`); fail++; continue; }

      try {
        const scraped = await scrapePost(browser, permalink, authorHandle);
        if (!scraped || !scraped.text) {
          console.log(`— 내용 없음: ${permalink.slice(-35)}`);
          fail++;
          continue;
        }

        const firstLine = scraped.text.split('\n').find((l) => l.trim().length > 0) ?? '';
        const newTitle = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;

        const properties: AnyRecord = {
          [titlePropName]: { title: [{ text: { content: newTitle } }] },
          콘텐츠: { rich_text: [{ text: { content: scraped.text.slice(0, 2000) } }] },
          작성자: { multi_select: [{ name: '@' + authorHandle }] },
        };
        if (scraped.imageUrls.length > 0) {
          properties['이미지'] = {
            files: scraped.imageUrls.map((url) => ({ name: '이미지', type: 'external', external: { url } })),
          };
        }

        await notionClient.pages.update({ page_id: pageId, properties });

        // 페이지 본문 재구성 (배울점·메타만 유지 — 본문은 콘텐츠 속성으로)
        const existingBlocks = await fetchAllBlocks(pageId);
        if (existingBlocks.length > 0) await deleteAllBlocks(existingBlocks);
        if (authorHandle) {
          const metaBody = `## 메타 정보\n\n- **작성자**: @${authorHandle}\n- **링크**: ${permalink}`;
          await notionClient.blocks.children.append({
            block_id: pageId,
            children: markdownToBlocks(metaBody) as AnyRecord[],
          });
        }

        console.log(`✅ ${newTitle.slice(0, 50)}`);
        success++;
      } catch (err) {
        console.error(`❌ ${permalink.slice(-35)} —`, (err as Error).message);
        fail++;
      }

      await new Promise((r) => setTimeout(r, 3_000));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n완료: 성공 ${success}건 / 실패 ${fail}건`);
}

main().catch((err) => { console.error('❌ 치명적 오류:', err.message || err); process.exit(1); });
