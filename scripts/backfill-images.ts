// 이미지 속성이 비어 있는 스레드 레퍼런스 레코드에 이미지 재수집
//
// 동작:
//   1. 이미지 속성이 비어 있고 원본URL 이 있는 레코드 조회
//   2. Playwright 로 해당 포스트 permalink 방문
//   3. 포스트 이미지 URL 추출 → 노션 이미지 속성 업데이트
//
// 실행: ./node_modules/.bin/tsx scripts/backfill-images.ts

import { chromium } from 'playwright';
import { notionClient } from '../src/notion/client.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 포스트 permalink 페이지에서 본문 이미지 URL 추출 (아바타 제외)
const IMAGE_EXTRACT_SCRIPT = `
(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('img[src]'));
  var urls = [];
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].src;
    if (
      src &&
      (src.indexOf('cdninstagram.com') >= 0 || src.indexOf('fbcdn.net') >= 0) &&
      src.indexOf('s150x150') < 0 &&
      src.indexOf('s320x320') < 0 &&
      src.indexOf('s96x96') < 0
    ) {
      urls.push(src);
    }
  }
  return urls;
})()
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

async function extractImages(permalink: string): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    const res = await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!res || !res.ok()) return [];
    try {
      await page.waitForSelector('img[src*="cdninstagram"], img[src*="fbcdn"]', { timeout: 8_000 });
    } catch {
      return [];
    }
    return (await page.evaluate(IMAGE_EXTRACT_SCRIPT)) as string[];
  } catch {
    return [];
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) {
    console.error('❌ NOTION_KNOWLEDGE_DB_ID 미설정');
    process.exit(1);
  }

  console.log('▶ 이미지 없는 스레드 레퍼런스 조회 중...');

  const pages: AnyRecord[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_KNOWLEDGE_DB_ID,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        and: [
          { property: '카테고리', select: { equals: '스레드 레퍼런스' } },
          { property: '이미지', files: { is_empty: true } },
          { property: '원본URL', url: { is_not_empty: true } },
        ],
      },
    });
    pages.push(...(res.results as AnyRecord[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`총 ${pages.length}건 이미지 재수집 대상\n`);

  let success = 0;
  let noImage = 0;
  let fail = 0;

  for (const page of pages) {
    const pageId: string = page.id;
    const permalink: string = page.properties?.['원본URL']?.url ?? '';
    if (!permalink) { fail++; continue; }

    try {
      const imageUrls = await extractImages(permalink);
      if (imageUrls.length === 0) {
        console.log(`— 이미지 없음: ${permalink.slice(-30)}`);
        noImage++;
      } else {
        await notionClient.pages.update({
          page_id: pageId,
          properties: {
            이미지: {
              files: imageUrls.map((url) => ({
                name: '이미지',
                type: 'external',
                external: { url },
              })),
            },
          },
        });
        console.log(`✅ ${imageUrls.length}장 저장: ${permalink.slice(-30)}`);
        success++;
      }
    } catch (err) {
      logger.warn('backfill-images', `실패: ${permalink}`, err);
      fail++;
    }

    await new Promise((r) => setTimeout(r, 3_000));
  }

  console.log(`\n완료: 이미지 저장 ${success}건 / 이미지 없음 ${noImage}건 / 실패 ${fail}건`);
}

main().catch((err) => {
  console.error('❌ 치명적 오류:', err.message || err);
  process.exit(1);
});
