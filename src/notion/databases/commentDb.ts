import { notionClient } from '@/notion/client.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import type { NotionPageLike, NotionPropertyBag } from '@/types/notion.types.js';

export interface CommentEntry {
  threadsReplyId: string; // Threads API reply id — 중복 방지 유니크 키
  contentPageId: string; // 콘텐츠 DB 페이지 ID (Relation 대상)
  username: string; // @ 제외한 핸들
  userId?: string; // Threads user id (현재 replies API 는 미제공)
  text: string; // 댓글 본문
  timestamp: string; // ISO datetime
  parentCommentPageId?: string; // 부모 댓글 Notion page ID (대댓글)
  likes?: number; // 댓글이 받은 좋아요
}

function makeCommentTitle(username: string, text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const preview = normalized.slice(0, 30);
  const suffix = normalized.length > 30 ? '…' : '';
  return `@${username} — "${preview}${suffix}"`;
}

/**
 * 댓글 DB 에 새 댓글 저장
 */
export async function saveComment(entry: CommentEntry): Promise<string | undefined> {
  if (!env.NOTION_COMMENT_DB_ID) {
    logger.warn('commentDb', 'NOTION_COMMENT_DB_ID 가 설정되지 않아 저장 건너뜀');
    return undefined;
  }

  try {
    const properties: NotionPropertyBag = {
      이름: {
        title: [{ text: { content: makeCommentTitle(entry.username, entry.text) } }],
      },
      콘텐츠: { relation: [{ id: entry.contentPageId }] },
      댓글ID: { rich_text: [{ text: { content: entry.threadsReplyId } }] },
      작성자: { rich_text: [{ text: { content: `@${entry.username}` } }] },
      본문: { rich_text: [{ text: { content: entry.text } }] },
      작성시각: { date: { start: entry.timestamp } },
      // `답변상태` 는 Notion Status 타입
      답변상태: { status: { name: '미확인' } },
    };

    if (entry.userId) {
      properties['작성자ID'] = { rich_text: [{ text: { content: entry.userId } }] };
    }
    if (entry.parentCommentPageId) {
      properties['부모댓글'] = { relation: [{ id: entry.parentCommentPageId }] };
    }
    if (typeof entry.likes === 'number') {
      properties['댓글좋아요'] = { number: entry.likes };
    }

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_COMMENT_DB_ID },
      properties,
    });

    logger.info('commentDb', `댓글 저장 완료: @${entry.username}`, {
      replyId: entry.threadsReplyId,
      pageId: page.id,
    });
    return page.id;
  } catch (error) {
    logger.error('commentDb', '댓글 저장 실패', error);
    return undefined;
  }
}

/**
 * 이미 저장된 댓글의 Threads reply ID 집합 조회 (중복 방지)
 *
 * v1 은 단순 전체 스캔. row 수가 수천 개 이상으로 늘면
 * 마지막 수집 시각 이후 row 만 스캔하도록 최적화 가능.
 */
export async function getExistingCommentIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!env.NOTION_COMMENT_DB_ID) return ids;

  let cursor: string | undefined;
  try {
    do {
      const res = await notionClient.databases.query({
        database_id: env.NOTION_COMMENT_DB_ID,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of res.results) {
        if (!('properties' in page)) continue;
        const props = (page as NotionPageLike).properties ?? {};
        const replyId: string | undefined = props['댓글ID']?.rich_text?.[0]?.plain_text;
        if (replyId) ids.add(replyId);
      }
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
  } catch (err) {
    logger.error('commentDb', '기존 댓글 ID 스캔 실패', err);
  }

  return ids;
}

/**
 * 주간 리포트용 — 지정 콘텐츠 ID 목록의 최근 N일 댓글 일괄 조회
 */
export async function getRecentCommentsByContent(
  contentPageIds: string[],
  sinceDays: number,
): Promise<Array<{
  contentPageId: string;
  username: string;
  text: string;
  timestamp: string;
}>> {
  if (!env.NOTION_COMMENT_DB_ID || contentPageIds.length === 0) return [];

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_COMMENT_DB_ID,
      filter: {
        property: '작성시각',
        date: { on_or_after: since },
      },
      page_size: 200,
    });

    type TitleProp = { title: { plain_text: string }[] };
    type RichProp = { rich_text: { plain_text: string }[] };
    type DateProp = { date: { start: string } | null };
    type RelProp = { relation: { id: string }[] };

    const comments = res.results
      .map((page) => {
        const p = (page as { properties: Record<string, unknown> }).properties as Record<string, unknown>;
        const contentRel = (p['콘텐츠'] as RelProp | undefined)?.relation ?? [];
        const contentPageId = contentRel[0]?.id ?? '';
        if (!contentPageIds.includes(contentPageId)) return null;

        const usernameArr = (p['작성자'] as RichProp | undefined)?.rich_text ?? [];
        const username = usernameArr.map((t) => t.plain_text).join('');

        const textArr = (p['본문'] as RichProp | undefined)?.rich_text ?? [];
        const text = textArr.map((t) => t.plain_text).join('');

        const timestamp = (p['작성시각'] as DateProp | undefined)?.date?.start ?? '';

        return { contentPageId, username, text, timestamp };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.text.length > 0);

    return comments;
  } catch (err) {
    logger.error('commentDb', '주간 댓글 조회 실패', err);
    return [];
  }
}
