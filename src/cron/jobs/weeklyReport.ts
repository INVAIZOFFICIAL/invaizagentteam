import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';

export function registerWeeklyReportJob(): void {
  registerJob({
    name: '나미:주간성과리포트',
    schedule: CRON.WEEKLY_MON_09,
    fn: async () => {
      const { generateWeeklyReport } = await import(
        '@/agents/nami/teams/analytics/generateWeeklyReport.js'
      );
      await generateWeeklyReport();
    },
  });
}
