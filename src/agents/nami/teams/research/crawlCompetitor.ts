import puppeteer, { type Browser } from 'puppeteer';
import { logger } from '@/utils/logger.js';
import { withRetry } from '@/utils/retry.js';
import { nowIso } from '@/utils/timestamps.js';

export interface CompetitorContent {
  url: string;
  title: string;
  description: string;
  keywords: string[];
  price?: string;
  crawledAt: string;
}

// 브라우저 풀 — 요청마다 새 인스턴스 생성 금지
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

// robots.txt 확인 — 크롤링 허용 여부 체크
async function checkRobotsTxt(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true; // robots.txt 없으면 허용으로 간주

    const text = await res.text();
    const lines = text.split('\n');
    let isUserAgentAll = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase() === 'user-agent: *') {
        isUserAgentAll = true;
      } else if (isUserAgentAll && trimmed.toLowerCase().startsWith('disallow:')) {
        const disallowedPath = trimmed.slice('disallow:'.length).trim();
        if (disallowedPath === '/' || parsed.pathname.startsWith(disallowedPath)) {
          logger.warn('nami', `robots.txt 크롤링 금지: ${url}`);
          return false;
        }
      } else if (trimmed.toLowerCase().startsWith('user-agent:') && isUserAgentAll) {
        // 다른 user-agent 섹션으로 넘어가면 중단
        break;
      }
    }
    return true;
  } catch {
    // 확인 실패 시 안전하게 허용
    return true;
  }
}

// 경쟁사 Qoo10 상품 페이지 크롤링
export async function crawlCompetitorProduct(url: string): Promise<CompetitorContent> {
  const allowed = await checkRobotsTxt(url);
  if (!allowed) {
    throw new Error(`robots.txt에 의해 크롤링이 금지된 URL: ${url}`);
  }

  return withRetry(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      // 봇 탐지 우회 기본 설정
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });

      // 페이지에서 핵심 콘텐츠 추출
      const content = await page.evaluate(() => {
        const title =
          document.querySelector('h1')?.textContent?.trim() ??
          document.title ??
          '';

        // 상품 설명 — 다양한 셀렉터 시도
        const descSelectors = [
          '.goods_description',
          '.product-description',
          '#goods_description',
          '[class*="description"]',
          'meta[name="description"]',
        ];
        let description = '';
        for (const sel of descSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            description =
              el instanceof HTMLMetaElement ? el.content : el.textContent?.trim() ?? '';
            if (description) break;
          }
        }

        // 가격 추출
        const priceSelectors = ['.price', '.goods_price', '[class*="price"]', '[itemprop="price"]'];
        let price = '';
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            price = el.textContent?.trim() ?? '';
            if (price) break;
          }
        }

        // 메타 키워드
        const metaKeywords =
          (document.querySelector('meta[name="keywords"]') as HTMLMetaElement | null)?.content ?? '';
        const keywords = metaKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);

        return { title, description, price, keywords };
      });

      logger.info('nami', `경쟁사 크롤링 완료: ${url}`);

      return {
        url,
        title: content.title,
        description: content.description,
        keywords: content.keywords,
        price: content.price || undefined,
        crawledAt: nowIso(),
      };
    } finally {
      await page.close();
    }
  }, 'nami:crawl', { maxAttempts: 3, delayMs: 2000 });
}

// 브라우저 풀 종료 (프로세스 종료 시 호출)
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
