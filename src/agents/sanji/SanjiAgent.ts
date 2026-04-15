import type { Message, TextChannel } from 'discord.js';
import { BaseAgent } from '@/agents/base/BaseAgent.js';
import { logger } from '@/utils/logger.js';
import { SANJI_PERSONALITY } from './sanji.personality.js';
import { crawlMarketNews } from './tasks/crawlMarket.js';
import { trackCompetitors } from './tasks/trackCompetitors.js';
import { sendDailyBriefing } from './tasks/sendBriefing.js';
import type { AgentName, AgentPersonality, ParsedTask, TaskResult } from '@/types/agent.types.js';

// 기본 모니터링 대상 소스 (실제 운영 시 env로 관리)
const DEFAULT_MARKET_SOURCES = [
  'https://www.itmedia.co.jp/news/', // IT 미디어 뉴스
];

export class SanjiAgent extends BaseAgent {
  readonly name: AgentName = 'sanji';
  readonly displayName = '상디';
  readonly personality: AgentPersonality = SANJI_PERSONALITY;

  // 디스코드 채널 참조 — 브리핑 전송용
  private briefingChannel: TextChannel | null = null;

  setBriefingChannel(channel: TextChannel): void {
    this.briefingChannel = channel;
  }

  // 메시지 → 태스크 파싱
  protected async parseTask(content: string): Promise<ParsedTask> {
    const lower = content.toLowerCase();

    if (lower.includes('브리핑') || lower.includes('시장') || lower.includes('daily')) {
      return {
        agentName: 'sanji',
        action: 'daily_briefing',
        params: {},
        rawMessage: content,
      };
    }

    if (lower.includes('경쟁사') || lower.includes('competitor') || lower.includes('추적')) {
      return {
        agentName: 'sanji',
        action: 'track_competitors',
        params: {},
        rawMessage: content,
      };
    }

    return {
      agentName: 'sanji',
      action: 'ask_claude',
      params: {},
      rawMessage: content,
    };
  }

  protected async executeTask(task: ParsedTask, message: Message): Promise<TaskResult> {
    switch (task.action) {
      case 'daily_briefing':
        return this.runDailyBriefing(message.channel as TextChannel);

      case 'track_competitors': {
        try {
          const marketData = await crawlMarketNews(DEFAULT_MARKET_SOURCES);
          const intelligence = await trackCompetitors(marketData, []);
          return {
            success: true,
            agentName: 'sanji',
            taskType: 'track_competitors',
            summary: `경쟁사 분석 완료.\n인사이트: ${intelligence.marketInsights.slice(0, 2).join(' / ')}`,
            executedAt: new Date(),
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            agentName: 'sanji',
            taskType: 'track_competitors',
            summary: '경쟁사 추적 실패',
            error: errMsg,
            executedAt: new Date(),
          };
        }
      }

      default: {
        const response = await this.askClaude(task.rawMessage);
        return {
          success: true,
          agentName: 'sanji',
          taskType: 'ask_claude',
          summary: response,
          executedAt: new Date(),
        };
      }
    }
  }

  // cron에서 직접 호출 — 일일 브리핑 실행
  async runDailyBriefing(channel?: TextChannel): Promise<TaskResult> {
    const targetChannel = channel ?? this.briefingChannel;

    try {
      logger.info('sanji', '일일 브리핑 시작');

      // 1. 시장 뉴스 수집
      const marketData = await crawlMarketNews(DEFAULT_MARKET_SOURCES);
      logger.info('sanji', `시장 뉴스 수집: ${marketData.length}건`);

      // 2. 경쟁사 인텔리전스 분석
      const intelligence = await trackCompetitors(marketData, []);

      // 3. Discord 채널에 브리핑 전송
      if (targetChannel) {
        await sendDailyBriefing(targetChannel, intelligence);
      }

      logger.info('sanji', '일일 브리핑 완료');

      return {
        success: true,
        agentName: 'sanji',
        taskType: 'daily_briefing',
        summary: `일일 브리핑 완료 — 인사이트 ${intelligence.marketInsights.length}개, 긴급알림 ${intelligence.urgentAlerts.length}개`,
        executedAt: new Date(),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('sanji', '일일 브리핑 실패', errMsg);
      return {
        success: false,
        agentName: 'sanji',
        taskType: 'daily_briefing',
        summary: '브리핑 실패',
        error: errMsg,
        executedAt: new Date(),
      };
    }
  }
}
