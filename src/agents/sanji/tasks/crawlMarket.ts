import puppeteer, { type Browser } from 'puppeteer';
import { logger } from '@/utils/logger.js';
import { withRetry } from '@/utils/retry.js';
import { nowIso } from '@/utils/timestamps.js';

export interface MarketInfo {
  source: string;        // 출처 URL
  headline: string;      // 기사/공지 제목
  summary: string;       // 요약 내용
  category: 'price' | 'trend' | 'news' | 'regulation'; // 정보 유형
  importance: 'high' | 'medium' | 'low';
  crawledAt: string;
}

// 브라우저 풀 — 상디 전용 (나미와 공유 안 함)
let sanjisBrowser: Browser | null = null;

async function getSanjiBrowser(): Promise<Browser> {
  if (!sanjisBrowser || !sanjisBrowser.connected) {
    sanjisBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return sanjisBrowser;
}

// robots.txt 확인
async function isAllowed(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true;

    const text = await res.text();
    const lines = text.split('\n');
    let isUserAgentAll = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase() === 'user-agent: *') {
        isUserAgentAll = true;
      } else if (isUserAgentAll && trimmed.toLowerCase().startsWith('disallow:')) {
        const path = trimmed.slice('disallow:'.length).trim();
        if (path === '/' || parsed.pathname.startsWith(path)) {
          logger.warn('sanji', `robots.txt 크롤링 금지: ${url}`);
          return false;
        }
      } else if (trimmed.toLowerCase().startsWith('user-agent:') && isUserAgentAll) {
        break;
      }
    }
    return true;
  } catch {
    return true;
  }
}

// 시장 뉴스 사이트에서 정보 수집
export async function crawlMarketNews(sources: string[]): Promise<MarketInfo[]> {
  const results: MarketInfo[] = [];

  for (const url of sources) {
    const allowed = await isAllowed(url);
    if (!allowed) {
      logger.warn('sanji', `건너뜀 (robots.txt 금지): ${url}`);
      continue;
    }

    try {
      const info = await withRetry(async () => {
        const browser = await getSanjiBrowser();
        const page = await browser.newPage();

        try {
          await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          );
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

          // 뉴스/기사 목록 추출
          const items = await page.evaluate(() => {
            const articleSelectors = ['article', '.news-item', '.post', 'h2 a', 'h3 a'];
            const extracted: { headline: string; link: string }[] = [];

            for (const sel of articleSelectors) {
              const els = document.querySelectorAll(sel);
              if (els.length > 0) {
                els.forEach(el => {
                  const text = el.textContent?.trim() ?? '';
                  const href = (el instanceof HTMLAnchorElement ? el.href : el.querySelector('a')?.href) ?? '';
                  if (text && text.length > 10) {
                    extracted.push({ headline: text.slice(0, 200), link: href });
                  }
                });
                break;
              }
            }

            return extracted.slice(0, 10); // 최대 10개
          });

          return items.map(item => ({
            source: url,
            headline: item.headline,
            summary: item.headline, // 상세 요약은 LLM이 처리
            category: 'news' as const,
            importance: 'medium' as const,
            crawledAt: nowIso(),
          }));
        } finally {
          await page.close();
        }
      }, 'sanji:crawl', { maxAttempts: 2, delayMs: 3000 });

      results.push(...info);
      logger.info('sanji', `시장 정보 수집 완료: ${url} (${info.length}건)`);
    } catch (error) {
      logger.error('sanji', `시장 정보 수집 실패: ${url}`, error);
    }
  }

  return results;
}

// 브라우저 풀 종료
export async function closeSanjiBrowser(): Promise<void> {
  if (sanjisBrowser) {
    await sanjisBrowser.close();
    sanjisBrowser = null;
  }
}
