// ECのミカタ 크로스보더 크롤러 단발 테스트
// 실행: npx tsx scripts/test-crawl-ecnomikata.ts

import { collectEcnomikataArticles } from '@/agents/zoro/tasks/crawlEcnomikata.js';
import { logger } from '@/utils/logger.js';

async function main() {
  logger.info('test', 'ECのミカタ 크롤 테스트 시작 (검증 포함)');
  const result = await collectEcnomikataArticles();
  logger.info('test', '완료', result);
}

main().catch((err) => { console.error(err); process.exit(1); });
