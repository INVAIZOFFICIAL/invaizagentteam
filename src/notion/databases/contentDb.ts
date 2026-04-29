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
  referencePageIds?: string[]; // 토대가 된 레퍼런스 Notion 페이지 ID (참조자료 관계형)
  mediaUrl?: string; // 이미지 또는 영상 URL (Threads 발행 시 첨부)
}

// 노션 콘텐츠 DB 에 새 페이지 저장 — 나미 전용
export async function saveContentToNotion(entry: ContentDbEntry): Promise<string | undefined> {
  if (!env.NOTION_CONTENT_DB_ID) {
    logger.warn('nami', 'NOTION_CONTENT_DB_ID가 설정되지 않아 노션 저장 건너뜀');
    return undefined;
  }

  try {
    const properties: NotionPropertyBag = {
      재목: { title: [{ text: { content: entry.title } }] },
      채널: { select: { name: entry.channel } },
      상태: { status: { name: entry.status } },
    };

    if (entry.content) {
      properties['콘텐츠'] = { rich_text: [{ text: { content: entry.content.slice(0, 2000) } }] };
    }
    if (entry.publishDate) {
      properties['발행일'] = { date: { start: entry.publishDate } };
    }
    if (entry.publishUrl) {
      properties['발행URL'] = { url: entry.publishUrl };
    }
    if (entry.mediaUrl) {
      properties['이미지'] = {
        files: [{ name: '미디어', type: 'external', external: { url: entry.mediaUrl } }],
      };
    }
    if (entry.referencePageIds && entry.referencePageIds.length > 0) {
      properties['참조자료'] = {
        relation: entry.referencePageIds.map((id) => ({ id })),
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
        const titleProp = props['재목'] as TitleProp | undefined;
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
        const titleProp = props['재목'] as TitleProp | undefined;
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

export interface PendingContent {
  pageId: string;
  title: string;
  publishDate: string; // ISO datetime
  content?: string;       // 콘텐츠 속성값 (발행 본문)
  replyContents: string[]; // 댓글 작성 속성값 — '---' 기준 분리
  mediaUrls: string[];    // 이미지/영상 URL 목록 (복수 지원 — 2장 이상이면 캐러셀)
}

/**
 * 발행대기 상태이면서 발행예정일시가 현재 이전인 Threads 콘텐츠 조회
 */
export async function getPendingContents(): Promise<PendingContent[]> {
  if (!env.NOTION_CONTENT_DB_ID) return [];

  try {
    const now = new Date().toISOString();
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CONTENT_DB_ID,
      filter: {
        and: [
          { property: '채널', select: { equals: 'Threads' } },
          { property: '상태', status: { equals: '발행대기' } },
          { property: '발행일', date: { on_or_before: now } },
        ],
      },
      sorts: [{ property: '발행일', direction: 'ascending' }],
    });

    return res.results
      .map((page) => {
        if (!('properties' in page)) return null;
        const props = (page as NotionPageLike).properties ?? {};
        type TitleProp = { title: { plain_text: string }[] };
        const titleProp = props['재목'] as TitleProp | undefined;
        const publishDate: string | undefined = props['발행일']?.date?.start;
        const contentArr = props['콘텐츠']?.rich_text ?? [];
        const content = (contentArr as { plain_text: string }[])
          .map((t) => t.plain_text)
          .join('');
        const replyRaw = (props['댓글 작성']?.rich_text as { plain_text: string }[] ?? [])
          .map((t) => t.plain_text)
          .join('');
        const replyContents = replyRaw
          .split(/\n---\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const imageFiles: { file?: { url: string }; external?: { url: string } }[] =
          props['이미지']?.files ?? [];
        const mediaUrls: string[] = imageFiles
          .map((f) => f.file?.url ?? f.external?.url ?? '')
          .filter(Boolean);
        if (!publishDate) return null;
        return {
          pageId: page.id,
          title: titleProp?.title[0]?.plain_text ?? '',
          publishDate,
          content: content || undefined,
          replyContents,
          mediaUrls,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  } catch (err) {
    logger.error('nami', '발행대기 콘텐츠 조회 실패', err);
    return [];
  }
}

/**
 * Notion 페이지 블록을 순서대로 읽어 plain text 로 반환
 */
export async function getPageContentText(pageId: string): Promise<string> {
  try {
    const res = await notionClient.blocks.children.list({ block_id: pageId });
    const lines: string[] = [];
    for (const block of res.results) {
      if (!('type' in block)) continue;
      const b = block as { type: string; [key: string]: unknown };
      const typed = b[b.type] as { rich_text?: { plain_text: string }[] } | undefined;
      const text = (typed?.rich_text ?? []).map((t) => t.plain_text).join('');
      if (text) lines.push(text);
    }
    return lines.join('\n\n');
  } catch (err) {
    logger.error('nami', `페이지 본문 조회 실패: ${pageId}`, err);
    return '';
  }
}

/**
 * 콘텐츠 속성 본문 업데이트 — 수정안 확정 시 사용
 */
export async function updateContentBody(pageId: string, content: string): Promise<void> {
  try {
    await notionClient.pages.update({
      page_id: pageId,
      properties: {
        콘텐츠: { rich_text: [{ text: { content: content.slice(0, 2000) } }] },
      },
    });
    logger.info('nami', `콘텐츠 본문 업데이트: ${pageId}`);
  } catch (err) {
    logger.error('nami', `콘텐츠 본문 업데이트 실패: ${pageId}`, err);
    throw err;
  }
}

/**
 * 콘텐츠 상태 및 발행일 업데이트 — 초안 → 발행대기 전환 등에 사용
 */
export async function updateContentStatusAndDate(
  pageId: string,
  status: ContentStatus,
  publishDate?: string,
): Promise<void> {
  try {
    const properties: NotionPropertyBag = {
      상태: { status: { name: status } },
    };
    if (publishDate) {
      properties['발행일'] = { date: { start: publishDate } };
    }
    await notionClient.pages.update({ page_id: pageId, properties });
    logger.info('nami', `콘텐츠 상태 업데이트: ${pageId} → ${status}`);
  } catch (err) {
    logger.error('nami', `콘텐츠 상태 업데이트 실패: ${pageId}`, err);
    throw err;
  }
}

/**
 * 콘텐츠 발행 완료 처리 — 상태를 발행완료로, 발행URL 기록, 발행일을 실제 발행 시각으로 갱신
 */
export async function updateContentPublishInfo(pageId: string, publishUrl: string): Promise<void> {
  try {
    await notionClient.pages.update({
      page_id: pageId,
      properties: {
        상태: { status: { name: '발행완료' } },
        발행URL: { url: publishUrl },
        발행일: { date: { start: new Date().toISOString() } },
      },
    });
    logger.info('nami', `발행완료 업데이트: ${pageId}`);
  } catch (err) {
    logger.error('nami', `발행완료 업데이트 실패: ${pageId}`, err);
    throw err;
  }
}

/**
 * 가장 최근에 Threads에 발행된 시각 조회 (3시간 간격 체크용)
 */
export async function getLastPublishedAt(): Promise<Date | null> {
  if (!env.NOTION_CONTENT_DB_ID) return null;

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CONTENT_DB_ID,
      filter: {
        and: [
          { property: '채널', select: { equals: 'Threads' } },
          { property: '상태', status: { equals: '발행완료' } },
          { property: '발행일', date: { is_not_empty: true } },
        ],
      },
      sorts: [{ property: '발행일', direction: 'descending' }],
      page_size: 1,
    });

    const first = res.results[0];
    if (!first || !('properties' in first)) return null;
    const publishDate = (first as NotionPageLike).properties?.['발행일']?.date?.start;
    return publishDate ? new Date(publishDate) : null;
  } catch (err) {
    logger.error('nami', '최근 발행 시각 조회 실패', err);
    return null;
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
