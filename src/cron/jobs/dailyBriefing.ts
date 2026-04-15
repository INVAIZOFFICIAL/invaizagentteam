import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import type { SanjiAgent } from '@/agents/sanji/SanjiAgent.js';
import { logger } from '@/utils/logger.js';

// 상디 일일 브리핑 cron 등록 — 매일 09:00
export function registerDailyBriefingJob(sanjiAgent: SanjiAgent): void {
  registerJob({
    name: '상디:일일브리핑',
    schedule: CRON.DAILY_09,
    fn: async () => {
      logger.info('cron', '상디 일일 브리핑 cron 시작');
      const result = await sanjiAgent.runDailyBriefing();
      if (!result.success) {
        throw new Error(result.error ?? '브리핑 실패');
      }
      logger.info('cron', `상디 일일 브리핑 완료: ${result.summary}`);
    },
  });
}
