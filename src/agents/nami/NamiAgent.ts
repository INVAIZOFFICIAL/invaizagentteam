import type { Message, TextChannel } from 'discord.js';
import { BaseAgent } from '@/agents/base/BaseAgent.js';
import { saveContentToNotion } from '@/notion/databases/contentDb.js';
import { logger } from '@/utils/logger.js';
import { NAMI_PERSONALITY } from './nami.personality.js';
import { crawlCompetitorProduct } from './tasks/crawlCompetitor.js';
import { generateQoo10Content } from './tasks/generateQoo10Content.js';
import type { AgentName, AgentPersonality, ParsedTask, TaskResult } from '@/types/agent.types.js';

export class NamiAgent extends BaseAgent {
  readonly name: AgentName = 'nami';
  readonly displayName = '나미';
  readonly personality: AgentPersonality = NAMI_PERSONALITY;

  // 메시지 내용 분석 → 태스크 종류 파악
  protected async parseTask(content: string): Promise<ParsedTask> {
    const lower = content.toLowerCase();

    // 경쟁사 크롤링 요청 감지
    if (lower.includes('경쟁사') || lower.includes('크롤') || lower.includes('벤치')) {
      // URL 추출 시도
      const urlMatch = content.match(/https?:\/\/[^\s]+/);
      return {
        agentName: 'nami',
        action: 'crawl_competitor',
        params: { url: urlMatch?.[0] ?? '' },
        rawMessage: content,
      };
    }

    // Qoo10 콘텐츠 생성 요청
    if (lower.includes('qoo10') || lower.includes('큐텐') || lower.includes('상품') || lower.includes('콘텐츠')) {
      return {
        agentName: 'nami',
        action: 'generate_content',
        params: {},
        rawMessage: content,
      };
    }

    // 성과 분석 요청
    if (lower.includes('성과') || lower.includes('분석') || lower.includes('ctr') || lower.includes('전환')) {
      return {
        agentName: 'nami',
        action: 'analyze_performance',
        params: {},
        rawMessage: content,
      };
    }

    // 기본: Claude에게 판단 위임
    return {
      agentName: 'nami',
      action: 'ask_claude',
      params: {},
      rawMessage: content,
    };
  }

  protected async executeTask(task: ParsedTask, message: Message): Promise<TaskResult> {
    const channel = message.channel as TextChannel;

    switch (task.action) {
      case 'crawl_competitor': {
        if (!task.params.url) {
          return {
            success: false,
            agentName: 'nami',
            taskType: 'crawl_competitor',
            summary: '숫자가 말해주잖아 — URL이 없으면 분석 못 해.',
            error: 'URL이 제공되지 않음',
            executedAt: new Date(),
          };
        }

        try {
          const competitorData = await crawlCompetitorProduct(task.params.url);
          const summary = `경쟁사 분석 완료!\n- 제목: ${competitorData.title}\n- 키워드: ${competitorData.keywords.slice(0, 5).join(', ')}`;

          // 노션에 저장
          const notionUrl = await saveContentToNotion({
            title: `[나미] 경쟁사 분석 — ${competitorData.title} — ${new Date().toLocaleDateString('ko-KR')}`,
            type: 'competitor_analysis',
            content: JSON.stringify(competitorData, null, 2),
            status: '완료',
          });

          return {
            success: true,
            agentName: 'nami',
            taskType: 'crawl_competitor',
            summary,
            notionPageUrl: notionUrl,
            executedAt: new Date(),
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error('nami', '경쟁사 크롤링 실패', errMsg);
          return {
            success: false,
            agentName: 'nami',
            taskType: 'crawl_competitor',
            summary: '크롤링 실패',
            error: errMsg,
            executedAt: new Date(),
          };
        }
      }

      case 'generate_content': {
        // 간단한 예시 — 실제로는 메시지에서 상품 정보를 파싱
        try {
          const content = await generateQoo10Content({
            productName: 'INVAIZ DayZero',
            category: '전자기기 액세서리',
            features: ['스마트 입력 디바이스', '다기능 다이얼', '생산성 향상'],
            targetAudience: '크리에이터, 디자이너, 영상 편집자',
            pricePoint: '중고가',
          });

          const summary =
            `콘텐츠 생성 완료!\n- 제목: ${content.title}\n- 키워드: ${content.keywords.slice(0, 5).join(', ')}`;

          const notionUrl = await saveContentToNotion({
            title: `[나미] Qoo10 콘텐츠 — ${content.title} — ${new Date().toLocaleDateString('ko-KR')}`,
            type: 'qoo10_content',
            content: `## 제목\n${content.title}\n\n## 짧은 설명\n${content.shortDescription}\n\n## 상세 설명\n${content.fullDescription}\n\n## 키워드\n${content.keywords.join(', ')}`,
            status: '완료',
          });

          return {
            success: true,
            agentName: 'nami',
            taskType: 'generate_content',
            summary,
            notionPageUrl: notionUrl,
            executedAt: new Date(),
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            agentName: 'nami',
            taskType: 'generate_content',
            summary: '콘텐츠 생성 실패',
            error: errMsg,
            executedAt: new Date(),
          };
        }
      }

      default: {
        // Claude에게 자유 형식으로 답변 요청
        const response = await this.askClaude(task.rawMessage);
        void channel; // 직접 사용 안 함 — 부모 클래스가 처리
        return {
          success: true,
          agentName: 'nami',
          taskType: 'ask_claude',
          summary: response,
          executedAt: new Date(),
        };
      }
    }
  }
}
