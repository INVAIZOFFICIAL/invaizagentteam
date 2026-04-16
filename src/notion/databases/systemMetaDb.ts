import { notionClient } from '@/notion/client.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

export type JobResult = '성공' | '부분실패' | '실패' | '대기중';

export interface JobState {
  pageId: string;
  jobName: string;
  lastRunAt?: Date;
  isActive: boolean;
  totalCount: number;
}

export interface JobStateUpdate {
  lastRunAt?: Date;
  lastResult?: JobResult;
  lastFetchedCount?: number;
  lastError?: string;
  incrementTotalCount?: number;
}

/**
 * 작업 이름으로 시스템 메타 DB row 조회
 */
export async function getJobState(jobName: string): Promise<JobState | undefined> {
  if (!env.NOTION_SYSTEM_META_DB_ID) {
    logger.warn('systemMeta', 'NOTION_SYSTEM_META_DB_ID 가 없어 조회 스킵');
    return undefined;
  }

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_SYSTEM_META_DB_ID,
      filter: {
        property: '작업이름',
        title: { equals: jobName },
      },
      page_size: 1,
    });

    const page = res.results[0];
    if (!page || !('properties' in page)) return undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (page as any).properties;
    const lastRunStr: string | undefined = props['마지막실행시각']?.date?.start;
    const isActive: boolean = props['활성화']?.checkbox ?? false;
    const totalCount: number = props['누적처리개수']?.number ?? 0;

    return {
      pageId: page.id,
      jobName,
      lastRunAt: lastRunStr ? new Date(lastRunStr) : undefined,
      isActive,
      totalCount,
    };
  } catch (err) {
    logger.error('systemMeta', `작업 상태 조회 실패: ${jobName}`, err);
    return undefined;
  }
}

/**
 * 작업 상태 업데이트 — cron 실행 끝날 때 호출
 *
 * incrementTotalCount 지정 시 현재 `누적처리개수` 에 더함 (read-modify-write).
 */
export async function updateJobState(
  pageId: string,
  update: JobStateUpdate,
): Promise<void> {
  try {
    let currentTotal = 0;
    if (
      typeof update.incrementTotalCount === 'number' &&
      update.incrementTotalCount > 0
    ) {
      const page = await notionClient.pages.retrieve({ page_id: pageId });
      currentTotal =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (((page as any).properties?.['누적처리개수']?.number ?? 0) as number);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {};

    if (update.lastRunAt) {
      properties['마지막실행시각'] = {
        date: { start: update.lastRunAt.toISOString() },
      };
    }
    if (update.lastResult) {
      properties['마지막결과'] = { select: { name: update.lastResult } };
    }
    if (typeof update.lastFetchedCount === 'number') {
      properties['마지막가져온개수'] = { number: update.lastFetchedCount };
    }
    if (typeof update.lastError === 'string') {
      properties['마지막에러'] = {
        rich_text: [{ text: { content: update.lastError.slice(0, 2000) } }],
      };
    }
    if (
      typeof update.incrementTotalCount === 'number' &&
      update.incrementTotalCount > 0
    ) {
      properties['누적처리개수'] = {
        number: currentTotal + update.incrementTotalCount,
      };
    }

    if (Object.keys(properties).length > 0) {
      await notionClient.pages.update({ page_id: pageId, properties });
    }
  } catch (err) {
    logger.error('systemMeta', `작업 상태 업데이트 실패: ${pageId}`, err);
  }
}
