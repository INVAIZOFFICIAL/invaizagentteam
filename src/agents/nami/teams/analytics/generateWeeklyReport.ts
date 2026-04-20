import type { TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '@/agents/nami/nami.personality.js';
import { getPublishedThreadsContents } from '@/notion/databases/contentDb.js';
import { getRecentPerformanceSnapshots } from '@/notion/databases/performanceDb.js';
import { getRecentCommentsByContent } from '@/notion/databases/commentDb.js';
import { saveWeeklyReport } from '@/notion/databases/weeklyReportDb.js';

const REPORT_WINDOW_DAYS = 7;


function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

export async function generateWeeklyReport(): Promise<void> {
  logger.info('nami', '주간 성과 리포트 생성 시작');

  const channel = discordClient.channels.cache.get(env.DISCORD_CHANNEL_NAMI) as
    | TextChannel
    | undefined;

  try {
    // 1. 지난 7일 발행 콘텐츠 조회
    const contents = await getPublishedThreadsContents(REPORT_WINDOW_DAYS);

    if (contents.length === 0) {
      logger.info('nami', '주간 리포트: 지난 7일 발행 콘텐츠 없음');
      await channel?.send(
        '🍊 지난 7일 발행된 Threads 콘텐츠가 없어서 주간 리포트를 생성하지 않았어요.',
      );
      return;
    }

    const contentPageIds = contents.map((c) => c.pageId);

    // 2. 성과 스냅샷 + 댓글 병렬 조회
    const [snapshots, comments] = await Promise.all([
      getRecentPerformanceSnapshots(contentPageIds, REPORT_WINDOW_DAYS + 5), // D+1~D+5 포함
      getRecentCommentsByContent(contentPageIds, REPORT_WINDOW_DAYS),
    ]);

    // 3. 분석 프롬프트 구성
    const contentSummary = contents
      .map((c) => {
        const snaps = snapshots.filter((s) => s.contentPageId === c.pageId);
        const latestSnap = snaps.sort((a, b) => b.daysElapsed - a.daysElapsed)[0];
        const contentComments = comments.filter((cm) => cm.contentPageId === c.pageId);

        return [
          `## 콘텐츠: "${c.title}"`,
          `발행일: ${c.publishDate}`,
          latestSnap
            ? `성과(D+${latestSnap.daysElapsed}): 조회수 ${latestSnap.views} / 좋아요 ${latestSnap.likes} / 댓글 ${latestSnap.replies} / 참여율 ${(latestSnap.engagementRate * 100).toFixed(2)}%`
            : '성과 데이터 없음',
          contentComments.length > 0
            ? `댓글 ${contentComments.length}개:\n${contentComments
                .slice(0, 5)
                .map((cm) => `  - @${cm.username}: ${cm.text.slice(0, 80)}`)
                .join('\n')}`
            : '댓글 없음',
        ].join('\n');
      })
      .join('\n\n');

    const prompt = `지난 7일간 내가 발행한 Threads 콘텐츠 ${contents.length}개의 성과를 분석해줘.

${contentSummary}

아래 항목을 반드시 포함해서 주간 성과 리포트를 마크다운으로 작성해줘:

1. **이번 주 요약** — 전체 조회수/인게이지먼트 총합 한 줄 정리
2. **성과 TOP 콘텐츠** — 참여율 기준 상위 콘텐츠 1~2개와 잘된 이유 분석
3. **부진 콘텐츠 분석** — 참여율 낮은 콘텐츠와 개선 방향
4. **댓글 감성 요약** — 어떤 반응이 많았는지 (긍정/부정/질문)
5. **다음 주 제작 방향 권고** — 구체적인 hooking 유형 또는 주제 2~3개 제안

숫자가 말해주잖아요. 데이터 기반으로 냉정하게 분석해줘요.`;

    logger.info('nami', `주간 리포트 분석 시작: ${contents.length}개 콘텐츠`);
    const analysisMarkdown = await runClaude(prompt, 'nami', {
      systemPrompt: NAMI_PERSONALITY.systemPrompt,
      timeoutMs: 180_000,
    });

    // 4. Notion 저장
    const today = todayIso();
    const reportTitle = `주간 성과 리포트 — ${todayIso()}`;
    const notionPageId = await saveWeeklyReport({
      title: reportTitle,
      reportDate: today,
      contentPageIds,
      analysisMarkdown,
    });

    // 5. Discord 전송
    const dbId = env.NOTION_WEEKLY_REPORT_DB_ID?.replace(/-/g, '');
    const notionLink = notionPageId
      ? `\n📎 https://www.notion.so/${notionPageId.replace(/-/g, '')}`
      : dbId
        ? `\n📎 https://www.notion.so/${dbId}`
        : '';

    // 분석 결과 Discord 전송 (2000자 제한 분할)
    const summary = analysisMarkdown.slice(0, 1500);
    await channel?.send(
      `🍊 **${reportTitle}**\n\n${summary}${analysisMarkdown.length > 1500 ? '\n...(전체 내용은 노션 참고)' : ''}${notionLink}`,
    );

    logger.info('nami', `주간 리포트 완료: ${reportTitle}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('nami', '주간 리포트 생성 실패', err);
    await channel?.send(
      `🍊 주간 리포트 생성 중 오류가 발생했어요.\n\`${msg.slice(0, 200)}\``,
    );
  }
}
