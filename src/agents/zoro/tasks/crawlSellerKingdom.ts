// Seller Kingdom 블로그 크롤러
// https://sellerkingdom.com/korean-global-seller-blogs-l-sellerkingdom
// Amazon·글로벌 역직구 셀러 전략·PPC·키워드 실무 아티클 수집

import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import {
  saveToKnowledgeBase,
  queryExistingSourceUrls,
} from '@/notion/databases/knowledgeDb.js';
import { validateArticles, type ArticleToValidate } from './validateContent.js';

const AGENT = 'zoro:sellerkingdom';
const LISTING_URL =
  'https://sellerkingdom.com/korean-global-seller-blogs-l-sellerkingdom';
const ORIGIN = 'https://sellerkingdom.com';
// 기사 URL 패턴: 절대경로(https://sellerkingdom.com/post/...) 또는 상대경로(/post/...)
const ARTICLE_URL_RE = /href="((?:https?:\/\/(?:www\.)?sellerkingdom\.com)?\/post\/([a-z0-9][a-z0-9-]+))"/g;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

async function fetchHtml(url: string, timeout = 15_000): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchListing(): Promise<Array<{ url: string }>> {
  const html = await fetchHtml(LISTING_URL);
  const seen = new Set<string>();
  const items: Array<{ url: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = ARTICLE_URL_RE.exec(html)) !== null) {
    const url = m[1].startsWith('http') ? m[1] : `${ORIGIN}${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url });
  }

  return items;
}

async function enrichArticle(
  url: string,
): Promise<{ title: string; url: string; content: string } | null> {
  try {
    const html = await fetchHtml(url, 10_000);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/\s*[\|]\s*Seller Kingdom[^<]*/i, '').trim()
      : url;
    const content = stripHtml(html).slice(0, 800);
    if (content.length < 100) return null;
    return { title, url, content };
  } catch {
    return null;
  }
}

export interface CollectSummary {
  scraped: number;
  validated: number;
  saved: number;
}

export async function collectSellerKingdomArticles(): Promise<CollectSummary> {
  const today = todayDateOnly();
  const existingUrls = await queryExistingSourceUrls('셀러인텐트');

  const listing = await fetchListing();
  logger.info(AGENT, `목록 ${listing.length}건`);

  const newItems = listing.filter((l) => !existingUrls.has(l.url));
  logger.info(AGENT, `신규 ${newItems.length}건 (dedup 후)`);
  if (newItems.length === 0) return { scraped: 0, validated: 0, saved: 0 };

  const enriched = (
    await Promise.all(newItems.slice(0, 8).map((i) => enrichArticle(i.url)))
  ).filter(Boolean) as Array<{ title: string; url: string; content: string }>;

  const toValidate: ArticleToValidate[] = enriched.map((a) => ({
    title: a.title,
    url: a.url,
    content: a.content,
    source: 'sellerkingdom',
    language: 'en',
  }));

  const validationResults = await validateArticles(toValidate);
  const passed = validationResults.filter((r) => r.relevant);

  let saved = 0;
  for (const r of passed) {
    const article = enriched.find((a) => a.url === r.url);
    if (!article) continue;

    await saveToKnowledgeBase({
      title: article.title,
      category: '셀러인텐트',
      content: `## 핵심 인사이트 (한국어 요약)\n\n${r.summary}\n\n## 원문 (English)\n\n${article.content}`,
      contentText: r.summary,
      sourceUrl: article.url,
      tags: [
        ...r.tags.map((t) => `주제:${t}`),
        `타입:${r.contentType}`,
        `신뢰도:${r.confidenceLevel}`,
        '출처:SellerKingdom',
        '언어:영어',
      ],
      collectedAt: today,
      status: 'Inbox',
    });
    existingUrls.add(article.url);
    saved++;
  }

  logger.info(AGENT, `완료 — 신규 ${newItems.length}, 검증통과 ${passed.length}, 저장 ${saved}`);
  return { scraped: newItems.length, validated: passed.length, saved };
}
