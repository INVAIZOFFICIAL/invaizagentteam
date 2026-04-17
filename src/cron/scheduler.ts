import cron from 'node-cron';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

// Sprint 2 job 등록 함수 — 에이전트 인스턴스를 받아 cron에 연결
// 사용 예: initSprint2Jobs(namiAgent, sanjiAgent)
export { registerDailyBriefingJob } from '@/cron/jobs/dailyBriefing.js';
export { registerContentGenerateJob } from '@/cron/jobs/contentGenerate.js';
export { registerFetchThreadsCommentsJob } from '@/cron/jobs/fetchThreadsComments.js';
export { registerFetchThreadsInsightsJob } from '@/cron/jobs/fetchThreadsInsights.js';
export { registerNamiReferenceJobs } from '@/cron/jobs/namiReferences.js';
export { registerPublishContentJob } from '@/cron/jobs/publishContent.js';

interface JobDefinition {
  name: string;
  schedule: string;
  fn: () => Promise<void>;
}

const locks = new Map<string, boolean>();

// cron 작업 등록 — 중복 실행 방지 lock 포함
// 맥미니(production)에서만 활성화
export function registerJob(job: JobDefinition): void {
  if (env.NODE_ENV !== 'production') {
    logger.info('cron', `개발 환경 — 스킵: ${job.name}`);
    return;
  }

  cron.schedule(job.schedule, async () => {
    if (locks.get(job.name)) {
      logger.warn('cron', `이미 실행 중 — 스킵: ${job.name}`);
      return;
    }

    locks.set(job.name, true);
    logger.info('cron', `시작: ${job.name}`);

    try {
      await job.fn();
      logger.info('cron', `완료: ${job.name}`);
    } catch (error) {
      logger.error('cron', `실패: ${job.name}`, error);
    } finally {
      locks.set(job.name, false);
    }
  });

  logger.info('cron', `등록: ${job.name} (${job.schedule})`);
}
