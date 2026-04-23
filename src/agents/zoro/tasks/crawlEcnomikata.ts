// ECのミカタ 越境EC(크로스보더) 뉴스 크롤러
// https://www.ecnomikata.com/ecnews/cross-borderec/
// 일본 역직구·해외직구 관련 업계 뉴스 수집 (일본어 → Claude가 한국어 요약)

import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import {
  saveToKnowledgeBase,
  queryExistingSourceUrls,
} from '@/notion/databases/knowledgeDb.js';
import { validateArticles, type ArticleToValidate } from './validateContent.js';

const AGENT = 'zoro:ecnomikata';
const LISTING_URL = 'https://www.ecnomikata.com/ecnews/cross-borderec/';
const ORIGIN = 'https://www.ecnomikata.com';
// 기사 URL 패턴: /ecnews/cross-borderec/[숫자]/ 또는 /original_news/[숫자]/
const ARTICLE_URL_RE =
  /href="(\/(ecnews\/cross-borderec|original_news)\/(\d+)\/)"/g;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja-JP,ja;q=0.9',
};

// 게재일 파싱 — "2026/04/21" 형식
const DATE_INLINE_RE = /(\d{4})\/(\d{2})\/(\d{2})/;

// 최근 N일 이내 기사만 수집 (오래된 기사 제외)
const MAX_ARTICLE_AGE_DAYS = 7;

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

function isRecentDate(dateStr: string): boolean {
  const match = dateStr.match(DATE_INLINE_RE);
  if (!match) return true; // 날짜 불명 → 일단 포함
  const articleDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_ARTICLE_AGE_DAYS);
  return articleDate >= cutoff;
}

interface ListingItem {
  url: string;
  publishedAt?: string; // YYYY-MM-DD
}

async function fetchListing(): Promise<ListingItem[]> {
  const html = await fetchHtml(LISTING_URL);
  const items: ListingItem[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = ARTICLE_URL_RE.exec(html)) !== null) {
    const path = m[1];
    const url = `${ORIGIN}${path}`;
    if (seen.has(url)) continue;
    seen.add(url);

    // 해당 URL 주변 HTML에서 날짜 탐색 (앞뒤 200자)
    const pos = m.index;
    const context = html.slice(Math.max(0, pos - 200), pos + 200);
    const dateMatch = context.match(DATE_INLINE_RE);
    const publishedAt = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : undefined;

    if (!publishedAt || isRecentDate(publishedAt)) {
      items.push({ url, publishedAt });
    }
  }

  return items;
}

async function enrichArticle(
  item: ListingItem,
): Promise<{ title: string; url: string; content: string; publishedAt?: string } | null> {
  try {
    const html = await fetchHtml(item.url, 10_000);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    // ASCII '|' 및 전각 '｜' 모두 처리
    const title = titleMatch
      ? titleMatch[1].replace(/\s*[|｜]\s*EC.*$/u, '').trim()
      : item.url;
    const content = stripHtml(html).slice(0, 800);
    if (content.length < 100) return null;
    return { title, url: item.url, content, publishedAt: item.publishedAt };
  } catch {
    return null;
  }
}

export interface CollectSummary {
  scraped: number;
  validated: number;
  saved: number;
}

export async function collectEcnomikataArticles(): Promise<CollectSummary> {
  const today = todayDateOnly();
  const existingUrls = await queryExistingSourceUrls('역직구뉴스');

  const listing = await fetchListing();
  logger.info(AGENT, `목록 ${listing.length}건 (최근 ${MAX_ARTICLE_AGE_DAYS}일)`);

  const newItems = listing.filter((l) => !existingUrls.has(l.url));
  logger.info(AGENT, `신규 ${newItems.length}건 (dedup 후)`);
  if (newItems.length === 0) return { scraped: 0, validated: 0, saved: 0 };

  const enriched = (
    await Promise.all(newItems.slice(0, 10).map(enrichArticle))
  ).filter(Boolean) as Array<{ title: string; url: string; content: string; publishedAt?: string }>;

  const toValidate: ArticleToValidate[] = enriched.map((a) => ({
    title: a.title,
    url: a.url,
    content: a.content,
    source: 'ecnomikata',
    language: 'ja',
  }));

  const validationResults = await validateArticles(toValidate);
  const passed = validationResults.filter((r) => r.relevant);

  let saved = 0;
  for (const r of passed) {
    const article = enriched.find((a) => a.url === r.url);
    if (!article) continue;

    await saveToKnowledgeBase({
      title: article.title,
      category: '역직구뉴스',
      content: `## 핵심 인사이트 (한국어 요약)\n\n${r.summary}\n\n## 원문 발췌 (日本語)\n\n${article.content.slice(0, 500)}`,
      contentText: r.summary,
      sourceUrl: article.url,
      tags: [
        ...r.tags.map((t) => `주제:${t}`),
        `타입:${r.contentType}`,
        `신뢰도:${r.confidenceLevel}`,
        '출처:ECのミカタ',
        '언어:일본어',
      ],
      collectedAt: today,
      publishedAt: article.publishedAt,
      status: 'Inbox',
    });
    existingUrls.add(article.url);
    saved++;
  }

  logger.info(AGENT, `완료 — 신규 ${newItems.length}, 검증통과 ${passed.length}, 저장 ${saved}`);
  return { scraped: newItems.length, validated: passed.length, saved };
}
