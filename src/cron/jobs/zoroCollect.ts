// 조로 역직구 셀러 정보 수집 cron
//
// 03:30 — Colosseum 마켓-트렌드 블로그 (한국어, 매일)
// 04:00 — ECのミカタ 크로스보더 뉴스 (일본어, 매일) ← namiContentGenerate와 동일 시간이므로 03:45로
// 04:30 — Seller Kingdom 셀러 전략 블로그 (영어, 월/수/금)
// 일요일 03:30 — Qoo10大学 성공사례 (일본어, 주 1회)
//
// 파이프라인: 스크랩 → Claude 관련성 검증 + 한국어 요약 → 노션 Inbox 저장

import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { collectColosseumArticles } from '@/agents/zoro/tasks/crawlColosseum.js';
import { collectEcnomikataArticles } from '@/agents/zoro/tasks/crawlEcnomikata.js';
import { collectSellerKingdomArticles } from '@/agents/zoro/tasks/crawlSellerKingdom.js';
import { collectQoo10UniversityStories } from '@/agents/zoro/tasks/crawlQoo10University.js';
import { closeBrowser } from '@/utils/browserPool.js';

export function registerZoroCollectJobs(): void {
  // Colosseum 마켓-트렌드 — 매일 03:30
  registerJob({
    name: '조로:Colosseum-수집',
    schedule: CRON.DAILY_03_30,
    fn: async () => {
      const s = await collectColosseumArticles();
      logger.info('cron', `조로 Colosseum — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
    },
  });

  // ECのミカタ 크로스보더 뉴스 — 매일 03:45
  registerJob({
    name: '조로:ECのミカタ-수집',
    schedule: CRON.DAILY_03_45,
    fn: async () => {
      const s = await collectEcnomikataArticles();
      logger.info('cron', `조로 ECのミカタ — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
    },
  });

  // Seller Kingdom 셀러 전략 — 월·수·금 04:30
  registerJob({
    name: '조로:SellerKingdom-수집',
    schedule: CRON.MON_WED_FRI_04_30,
    fn: async () => {
      const s = await collectSellerKingdomArticles();
      logger.info('cron', `조로 SellerKingdom — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
    },
  });

  // Qoo10大学 성공사례 — 매주 일요일 03:30 (Puppeteer 사용)
  registerJob({
    name: '조로:Qoo10大学-수집',
    schedule: CRON.WEEKLY_SUN_03_30,
    fn: async () => {
      try {
        const s = await collectQoo10UniversityStories();
        logger.info('cron', `조로 Qoo10大学 — 스크랩 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
      } finally {
        await closeBrowser();
      }
    },
  });

  logger.info('cron', '조로 수집 파이프라인 등록 완료 (03:30·03:45·04:30·일요일 03:30)');
}
