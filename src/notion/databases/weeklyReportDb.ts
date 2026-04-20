import { notionClient } from '@/notion/client.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

export interface WeeklyReportEntry {
  title: string;           // "주간 성과 리포트 — 2026-04-21"
  reportDate: string;      // YYYY-MM-DD
  contentPageIds: string[]; // 분석된 콘텐츠 페이지 ID 목록
  analysisMarkdown: string; // Claude 분석 결과 (마크다운)
}

/**
 * Notion 주간 리포트 DB에 리포트 저장
 * DB 속성: 이름(title), 작성일(date), 콘텐츠(relation)
 * 분석 내용은 페이지 본문 블록으로 저장
 */
export async function saveWeeklyReport(entry: WeeklyReportEntry): Promise<string | undefined> {
  if (!env.NOTION_WEEKLY_REPORT_DB_ID) {
    logger.warn('weeklyReportDb', 'NOTION_WEEKLY_REPORT_DB_ID 가 없어 저장 건너뜀');
    return undefined;
  }

  try {
    // 분석 마크다운을 Notion 단락 블록으로 변환 (2000자 제한 분할)
    const chunks: string[] = [];
    const text = entry.analysisMarkdown;
    for (let i = 0; i < text.length; i += 1900) {
      chunks.push(text.slice(i, i + 1900));
    }

    const children = chunks.map((chunk) => ({
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: {
        rich_text: [{ type: 'text' as const, text: { content: chunk } }],
      },
    }));

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_WEEKLY_REPORT_DB_ID },
      properties: {
        이름: { title: [{ text: { content: entry.title } }] },
        작성일: { date: { start: entry.reportDate } },
        콘텐츠: {
          relation: entry.contentPageIds.map((id) => ({ id })),
        },
      },
      children,
    });

    logger.info('weeklyReportDb', `주간 리포트 저장: ${entry.title}`, { pageId: page.id });
    return page.id;
  } catch (error) {
    logger.error('weeklyReportDb', '주간 리포트 저장 실패', error);
    return undefined;
  }
}
