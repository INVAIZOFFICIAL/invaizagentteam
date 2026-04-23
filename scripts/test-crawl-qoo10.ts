// Qoo10 베스트셀러 크롤러 단발 테스트
// 실행: npx tsx scripts/test-crawl-qoo10.ts
//
// 출력을 보고 DOM 셀렉터가 맞는지 확인. 항목이 0건이면
// crawlQoo10.ts의 scrapeBestsellers() 셀렉터를 수정할 것.

import { collectQoo10Bestsellers } from '@/agents/zoro/tasks/crawlQoo10.js';
import { closeBrowser } from '@/utils/browserPool.js';
import { logger } from '@/utils/logger.js';

async function main() {
  logger.info('test', 'Qoo10 크롤 테스트 시작');
  try {
    const result = await collectQoo10Bestsellers();
    logger.info('test', '완료', result);
  } finally {
    await closeBrowser();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
