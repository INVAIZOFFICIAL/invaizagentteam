import { notionClient } from '@/notion/client.js';
import { markdownToBlocks } from './pageBuilder.js';
import type { AgentName } from '@/types/agent.types.js';
import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';

interface UploadOptions {
  agentName: AgentName;
  databaseId: string;
  title: string;
  content: string;
  properties?: Record<string, unknown>;
}

// 에이전트 작업 결과를 Notion 페이지로 저장
// 제목 형식: [에이전트명] 작업명 — YYYY-MM-DD
export async function uploadReport(options: UploadOptions): Promise<string> {
  const { agentName, databaseId, title, content, properties = {} } = options;
  const today = todayDateOnly();
  const pageTitle = `[${agentName}] ${title} — ${today}`;

  const response = await notionClient.pages.create({
    parent: { database_id: databaseId },
    properties: {
      이름: {
        title: [{ text: { content: pageTitle } }],
      },
      에이전트: {
        select: { name: agentName },
      },
      날짜: {
        date: { start: today },
      },
      ...properties,
    },
    children: markdownToBlocks(content),
  });

  logger.info(agentName, `Notion 저장 완료: ${pageTitle}`, { pageId: response.id });
  return response.id;
}
