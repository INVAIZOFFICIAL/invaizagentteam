import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import type { NamiAgent } from '@/agents/nami/NamiAgent.js';
import { logger } from '@/utils/logger.js';

/**
 * 나미 콘텐츠 생성 cron 등록 — 매일 10:00
 *
 * TODO: 이 job 은 레거시 Qoo10 용. Threads/Blog 콘텐츠 생성으로 재작업 필요.
 *       현재는 Qoo10 생성만 실행하고 노션 저장은 생략 (새 콘텐츠 DB 스키마 와 무관).
 *       다음 작업: generateThreadsPost / generateBlogPost 태스크 신설 + 여기에 연결.
 */
export function registerContentGenerateJob(namiAgent: NamiAgent): void {
  registerJob({
    name: '나미:콘텐츠생성',
    schedule: CRON.DAILY_10,
    fn: async () => {
      logger.info('cron', '나미 자동 콘텐츠 생성 시작 (레거시 Qoo10 — 노션 저장 생략)');

      const { generateQoo10Content } = await import('@/agents/nami/tasks/generateQoo10Content.js');

      const content = await generateQoo10Content({
        productName: 'INVAIZ DayZero',
        category: '전자기기 액세서리',
        features: ['스마트 다이얼 컨트롤러', '멀티 기능 입력 디바이스', '크리에이터 최적화'],
        targetAudience: '영상 편집자, 그래픽 디자이너, 스트리머',
        pricePoint: '중고가 프리미엄',
      });

      logger.warn(
        'cron',
        `레거시 Qoo10 콘텐츠 생성 완료 (노션 저장 보류): ${content.title}`,
      );
      void namiAgent; // 에이전트 참조 유지용 (향후 확장)
    },
  });
}
