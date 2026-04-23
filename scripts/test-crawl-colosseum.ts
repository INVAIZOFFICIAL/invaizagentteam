// 콜로세움 크롤러 단발 테스트 — Claude 검증 포함 전체 파이프라인
// 실행: npx tsx scripts/test-crawl-colosseum.ts

import { collectColosseumArticles } from '@/agents/zoro/tasks/crawlColosseum.js';
import { logger } from '@/utils/logger.js';

async function main() {
  logger.info('test', 'Colosseum 크롤 테스트 시작 (검증 포함)');
  const result = await collectColosseumArticles();
  logger.info('test', '완료', result);
}

main().catch((err) => { console.error(err); process.exit(1); });
