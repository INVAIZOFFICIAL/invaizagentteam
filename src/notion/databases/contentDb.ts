import { notionClient } from '@/notion/client.js';
import { markdownToBlocks } from '@/notion/pages/pageBuilder.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

export interface ContentDbEntry {
  title: string;
  type: 'qoo10_content' | 'competitor_analysis' | 'performance_report' | 'threads_post';
  content: string;
  status: '초안' | '검토중' | '완료' | '발행됨';
  agentName?: string;
}

// 노션 콘텐츠 DB에 새 페이지 저장 — 나미 전용
export async function saveContentToNotion(entry: ContentDbEntry): Promise<string | undefined> {
  if (!env.NOTION_CONTENT_DB_ID) {
    logger.warn('nami', 'NOTION_CONTENT_DB_ID가 설정되지 않아 노션 저장 건너뜀');
    return undefined;
  }

  try {
    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_CONTENT_DB_ID },
      properties: {
        이름: {
          title: [{ text: { content: entry.title } }],
        },
        타입: {
          select: { name: entry.type },
        },
        상태: {
          select: { name: entry.status },
        },
        담당에이전트: {
          select: { name: entry.agentName ?? 'nami' },
        },
        생성일: {
          date: { start: new Date().toISOString().split('T')[0] },
        },
      },
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
  { id: string; title: string; type: string; status: string; createdAt: string }[]
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

    return response.results.map(page => {
      // Notion API 타입 가드
      if (!('properties' in page)) return null;
      const props = page.properties as Record<string, unknown>;
      type TitleProp = { title: { plain_text: string }[] };
      type SelectProp = { select: { name: string } | null };
      const titleProp = props['이름'] as TitleProp | undefined;
      const typeProp = props['타입'] as SelectProp | undefined;
      const statusProp = props['상태'] as SelectProp | undefined;

      return {
        id: page.id,
        title: titleProp?.title[0]?.plain_text ?? '제목 없음',
        type: typeProp?.select?.name ?? '',
        status: statusProp?.select?.name ?? '',
        createdAt: 'created_time' in page ? String(page.created_time) : '',
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  } catch (error) {
    logger.error('nami', '노션 콘텐츠 조회 실패', error);
    return [];
  }
}
