import type { Message, TextChannel } from 'discord.js';
import { BaseAgent } from '@/agents/base/BaseAgent.js';
import { env } from '@/config/env.js';
import { saveToKnowledgeBase } from '@/notion/databases/knowledgeDb.js';
import { logger } from '@/utils/logger.js';
import { NAMI_PERSONALITY } from './nami.personality.js';
import { crawlCompetitorProduct } from './teams/research/crawlCompetitor.js';
import { generateQoo10Content } from './teams/content/generateQoo10Content.js';
import type { AgentName, AgentPersonality, ParsedTask, TaskResult } from '@/types/agent.types.js';

export class NamiAgent extends BaseAgent {
  readonly name: AgentName = 'nami';
  readonly displayName = '나미';
  readonly personality: AgentPersonality = NAMI_PERSONALITY;

  // 확인 메시지 전송 후 ✅/❌ 리액션 대기 (30초 타임아웃 → 취소)
  private async awaitConfirmation(channel: TextChannel, text: string): Promise<boolean> {
    const msg = await channel.send(text);
    await msg.react('✅');
    await msg.react('❌');
    const collected = await msg.awaitReactions({
      filter: (r, u) => ['✅', '❌'].includes(r.emoji.name ?? '') && !u.bot,
      max: 1,
    });
    const emoji = collected.first()?.emoji.name;
    if (emoji !== '✅') {
      await channel.send('🍊 취소할게요.');
      return false;
    }
    return true;
  }

