import { notionClient } from '@/notion/client.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import type { NotionPropertyBag } from '@/types/notion.types.js';

export interface PerformanceSnapshot {
  contentPageId: string; // 콘텐츠 DB 페이지 ID (Relation)
  title: string; // 이름 (e.g. "[D+3] 글 앞부분… — 2026-04-16")
  measureDate: string; // ISO date (YYYY-MM-DD)
  daysElapsed: number; // D+N
  views: number;
  likes: number;
  replies: number;
  reposts: number; // 리포스트 + 인용 합산
  shares: number;
  engagementRate: number; // (likes+replies+reposts)/views, 0~1 범위
  collectionMethod: 'API자동' | '수동';
}

/**
 * 성과 DB 에 스냅샷 1개 저장
 */
export async function savePerformanceSnapshot(
  snap: PerformanceSnapshot,
): Promise<string | undefined> {
  if (!env.NOTION_PERFORMANCE_DB_ID) {
    logger.warn('performanceDb', 'NOTION_PERFORMANCE_DB_ID 가 없어 저장 건너뜀');
    return undefined;
  }

  try {
    const properties: NotionPropertyBag = {
      이름: { title: [{ text: { content: snap.title } }] },
      콘텐츠: { relation: [{ id: snap.contentPageId }] },
      측정일: { date: { start: snap.measureDate } },
      발행후경과일: { number: snap.daysElapsed },
      조회수: { number: snap.views },
      좋아요: { number: snap.likes },
      댓글: { number: snap.replies },
      리포스트: { number: snap.reposts },
      공유: { number: snap.shares },
      참여율: { number: snap.engagementRate },
      수집방법: { select: { name: snap.collectionMethod } },
    };

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_PERFORMANCE_DB_ID },
      properties,
    });

    logger.info('performanceDb', `성과 저장: ${snap.title}`, { pageId: page.id });
    return page.id;
  } catch (error) {
    logger.error('performanceDb', '성과 저장 실패', error);
    return undefined;
  }
}

/**
 * 특정 콘텐츠 × 마일스톤 조합의 성과 row 가 이미 있는지 확인 (중복 방지)
 */
export async function milestoneExists(
  contentPageId: string,
  daysElapsed: number,
): Promise<boolean> {
  if (!env.NOTION_PERFORMANCE_DB_ID) return false;

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_PERFORMANCE_DB_ID,
      filter: {
        and: [
          { property: '콘텐츠', relation: { contains: contentPageId } },
          { property: '발행후경과일', number: { equals: daysElapsed } },
        ],
      },
      page_size: 1,
    });
    return res.results.length > 0;
  } catch (err) {
    logger.error('performanceDb', `마일스톤 존재 확인 실패 (D+${daysElapsed})`, err);
    return false;
  }
}

/**
 * 주간 리포트용 — 지정 콘텐츠 ID 목록의 최근 N일 성과 스냅샷 일괄 조회
 */
export async function getRecentPerformanceSnapshots(
  contentPageIds: string[],
  sinceDays: number,
): Promise<Array<{
  contentPageId: string;
  daysElapsed: number;
  views: number;
  likes: number;
  replies: number;
  reposts: number; // 리포스트 + 인용 합산
  engagementRate: number;
}>> {
  if (!env.NOTION_PERFORMANCE_DB_ID || contentPageIds.length === 0) return [];

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_PERFORMANCE_DB_ID,
      filter: {
        and: [
          { property: '측정일', date: { on_or_after: since } },
        ],
      },
      page_size: 100,
    });

    type NumProp = { number: number | null };
    type RelProp = { relation: { id: string }[] };

    const snapshots = res.results
      .map((page) => {
        const p = (page as { properties: Record<string, unknown> }).properties as Record<string, unknown>;
        const contentRel = (p['콘텐츠'] as RelProp | undefined)?.relation ?? [];
        const contentPageId = contentRel[0]?.id ?? '';
        if (!contentPageIds.includes(contentPageId)) return null;
        return {
          contentPageId,
          daysElapsed: (p['발행후경과일'] as NumProp | undefined)?.number ?? 0,
          views: (p['조회수'] as NumProp | undefined)?.number ?? 0,
          likes: (p['좋아요'] as NumProp | undefined)?.number ?? 0,
          replies: (p['댓글'] as NumProp | undefined)?.number ?? 0,
          reposts: (p['리포스트'] as NumProp | undefined)?.number ?? 0,
          engagementRate: (p['참여율'] as NumProp | undefined)?.number ?? 0,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return snapshots;
  } catch (err) {
    logger.error('performanceDb', '주간 성과 조회 실패', err);
    return [];
  }
}
