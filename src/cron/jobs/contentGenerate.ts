import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import type { NamiAgent } from '@/agents/nami/NamiAgent.js';
import { logger } from '@/utils/logger.js';

export function registerContentGenerateJob(_namiAgent: NamiAgent): void {
  registerJob({
    name: '나미:초안생성',
    schedule: CRON.DAILY_04,
    fn: async () => {
      logger.info('cron', '나미 스레드 초안 자동 생성 시작');
      const { generateThreadsPost } = await import(
        '@/agents/nami/teams/content/generateThreadsPost.js'
      );
      await generateThreadsPost();
    },
  });
}