  // 메시지 내용 분석 → 태스크 종류 파악
  // 원칙: 명확한 실행 동사 없이 키워드만 있으면 → ask_claude (자연 대화)
  protected async parseTask(content: string): Promise<ParsedTask> {
    const lower = content.toLowerCase();

    // 취소/부정 단어 → Claude 호출 없이 무시
    const cancelWords = /^(취소|아니|됐어|필요없어|괜찮아|그만|stop|cancel)$/;
    if (cancelWords.test(lower.trim())) {
      return { agentName: 'nami', action: 'noop', params: {}, rawMessage: content };
    }

    // 실행 의도 동사 패턴
    const actionVerbs = /해줘|해달라|해봐|해줘요|부탁|시작|맡겨|진행|실행|돌려|돌려줘/;

    // 특정 계정 수집 — "@handle 수집해줘" 또는 "handle 수집해줘" 패턴
    const handleMatch =
      content.match(/@([\w.]+)/) ??
      ((lower.includes('수집') || lower.includes('크롤') || lower.includes('레퍼런스'))
        ? content.match(/\b([a-zA-Z][\w.]{2,})\b/)
        : null);
    if (
      handleMatch &&
      (lower.includes('수집') || lower.includes('크롤') || lower.includes('가져') || lower.includes('레퍼런스')) &&
      actionVerbs.test(lower)
    ) {
      return { agentName: 'nami', action: 'collect_references', params: { handle: handleMatch[1] }, rawMessage: content };
    }

    // 스레드 초안 생성 — 명확한 생성 요청 (collect보다 먼저 체크)
    if (
      (lower.includes('초안') && actionVerbs.test(lower)) ||
      lower.includes('초안 만들어') ||
      lower.includes('초안 써') ||
      lower.includes('초안 생성') ||
      lower.includes('포스트 만들어') ||
      lower.includes('포스트 생성')
    ) {
      return { agentName: 'nami', action: 'generate_threads_post', params: {}, rawMessage: content };
    }

    // 피드/트렌딩 수집 — "피드", "트렌딩", "잘되는", "인기", "핫한" + 실행 동사
    if (
      !lower.includes('초안') &&
      (lower.includes('피드') || lower.includes('트렌딩') || lower.includes('잘되는') ||
       lower.includes('인기') || lower.includes('핫한') || lower.includes('뜨는')) &&
      (lower.includes('수집') || lower.includes('찾아') || lower.includes('가져') || actionVerbs.test(lower))
    ) {
      return { agentName: 'nami', action: 'collect_feed', params: {}, rawMessage: content };
    }

    // 레퍼런스 수집 — "레퍼런스" + "수집/모아/찾아/가져" + 실행 동사 (초안 요청 제외)
    if (
      !lower.includes('초안') &&
      lower.includes('레퍼런스') &&
      (lower.includes('수집') || lower.includes('모아') || lower.includes('찾아') || lower.includes('가져')) &&
      actionVerbs.test(lower)
    ) {
      return { agentName: 'nami', action: 'collect_references', params: {}, rawMessage: content };
    }

    // 경쟁사 크롤링 — URL 있을 때만
    if ((lower.includes('경쟁사') || lower.includes('크롤') || lower.includes('벤치')) && content.includes('http')) {
      const urlMatch = content.match(/https?:\/\/[^\s]+/);
      return { agentName: 'nami', action: 'crawl_competitor', params: { url: urlMatch?.[0] ?? '' }, rawMessage: content };
    }

    // 주간 리포트 — 명확한 리포트 요청
    if (
      lower.includes('주간리포트') ||
      lower.includes('주간 리포트') ||
      lower.includes('성과리포트') ||
      lower.includes('성과 리포트') ||
      (lower.includes('리포트') && (lower.includes('써줘') || lower.includes('만들어') || lower.includes('생성') || lower.includes('작성') || actionVerbs.test(lower)))
    ) {
      return { agentName: 'nami', action: 'weekly_report', params: {}, rawMessage: content };
    }

    // 댓글 수집 — 명확한 수집 요청
    if (
      (lower.includes('댓글') || lower.includes('리플') || lower.includes('reply') || lower.includes('replies')) &&
      (lower.includes('수집') || lower.includes('가져') || lower.includes('모아') || actionVerbs.test(lower))
    ) {
      return { agentName: 'nami', action: 'fetch_comments', params: {}, rawMessage: content };
    }

    // 성과/인사이트 수집 — 명확한 수집 요청 (analyze_performance 와 구분: "수집"/"가져" 동사 필요)
    if (
      (lower.includes('인사이트') || lower.includes('지표 수집') || lower.includes('성과 수집') ||
       (lower.includes('지표') && (lower.includes('수집') || lower.includes('가져')))) &&
      (lower.includes('수집') || lower.includes('가져') || actionVerbs.test(lower))
    ) {
      return { agentName: 'nami', action: 'fetch_insights', params: {}, rawMessage: content };
    }

    // 성과 확인 — 명확한 조회 요청
    if ((lower.includes('성과') || lower.includes('지표') || lower.includes('ctr')) && actionVerbs.test(lower)) {
      return { agentName: 'nami', action: 'analyze_performance', params: {}, rawMessage: content };
    }

    // 나머지 전부 → 자연 대화 (Claude가 맥락 보고 판단)
    return { agentName: 'nami', action: 'ask_claude', params: {}, rawMessage: content };
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
            content: JSON.stringify(competitorData, null, 2),
            summary: `경쟁사 "${competitorData.title}" 의 키워드 ${competitorData.keywords.slice(0, 3).join(', ')} 분석`,
            sourceUrl: task.params.url,
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

      case 'collect_feed': {
        const feedConfirmed = await this.awaitConfirmation(
          channel,
          '🍊 피드 수집할까요? 홈 피드 스크롤해서 트렌딩 콘텐츠 가져올게요. (약 5~10분 소요)\n✅ 수락 / ❌ 취소',
        );
        if (!feedConfirmed) return { success: true, agentName: 'nami', taskType: 'collect_feed', summary: '취소', alreadyReplied: true, executedAt: new Date() };
        await channel.send('🍊 피드 수집 시작할게요. 홈 피드 스크롤 중이에요. 잠깐만요.');
        try {
          const { collectFeedOnce } = await import('./teams/research/collectReferences.js');
          const result = await collectFeedOnce();
          const dbId = env.NOTION_KNOWLEDGE_DB_ID?.replace(/-/g, '');
          const dbLink = dbId ? `\n📎 https://www.notion.so/${dbId}` : '';
          if (result.saved === 0) {
            await channel.send(`🍊 피드에서 저장할 콘텐츠가 없었어요. (수집: ${result.collected}건)${dbLink}`);
          } else {
            await channel.send(`🍊 피드 수집 완료. 저장: **${result.saved}건** / 수집: ${result.collected}건${dbLink}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 피드 수집 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'collect_feed',
          summary: '피드 수집 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'collect_references': {
        const channel = message.channel as TextChannel;
        const targetHandle = task.params.handle as string | undefined;
        const targetLabel = targetHandle ? `@${targetHandle}` : '전체 시드 계정';
        const refConfirmed = await this.awaitConfirmation(
          channel,
          `🍊 레퍼런스 수집할까요? (${targetLabel}) 시드 계정 전체 순회라 **10~15분** 소요돼요.\n✅ 수락 / ❌ 취소`,
        );
        if (!refConfirmed) return { success: true, agentName: 'nami', taskType: 'collect_references', summary: '취소', alreadyReplied: true, executedAt: new Date() };
        await channel.send(`🍊 레퍼런스 수집 시작할게요 (${targetLabel}). 잠깐만요.`);
        try {
          const { collectReferencesOnce } = await import('./teams/research/collectReferences.js');
          const result = await collectReferencesOnce(targetHandle);
          const dbId = env.NOTION_KNOWLEDGE_DB_ID?.replace(/-/g, '');
          const dbLink = dbId ? `\n📎 https://www.notion.so/${dbId}` : '';

          if (result.collected === 0) {
            await channel.send(
              `🍊 (${targetLabel}) 포스트를 가져오지 못했어요.\n크롤링 실패 가능성 — 로그 확인 필요. (방문계정: ${result.attempted}개)`,
            );
          } else if (result.saved === 0) {
            await channel.send(
              `🍊 (${targetLabel}) 포스트 ${result.collected}건 찾았는데 노션 저장에 실패했어요.\n로그 확인 필요.${dbLink}`,
            );
          } else {
            await channel.send(
              `🍊 레퍼런스 수집 완료 (${targetLabel}).\n저장: **${result.saved}건** / 수집: ${result.collected}건 / 방문: ${result.attempted}개${dbLink}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 레퍼런스 수집 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'collect_references',
          summary: '레퍼런스 수집 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'generate_threads_post': {
        const { handleDraftRequest } = await import('./teams/content/generateThreadsPost.js');
        await handleDraftRequest(message);
        return {
          success: true,
          agentName: 'nami',
          taskType: 'generate_threads_post',
          summary: '초안 요청 처리 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'weekly_report': {
        await channel.send('🍊 주간 성과 리포트 작성 시작할게요. 데이터 모으고 분석하는 데 1~2분 걸릴 수 있어요. 잠깐만요.');
        try {
          const { generateWeeklyReport } = await import('@/agents/nami/teams/analytics/generateWeeklyReport.js');
          await generateWeeklyReport();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 주간 리포트 생성 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'weekly_report',
          summary: '주간 리포트 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'fetch_comments': {
        await channel.send('🍊 Threads 댓글 수집 시작할게요. 잠깐만요.');
        try {
          const { fetchThreadsCommentsOnce } = await import('@/cron/jobs/fetchThreadsComments.js');
          const res = await fetchThreadsCommentsOnce();
          if (res.skipReason) {
            await channel.send(`🍊 댓글 수집 스킵: ${res.skipReason}`);
          } else if (res.result === '실패') {
            await channel.send(`🍊 댓글 수집 실패했어요. (${res.skipReason ?? res.result})`);
          } else {
            await channel.send(`🍊 댓글 수집 완료. 신규 **${res.totalNew}건** 저장했어요. (${res.result})`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 댓글 수집 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'fetch_comments',
          summary: '댓글 수집 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'fetch_insights': {
        await channel.send('🍊 Threads 성과 지표 수집 시작할게요. 잠깐만요.');
        try {
          const { fetchThreadsInsightsOnce } = await import('@/cron/jobs/fetchThreadsInsights.js');
          const res = await fetchThreadsInsightsOnce();
          if (res.skipReason) {
            await channel.send(`🍊 성과 수집 스킵: ${res.skipReason}`);
          } else if (res.result === '실패') {
            await channel.send(`🍊 성과 수집 실패했어요. (${res.skipReason ?? '알 수 없는 오류'})`);
          } else {
            await channel.send(`🍊 성과 수집 완료. 신규 스냅샷 **${res.totalNew}건** 저장했어요. (${res.result})`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await channel.send(`🍊 성과 수집 실패했어요.\n\`${msg.slice(0, 200)}\``);
        }
        return {
          success: true,
          agentName: 'nami',
          taskType: 'fetch_insights',
          summary: '성과 수집 완료',
          alreadyReplied: true,
          executedAt: new Date(),
        };
      }

      case 'noop':
        return { success: true, agentName: 'nami', taskType: 'noop', summary: '무시', alreadyReplied: true, executedAt: new Date() };

      default: {
        const { draftSessions, draftRequestSessions } = await import('./teams/content/generateThreadsPost.js');

        // 수동 초안 요청 Q&A 세션이 있으면 답변 처리 → 생성 실행
        if (draftRequestSessions.has(message.channelId)) {
          const { handleDraftRequest } = await import('./teams/content/generateThreadsPost.js');
          const handled = await handleDraftRequest(message);
          if (handled) {
            return {
              success: true,
              agentName: 'nami',
              taskType: 'generate_threads_post',
              summary: '초안 생성 완료',
              alreadyReplied: true,
              executedAt: new Date(),
            };
          }
        }

        // 활성 검수 세션이 있으면 approval 루프 우선 처리
        if (draftSessions.has(message.channelId)) {
          const { handleContentApproval } = await import('./teams/content/submitForApproval.js');
          const handled = await handleContentApproval(message);
          if (handled) {
            return {
              success: true,
              agentName: 'nami',
              taskType: 'content_approval',
              summary: '검수 처리 완료',
              alreadyReplied: true,
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
