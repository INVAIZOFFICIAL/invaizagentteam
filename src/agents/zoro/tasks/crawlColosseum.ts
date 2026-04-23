// Colosseum Global 블로그 — 마켓-트렌드 카테고리 크롤러
// https://blog.colosseum.global/category/마켓-트렌드
// 역직구·크로스보더·K-커머스 관련 한국어 아티클 수집

import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import {
  saveToKnowledgeBase,
  queryExistingSourceUrls,
} from '@/notion/databases/knowledgeDb.js';
import { validateArticles, type ArticleToValidate } from './validateContent.js';

const AGENT = 'zoro:colosseum';
const LISTING_URL =
  'https://blog.colosseum.global/category/%EB%A7%88%EC%BC%93-%ED%8A%B8%EB%A0%8C%EB%93%9C';
const ORIGIN = 'https://blog.colosseum.global';
// 글 목록에서 기사 URL 추출 — 슬러그 형식: /[a-z0-9-]+
const ARTICLE_URL_RE = /href="(https:\/\/blog\.colosseum\.global\/([a-z0-9][a-z0-9-]*[a-z0-9]))"/g;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchListing(): Promise<Array<{ title: string; url: string }>> {
  const html = await fetchHtml(LISTING_URL);
  const seen = new Set<string>();
  const articles: Array<{ title: string; url: string }> = [];
  let m: RegExpExecArray | null;

  // 카테고리·작성자·태그 등 내비 링크 제외
  const EXCLUDE = /category|author|tag|page|#/;

  while ((m = ARTICLE_URL_RE.exec(html)) !== null) {
    const url = m[1];
    const slug = m[2];
    if (seen.has(url) || EXCLUDE.test(url)) continue;
    seen.add(url);
    // 제목은 slug를 임시로 사용 — 개별 기사 fetch 후 <title> 태그로 교체
    articles.push({ title: slug, url });
  }

  return articles;
}

async function enrichArticle(
  item: { title: string; url: string },
): Promise<{ title: string; url: string; content: string } | null> {
  try {
    const html = await fetchHtml(item.url, 10_000);
    // <title> 태그에서 실제 제목 추출
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    // 사이트명 접미사만 제거 — 본문 대시는 유지
    const title = titleMatch
      ? titleMatch[1].replace(/\s*[\|]\s*(Colosseum|콜로세움)[^<]*/i, '').trim()
      : item.title;
    const content = stripHtml(html).slice(0, 800);
    if (content.length < 100) return null;
    return { title, url: item.url, content };
  } catch {
    return null;
  }
}

export interface CollectSummary {
  scraped: number;
  validated: number;
  saved: number;
}

export async function collectColosseumArticles(): Promise<CollectSummary> {
  const today = todayDateOnly();
  const existingUrls = await queryExistingSourceUrls('역직구뉴스');

  const listing = await fetchListing();
  logger.info(AGENT, `목록 ${listing.length}건`);

  const newItems = listing.filter((l) => !existingUrls.has(l.url));
  logger.info(AGENT, `신규 ${newItems.length}건 (dedup 후)`);
  if (newItems.length === 0) return { scraped: 0, validated: 0, saved: 0 };

  // 최대 10건/실행 — 각 기사 내용 수집
  const enriched = (
    await Promise.all(newItems.slice(0, 10).map(enrichArticle))
  ).filter(Boolean) as Array<{ title: string; url: string; content: string }>;

  const toValidate: ArticleToValidate[] = enriched.map((a) => ({
    title: a.title,
    url: a.url,
    content: a.content,
    source: 'colosseum',
    language: 'ko',
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
      content: `## 핵심 인사이트\n\n${r.summary}\n\n## 원문 발췌\n\n${article.content.slice(0, 500)}`,
      contentText: r.summary,
      sourceUrl: article.url,
      tags: [
        ...r.tags.map((t) => `주제:${t}`),
        `타입:${r.contentType}`,
        `신뢰도:${r.confidenceLevel}`,
        '출처:Colosseum',
        '언어:한국어',
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
