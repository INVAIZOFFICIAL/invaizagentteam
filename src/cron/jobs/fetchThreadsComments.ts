import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { nowIso } from '@/utils/timestamps.js';
import { fetchMyRecentThreads, fetchReplies } from '@/threads/client.js';
import { findContentPageByUrl } from '@/notion/databases/contentDb.js';
import { saveComment, getExistingCommentIds } from '@/notion/databases/commentDb.js';
import { getJobState, updateJobState, type JobResult } from '@/notion/databases/systemMetaDb.js';

const JOB_NAME = 'threads_comments_fetch';
const FETCH_WINDOW_DAYS = 30;

/**
 * 스레드 댓글 1회 증분 수집
 *
 * 로직:
 *   1. 시스템 메타 DB 에서 마지막 실행 시각 조회 (증분 기준점)
 *   2. 최근 30 일 내 내 스레드 글 전부 조회
 *   3. 각 글의 permalink 로 콘텐츠 DB 매칭 → Relation 연결
 *   4. 각 글의 댓글 조회, 중복/시점 필터 후 댓글 DB 저장
 *   5. 시스템 메타 DB 에 결과 기록
 *
 * cron 과 디스코드 수동 트리거 모두 이 함수를 호출.
 */
export async function fetchThreadsCommentsOnce(): Promise<void> {
  const startedAt = new Date();
  logger.info('nami', '스레드 댓글 수집 시작');

  const jobState = await getJobState(JOB_NAME);
  if (!jobState) {
    logger.error('nami', `시스템 메타 DB 에 "${JOB_NAME}" row 없음 — 수집 중단`);
    return;
  }
  if (!jobState.isActive) {
    logger.info('nami', `"${JOB_NAME}" 비활성화 상태 — 스킵`);
    return;
  }

  // 증분 기준 since: 마지막 실행 시각. 없으면 30 일 전.
  const fetchWindowStart = new Date(Date.now() - FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const since = jobState.lastRunAt ?? fetchWindowStart;
  logger.info('nami', `증분 기준 since=${since.toISOString()}`);

  let totalNew = 0;
  let result: JobResult = '성공';
  let errorMsg = '';

  try {
    // 1. 내 최근 글 목록 (최근 30 일)
    const myPosts = await fetchMyRecentThreads(fetchWindowStart, 100);
    logger.info('nami', `내 최근 글 ${myPosts.length}개 발견`);

    // 2. 중복 방지용 기존 댓글 ID set
    const existingIds = await getExistingCommentIds();
    logger.info('nami', `기존 저장 댓글 ${existingIds.size}개`);

    // 3. 글별 댓글 스캔
    for (const post of myPosts) {
      if (!post.permalink) {
        logger.debug('nami', `permalink 없음 — 스킵 (postId=${post.id})`);
        continue;
      }

      // 콘텐츠 DB 매칭 (발행URL = permalink)
      const contentPageId = await findContentPageByUrl(post.permalink);
      if (!contentPageId) {
        logger.debug(
          'nami',
          `콘텐츠 DB 매칭 없음 — 스킵 (permalink=${post.permalink})`,
        );
        continue;
      }

      // 댓글 조회
      let replies;
      try {
        replies = await fetchReplies(post.id, 100);
      } catch (err) {
        logger.error('nami', `댓글 조회 실패 (post=${post.id})`, err);
        result = '부분실패';
        continue;
      }

      for (const reply of replies) {
        // 중복 방지
        if (existingIds.has(reply.id)) continue;

        // 증분 필터 (since 이후만)
        if (reply.timestamp) {
          const replyTime = new Date(reply.timestamp);
          if (replyTime <= since) continue;
        }

        const savedPageId = await saveComment({
          threadsReplyId: reply.id,
          contentPageId,
          username: reply.username ?? 'unknown',
          text: reply.text ?? '',
          timestamp: reply.timestamp ?? nowIso(),
        });

        if (savedPageId) {
          existingIds.add(reply.id);
          totalNew++;
        } else {
          result = '부분실패';
        }
      }
    }

    logger.info('nami', `스레드 댓글 수집 완료 — 신규 ${totalNew}개`);
  } catch (err) {
    result = '실패';
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('nami', '스레드 댓글 수집 실패', err);
  }

  // 4. 시스템 메타 DB 결과 기록
  await updateJobState(jobState.pageId, {
    lastRunAt: startedAt,
    lastResult: result,
    lastFetchedCount: totalNew,
    lastError: errorMsg,
    incrementTotalCount: totalNew,
  });
}

/**
 * cron 등록 — 6 시간마다 자동 실행
 * (scheduler.registerJob 내부에서 NODE_ENV=production 체크)
 */
export function registerFetchThreadsCommentsJob(): void {
  registerJob({
    name: '나미:스레드댓글수집',
    schedule: CRON.EVERY_6H,
    fn: fetchThreadsCommentsOnce,
  });
}
