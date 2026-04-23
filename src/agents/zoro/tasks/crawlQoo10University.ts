// Qoo10大学 성공 사례 크롤러 — Puppeteer 사용 (SPA)
// https://university.qoo10.jp/success-stories/
// 일본 Qoo10 셀러 성공 사례 수집 (주 1회 — 콘텐츠 변경 빈도 낮음)

import { logger } from '@/utils/logger.js';
import { getBrowser } from '@/utils/browserPool.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import {
  saveToKnowledgeBase,
  queryExistingSourceUrls,
} from '@/notion/databases/knowledgeDb.js';
import { validateArticles, type ArticleToValidate } from './validateContent.js';

const AGENT = 'zoro:qoo10university';
const SUCCESS_STORIES_URL = 'https://university.qoo10.jp/success-stories/';
const ORIGIN = 'https://university.qoo10.jp';

interface StoryItem {
  title: string;
  url: string;
  content: string;
}

async function scrapeSuccessStories(): Promise<StoryItem[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });
    await page.goto(SUCCESS_STORIES_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    // JS 렌더링 대기
    await new Promise((r) => setTimeout(r, 2000));

    const stories = await page.evaluate((): Array<{ title: string; url: string; excerpt: string }> => {
      const results: Array<{ title: string; url: string; excerpt: string }> = [];

      // 성공사례 카드/링크 추출 — 다양한 셀렉터 시도
      const selectors = [
        'a[href*="success-stories/"]',
        '.case_item a',
        '.story_item a',
        '[class*="case"] a',
        '[class*="story"] a',
        'article a',
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length === 0) continue;

        els.forEach((el) => {
          const href = el.getAttribute('href');
          if (!href || href === '/success-stories/' || href === '#') return;
          const url = href.startsWith('http') ? href : `https://university.qoo10.jp${href}`;
          const title =
            el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() ??
            el.textContent?.trim() ??
            '';
          const excerpt =
            el.querySelector('p, .excerpt, .description, [class*="desc"]')?.textContent?.trim() ?? '';

          if (title && url.includes('university.qoo10.jp')) {
            results.push({ title, url, excerpt });
          }
        });

        if (results.length > 0) break;
      }

      return results;
    });

    if (stories.length === 0) {
      // 전체 페이지 텍스트 로깅 — 셀렉터 디버깅용
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
      logger.warn(AGENT, '성공사례 0건 — 셀렉터 확인 필요', { bodySnippet: bodyText });
    }

    logger.info(AGENT, `Qoo10大学 성공사례 ${stories.length}건 스크랩`);

    return stories.map((s) => ({
      title: s.title,
      url: s.url,
      content: s.excerpt || `Qoo10 Japan 판매 성공 사례: ${s.title}`,
    }));
  } finally {
    await page.close();
  }
}

export interface CollectSummary {
  scraped: number;
  validated: number;
  saved: number;
}

export async function collectQoo10UniversityStories(): Promise<CollectSummary> {
  const today = todayDateOnly();
  const existingUrls = await queryExistingSourceUrls('Qoo10');

  const stories = await scrapeSuccessStories();
  const newStories = stories.filter((s) => !existingUrls.has(s.url));
  logger.info(AGENT, `신규 ${newStories.length}건 (dedup 후)`);

  if (newStories.length === 0) return { scraped: stories.length, validated: 0, saved: 0 };

  const toValidate: ArticleToValidate[] = newStories.map((s) => ({
    title: s.title,
    url: s.url,
    content: s.content,
    source: 'qoo10university',
    language: 'ja',
  }));

  const validationResults = await validateArticles(toValidate);
  const passed = validationResults.filter((r) => r.relevant);

  let saved = 0;
  for (const r of passed) {
    const story = newStories.find((s) => s.url === r.url);
    if (!story) continue;

    await saveToKnowledgeBase({
      title: story.title,
      category: 'Qoo10',
      content: `## 핵심 인사이트 (한국어 요약)\n\n${r.summary}\n\n## 원문\n\n${story.content}`,
      contentText: r.summary,
      sourceUrl: story.url,
      tags: [
        ...r.tags.map((t) => `주제:${t}`),
        `타입:${r.contentType}`,
        `신뢰도:${r.confidenceLevel}`,
        '출처:Qoo10大学',
        '언어:일본어',
        'platform:Qoo10JP',
      ],
      collectedAt: today,
      status: 'Inbox',
    });
    existingUrls.add(story.url);
    saved++;
  }

  logger.info(AGENT, `완료 — 스크랩 ${stories.length}, 신규 ${newStories.length}, 저장 ${saved}`);
  return { scraped: stories.length, validated: passed.length, saved };
}
