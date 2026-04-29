import type { TextChannel } from 'discord.js';
import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { fetchMyRecentThreads, fetchPostInsights } from '@/threads/client.js';
import { findContentPageByUrl } from '@/notion/databases/contentDb.js';
import { savePerformanceSnapshot, milestoneExists } from '@/notion/databases/performanceDb.js';
import { getJobState, updateJobState, type JobResult } from '@/notion/databases/systemMetaDb.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';

const JOB_NAME = 'threads_insights_fetch';
// 발행 후 5일간 매일 1회 수집 (D+1~D+5)
const MILESTONES = [1, 2, 3, 4, 5] as const;
const FETCH_WINDOW_DAYS = 5;

/**
 * 스레드 성과 지표 1회 마일스톤 수집
 *
 * 로직:
 *   1. 시스템 메타 DB 에서 작업 활성화 여부 확인
 *   2. Threads API: 최근 30일 내 내 글 목록 조회
 *   3. 각 글을 콘텐츠 DB 에서 permalink 매칭
 *   4. 경과일 기준으로 아직 안 찍힌 마일스톤(D+0/1/3/7/14/30) 확인
 *   5. 미수집 마일스톤에 대해 인사이트 fetch + 성과 DB 저장
 *   6. 시스템 메타 DB 결과 기록
 *
 * cron 과 디스코드 수동 트리거 모두 이 함수를 호출.
 */
export async function fetchThreadsInsightsOnce(): Promise<{
  totalNew: number;
  result: string;
  skipReason?: string;
}> {
  const startedAt = new Date();
  logger.info('nami', '스레드 성과 수집 시작');

  const jobState = await getJobState(JOB_NAME);
  if (!jobState) {
    logger.error('nami', `시스템 메타 DB 에 "${JOB_NAME}" row 없음 — 수집 중단`);
    return { totalNew: 0, result: '실패', skipReason: `시스템 메타 DB에 "${JOB_NAME}" row 없음` };
  }
  if (!jobState.isActive) {
    logger.info('nami', `"${JOB_NAME}" 비활성 상태 — 스킵`);
    return { totalNew: 0, result: '스킵', skipReason: '비활성화 상태' };
  }

  let totalNew = 0;
  let result: JobResult = '성공';
  let errorMsg = '';
  const newSnapshots: { milestone: number; preview: string; views: number; likes: number; replies: number; reposts: number; permalink: string }[] = [];

  try {
    // 1. 내 최근 글 (최근 30일)
    const fetchWindow = new Date(Date.now() - FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const myPosts = await fetchMyRecentThreads(fetchWindow, 100);
    logger.info('nami', `내 최근 글 ${myPosts.length}개`);

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 2. 각 글 순회 — 마일스톤 체크
    for (const post of myPosts) {
      if (!post.permalink || !post.timestamp) continue;

      // 콘텐츠 DB 매칭
      const contentPageId = await findContentPageByUrl(post.permalink);
      if (!contentPageId) {
        logger.debug('nami', `콘텐츠 매칭 없음 (permalink=${post.permalink})`);
        continue;
      }

      // 경과일 계산
      const publishDate = new Date(post.timestamp);
      const daysElapsed = Math.floor(
        (now.getTime() - publishDate.getTime()) / (24 * 60 * 60 * 1000),
      );

      // 인사이트는 글당 1번만 fetch (여러 마일스톤이 밀려있어도 동일 지표)
      let insights: Awaited<ReturnType<typeof fetchPostInsights>> | null = null;

      for (const milestone of MILESTONES) {
        if (daysElapsed < milestone) break; // MILESTONES 는 오름차순 정렬이라 빠르게 탈출

        const exists = await milestoneExists(contentPageId, milestone);
        if (exists) continue;

        // 인사이트 lazy fetch (필요할 때만 1번)
        if (!insights) {
          try {
            insights = await fetchPostInsights(post.id);
          } catch (err) {
            logger.error('nami', `인사이트 실패 (post=${post.id})`, err);
            result = '부분실패';
            break; // 이 글은 스킵, 다음 글로
          }
        }

        const mergedReposts = insights.reposts + insights.quotes;
        const engagementRate =
          insights.views > 0
            ? (insights.likes + insights.replies + mergedReposts) / insights.views
            : 0;

        const postPreview = (post.text ?? '').replace(/\n/g, ' ').slice(0, 30);
        const title = `[D+${milestone}] ${postPreview}${(post.text?.length ?? 0) > 30 ? '…' : ''} — ${today}`;

        const saved = await savePerformanceSnapshot({
          contentPageId,
          title,
          measureDate: today,
          daysElapsed: milestone,
          views: insights.views,
          likes: insights.likes,
          replies: insights.replies,
          reposts: mergedReposts,
          shares: 0,
          engagementRate,
          collectionMethod: 'API자동',
        });

        if (saved) {
          totalNew++;
          logger.debug('nami', `성과 저장: D+${milestone} (post=${post.id})`);
          newSnapshots.push({
            milestone,
            preview: (post.text ?? '').replace(/\n/g, ' ').slice(0, 40),
            views: insights.views,
            likes: insights.likes,
            replies: insights.replies,
            reposts: insights.reposts + insights.quotes,
            permalink: post.permalink ?? '',
          });
        } else {
          result = '부분실패';
        }
      }
    }

    logger.info('nami', `성과 수집 완료 — 신규 스냅샷 ${totalNew}개`);

    // Discord 보고 — 신규 성과가 있을 때만
    if (newSnapshots.length > 0) {
      try {
        const channel = await discordClient.channels.fetch(env.DISCORD_CHANNEL_NAMI).catch(() => null);
        const textChannel = channel?.isTextBased() ? (channel as TextChannel) : null;
        const lines = newSnapshots.map((s) => {
          const previewText = s.preview.length >= 40 ? `${s.preview}…` : s.preview;
          return `📊 **[D+${s.milestone}]** "${previewText}"\n조회 ${s.views.toLocaleString()} · 좋아요 ${s.likes} · 댓글 ${s.replies} · 리포스트 ${s.reposts}${s.permalink ? `\n📎 ${s.permalink}` : ''}`;
        });
        await textChannel?.send(
          `🍊 **성과 정보 받아왔어요!** (마일스톤 ${totalNew}건)\n\n${lines.join('\n\n')}`,
        );
      } catch (discordErr) {
        logger.warn('nami', 'Discord 성과 보고 실패', discordErr);
      }
    }
  } catch (err) {
    result = '실패';
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('nami', '성과 수집 실패', err);
  }

  await updateJobState(jobState.pageId, {
    lastRunAt: startedAt,
    lastResult: result,
    lastFetchedCount: totalNew,
    lastError: errorMsg,
    incrementTotalCount: totalNew,
  });

  return { totalNew, result, skipReason: errorMsg || undefined };
}

/**
 * cron 등록 — 6시간마다 자동 실행
 */
export function registerFetchThreadsInsightsJob(): void {
  registerJob({
    name: '나미:스레드성과수집',
    schedule: CRON.DAILY_14,
    fn: fetchThreadsInsightsOnce,
  });
}
