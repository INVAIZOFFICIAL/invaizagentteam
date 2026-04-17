import type { Message, TextChannel } from 'discord.js';
import { BaseAgent } from '@/agents/base/BaseAgent.js';
import { saveToKnowledgeBase } from '@/notion/databases/knowledgeDb.js';
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

    // 스레드 초안 생성 요청
    if (
      lower.includes('초안') ||
      (lower.includes('스레드') && !lower.includes('성과')) ||
      lower.includes('threads') ||
      lower.includes('포스트 만들어') ||
      lower.includes('포스트 생성')
    ) {
      return {
        agentName: 'nami',
        action: 'generate_threads_post',
        params: {},
        rawMessage: content,
      };
    }

    // 레퍼런스 수집 요청
    if (lower.includes('레퍼런스') && (lower.includes('수집') || lower.includes('모아') || lower.includes('찾아') || lower.includes('가져'))) {
      return {
        agentName: 'nami',
        action: 'collect_references',
        params: {},
        rawMessage: content,
      };
    }

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

          // 경쟁사 분석은 사단 공용 지식 베이스 DB 로 저장 (콘텐츠 DB 아님)
          const notionUrl = await saveToKnowledgeBase({
            title: `[나미] 경쟁사 분석 — ${competitorData.title} — ${new Date().toLocaleDateString('ko-KR')}`,
            category: '경쟁사',
            collector: 'nami',
            content: JSON.stringify(competitorData, null, 2),
            summary: `경쟁사 "${competitorData.title}" 의 키워드 ${competitorData.keywords.slice(0, 3).join(', ')} 분석`,
            sourceUrl: task.params.url,
            reliability: '1차자료',
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
        // TODO: 이 플로우는 레거시 Qoo10 용. Threads/Blog 콘텐츠 생성으로 재작업 필요.
        //       현재는 Qoo10 생성만 실행하고 노션 저장은 생략 (새 콘텐츠 DB 스키마 와 무관).
        //       다음 작업: generateThreadsPost / generateBlogPost 태스크 신설 + 여기에 연결.
        try {
          const content = await generateQoo10Content({
            productName: 'INVAIZ DayZero',
            category: '전자기기 액세서리',
            features: ['스마트 입력 디바이스', '다기능 다이얼', '생산성 향상'],
            targetAudience: '크리에이터, 디자이너, 영상 편집자',
            pricePoint: '중고가',
          });

          const summary =
            `콘텐츠 생성 완료! (임시 — 노션 저장 보류)\n- 제목: ${content.title}\n- 키워드: ${content.keywords.slice(0, 5).join(', ')}`;

          logger.warn(
            'nami',
            '레거시 generate_content 호출 — Threads/Blog 플로우로 재작업 대기중이라 노션 저장 생략',
          );

          return {
            success: true,
            agentName: 'nami',
            taskType: 'generate_content',
            summary,
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

      case 'collect_references': {
        const channel = message.channel as TextChannel;
        await channel.send('🍊 레퍼런스 수집 시작할게요. 잠깐만요.');
        try {
          const { collectReferencesOnce } = await import('./tasks/collectReferences.js');
          const result = await collectReferencesOnce();
          await channel.send(
            `🍊 레퍼런스 수집 완료했어요.\n새로 저장: **${result.saved}건** / 전체 처리: ${result.attempted}건`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 레퍼런스 수집 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'collect_references',
          summary: '레퍼런스 수집 완료',
          executedAt: new Date(),
        };
      }

      case 'generate_threads_post': {
        const { handleDraftRequest } = await import('./tasks/generateThreadsPost.js');
        await handleDraftRequest(message);
        return {
          success: true,
          agentName: 'nami',
          taskType: 'generate_threads_post',
          summary: '초안 요청 처리 완료',
          executedAt: new Date(),
        };
      }

      default: {
        const { draftSessions, draftRequestSessions } = await import('./tasks/generateThreadsPost.js');

        // 수동 초안 요청 Q&A 세션이 있으면 답변 처리 → 생성 실행
        if (draftRequestSessions.has(message.channelId)) {
          const { handleDraftRequest } = await import('./tasks/generateThreadsPost.js');
          const handled = await handleDraftRequest(message);
          if (handled) {
            return {
              success: true,
              agentName: 'nami',
              taskType: 'generate_threads_post',
              summary: '초안 생성 완료',
              executedAt: new Date(),
            };
          }
        }

        // 활성 검수 세션이 있으면 approval 루프 우선 처리
        if (draftSessions.has(message.channelId)) {
          const { handleContentApproval } = await import('./tasks/submitForApproval.js');
          const handled = await handleContentApproval(message);
          if (handled) {
            return {
              success: true,
              agentName: 'nami',
              taskType: 'content_approval',
              summary: '검수 처리 완료',
              executedAt: new Date(),
            };
          }
        }

        // Claude에게 자유 형식으로 답변 요청
        const response = await this.askClaude(task.rawMessage);
        void channel;
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
