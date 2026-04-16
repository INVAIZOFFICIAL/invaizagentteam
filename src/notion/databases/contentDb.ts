import { notionClient } from '@/notion/client.js';
import { markdownToBlocks } from '@/notion/pages/pageBuilder.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import type { NotionPageLike, NotionPropertyBag } from '@/types/notion.types.js';

// 노션 콘텐츠 DB 의 `채널` Select 값
export type ContentChannel = 'Threads' | 'Blog';

// 노션 콘텐츠 DB 의 `상태` Select 값
export type ContentStatus =
  | '아이디어'
  | '초안'
  | '검토중'
  | '발행대기'
  | '발행완료'
  | '보관';

/**
 * 코드 내부 분기용 타입 리터럴 — DB 에는 들어가지 않음
 * (경쟁사 분석은 지식 베이스 DB, 성과 리포트는 다른 저장소로 라우팅)
 */
export type ContentInternalType =
  | 'threads_post'
  | 'blog_post'
  | 'competitor_analysis'
  | 'performance_report';

export interface ContentDbEntry {
  title: string;
  channel: ContentChannel;
  content: string; // 본문 (페이지 children 으로 저장됨)
  status: ContentStatus;
  agentName?: string; // 기본 'nami'
  publishDate?: string; // 발행일 (ISO date 또는 datetime)
  publishUrl?: string; // 발행 URL
  hookCopy?: string; // 훅카피 (검토 시 빠른 훑기용)
  targetPersonas?: string[]; // 타겟페르소나 (멀티 셀렉트)
}

// 노션 콘텐츠 DB 에 새 페이지 저장 — 나미 전용
export async function saveContentToNotion(entry: ContentDbEntry): Promise<string | undefined> {
  if (!env.NOTION_CONTENT_DB_ID) {
    logger.warn('nami', 'NOTION_CONTENT_DB_ID가 설정되지 않아 노션 저장 건너뜀');
    return undefined;
  }

  try {
    const properties: NotionPropertyBag = {
      이름: { title: [{ text: { content: entry.title } }] },
      채널: { select: { name: entry.channel } },
      // `상태` 는 Notion Status 타입 (select 아님) — Status 필드는 `status: { name }` 포맷
      상태: { status: { name: entry.status } },
      담당에이전트: { select: { name: entry.agentName ?? 'nami' } },
    };

    if (entry.publishDate) {
      properties['발행일'] = { date: { start: entry.publishDate } };
    }
    if (entry.publishUrl) {
      properties['발행URL'] = { url: entry.publishUrl };
    }
    if (entry.hookCopy) {
      properties['훅카피'] = { rich_text: [{ text: { content: entry.hookCopy } }] };
    }
    if (entry.targetPersonas && entry.targetPersonas.length > 0) {
      properties['타겟페르소나'] = {
        multi_select: entry.targetPersonas.map((name) => ({ name })),
      };
    }

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_CONTENT_DB_ID },
      properties,
      children: markdownToBlocks(entry.content),
    });

    const pageUrl = (page as { url?: string }).url;
    logger.info('nami', `노션 콘텐츠 저장 완료: ${entry.title}`, { url: pageUrl });
    return pageUrl;
  } catch (error) {
    logger.error('nami', '노션 콘텐츠 저장 실패', error);
    return undefined;
  }
}

// 최근 콘텐츠 조회
export async function getRecentContents(limit = 10): Promise<
  { id: string; title: string; channel: string; status: string; createdAt: string }[]
> {
  if (!env.NOTION_CONTENT_DB_ID) {
    return [];
  }

  try {
    const response = await notionClient.databases.query({
      database_id: env.NOTION_CONTENT_DB_ID,
      page_size: limit,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    });

    return response.results
      .map((page) => {
        if (!('properties' in page)) return null;
        const props = page.properties as Record<string, unknown>;
        type TitleProp = { title: { plain_text: string }[] };
        type SelectProp = { select: { name: string } | null };
        const titleProp = props['이름'] as TitleProp | undefined;
        const channelProp = props['채널'] as SelectProp | undefined;
        const statusProp = props['상태'] as SelectProp | undefined;

        return {
          id: page.id,
          title: titleProp?.title[0]?.plain_text ?? '제목 없음',
          channel: channelProp?.select?.name ?? '',
          status: statusProp?.select?.name ?? '',
          createdAt: 'created_time' in page ? String(page.created_time) : '',
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  } catch (error) {
    logger.error('nami', '노션 콘텐츠 조회 실패', error);
    return [];
  }
}

export interface PublishedThreadsContent {
  pageId: string;
  title: string;
  publishDate: string; // ISO date
  publishUrl: string; // Threads permalink
}

/**
 * 발행완료 상태의 Threads 콘텐츠 조회 (성과 수집 cron 용)
 * 조건: 채널=Threads, 상태=발행완료, 발행일≥cutoff, 발행URL 존재
 */
export async function getPublishedThreadsContents(
  daysBack = 30,
): Promise<PublishedThreadsContent[]> {
  if (!env.NOTION_CONTENT_DB_ID) return [];

  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CONTENT_DB_ID,
      filter: {
        and: [
          { property: '채널', select: { equals: 'Threads' } },
          // `상태` 는 Notion Status 타입
          { property: '상태', status: { equals: '발행완료' } },
          { property: '발행일', date: { on_or_after: cutoff } },
          { property: '발행URL', url: { is_not_empty: true } },
        ],
      },
    });

    return res.results
      .map((page) => {
        if (!('properties' in page)) return null;
        const props = (page as NotionPageLike).properties ?? {};
        type TitleProp = { title: { plain_text: string }[] };
        const titleProp = props['이름'] as TitleProp | undefined;
        const publishDate: string | undefined = props['발행일']?.date?.start;
        const publishUrl: string | undefined = props['발행URL']?.url;
        if (!publishDate || !publishUrl) return null;
        return {
          pageId: page.id,
          title: titleProp?.title[0]?.plain_text ?? '',
          publishDate,
          publishUrl,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  } catch (err) {
    logger.error('nami', '발행완료 Threads 콘텐츠 조회 실패', err);
    return [];
  }
}

/**
 * 발행 URL 로 콘텐츠 페이지 ID 조회
 * 댓글 수집 cron 에서 스레드 글 ↔ 콘텐츠 DB 매핑에 사용.
 */
export async function findContentPageByUrl(publishUrl: string): Promise<string | undefined> {
  if (!env.NOTION_CONTENT_DB_ID) return undefined;

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CONTENT_DB_ID,
      filter: {
        property: '발행URL',
        url: { equals: publishUrl },
      },
      page_size: 1,
    });
    return res.results[0]?.id;
  } catch (err) {
    logger.error('nami', `콘텐츠 페이지 URL 조회 실패: ${publishUrl}`, err);
    return undefined;
  }
}
