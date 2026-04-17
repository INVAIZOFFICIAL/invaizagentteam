import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';

export function registerPublishContentJob(): void {
  registerJob({
    name: '나미:콘텐츠발행',
    schedule: CRON.EVERY_10MIN,
    fn: async () => {
      const { publishPendingThreads } = await import(
        '@/agents/nami/tasks/publishThread.js'
      );
      await publishPendingThreads();
    },
  });
}
