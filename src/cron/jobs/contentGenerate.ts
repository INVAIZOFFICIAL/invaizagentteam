import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import type { NamiAgent } from '@/agents/nami/NamiAgent.js';
import { logger } from '@/utils/logger.js';

// 나미 콘텐츠 생성 cron 등록 — 매일 10:00
export function registerContentGenerateJob(namiAgent: NamiAgent): void {
  registerJob({
    name: '나미:콘텐츠생성',
    schedule: CRON.DAILY_10,
    fn: async () => {
      logger.info('cron', '나미 자동 콘텐츠 생성 시작');

      // cron 자동 실행 시 더미 메시지로 태스크 트리거
      // 실제 운영 시 노션 콘텐츠 큐에서 작업 가져오도록 확장
      const { generateQoo10Content } = await import('@/agents/nami/tasks/generateQoo10Content.js');
      const { saveContentToNotion } = await import('@/notion/databases/contentDb.js');

      const content = await generateQoo10Content({
        productName: 'INVAIZ DayZero',
        category: '전자기기 액세서리',
        features: ['스마트 다이얼 컨트롤러', '멀티 기능 입력 디바이스', '크리에이터 최적화'],
        targetAudience: '영상 편집자, 그래픽 디자이너, 스트리머',
        pricePoint: '중고가 프리미엄',
      });

      await saveContentToNotion({
        title: `[나미:자동] Qoo10 콘텐츠 — ${new Date().toLocaleDateString('ko-KR')}`,
        type: 'qoo10_content',
        content: `## 제목\n${content.title}\n\n## 짧은 설명\n${content.shortDescription}\n\n## 상세 설명\n${content.fullDescription}\n\n## 키워드\n${content.keywords.join(', ')}\n\n## 핵심 판매 포인트\n${content.sellingPoints.map(p => `- ${p}`).join('\n')}`,
        status: '초안',
        agentName: 'nami',
      });

      logger.info('cron', `나미 콘텐츠 생성 완료: ${content.title}`);
      void namiAgent; // 에이전트 참조 유지용 (향후 확장)
    },
  });
}
