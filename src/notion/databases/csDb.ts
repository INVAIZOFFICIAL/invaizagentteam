// CS 관리 DB CRUD — 채팅방(=사람) 단위 upsert
// 한 채팅방당 한 페이지. 본문에 전체 대화 로그를 담는다.
// 노션 AI 가 분석할 수 있도록 [시각] 발신자: 본문 형식의 plain text 위주.

import { notionClient } from '@/notion/client.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

// Notion paragraph rich_text 한 개의 안전 한도 — 2000자 제한 회피
const MAX_PARA_LEN = 1900;
// children append API 한 번 호출당 블록 수 한도
const APPEND_CHUNK = 100;
// 한 페이지에 보존할 최근 메시지 상한 — 너무 많으면 노션 AI 분석도 어려움
const MAX_MESSAGES_PER_PAGE = 1000;

export interface CsChatRoom {
  chatId: string;
  chatName: string; // 사람 이름 또는 채팅방 이름
  messages: Array<{
    timestamp: string; // ISO datetime
    sender: string; // '나' 또는 상대방 이름
    text: string;
    isFromMe: boolean;
  }>;
}

interface ExistingPage {
  id: string;
  lastUpdated?: string;
}

async function findPageByChatId(chatId: string): Promise<ExistingPage | null> {
  if (!env.NOTION_CS_DB_ID) return null;
  try {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CS_DB_ID,
      filter: {
        property: '채팅방ID',
        rich_text: { equals: chatId },
      },
      page_size: 1,
    });
    const page = res.results[0];
    if (!page || !('properties' in page)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (page as any).properties;
    return {
      id: page.id,
      lastUpdated: props['최근업데이트']?.date?.start,
    };
  } catch (err) {
    logger.error('csDb', `채팅방 조회 실패 chatId=${chatId}`, err);
    return null;
  }
}

async function clearPageChildren(pageId: string): Promise<void> {
  // 기존 children 모두 archive — full replace 전략
  let cursor: string | undefined;
  const allBlockIds: string[] = [];
  do {
    const res = await notionClient.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const b of res.results) {
      allBlockIds.push(b.id);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  for (const id of allBlockIds) {
    try {
      await notionClient.blocks.delete({ block_id: id });
    } catch (err) {
      logger.warn('csDb', `블록 삭제 실패 (계속 진행) ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function messagesToBlocks(messages: CsChatRoom['messages']): Array<{
  object: 'block';
  type: 'paragraph';
  paragraph: { rich_text: Array<{ type: 'text'; text: { content: string } }> };
}> {
  // 최근 N개만 (오래된 메시지가 잘림)
  const recent = messages.slice(-MAX_MESSAGES_PER_PAGE);
  return recent.map((m) => {
    const time = m.timestamp ? m.timestamp.substring(11, 16) : '';
    const date = m.timestamp ? m.timestamp.substring(0, 10) : '';
    const sender = m.isFromMe ? '나' : (m.sender || '상대방');
    const text = (m.text || '').replace(/\n+/g, ' ').slice(0, MAX_PARA_LEN);
    const line = `[${date} ${time}] ${sender}: ${text}`;
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line.slice(0, MAX_PARA_LEN) } }],
      },
    };
  });
}

async function appendChildrenInChunks(
  pageId: string,
  blocks: ReturnType<typeof messagesToBlocks>,
): Promise<void> {
  for (let i = 0; i < blocks.length; i += APPEND_CHUNK) {
    const chunk = blocks.slice(i, i + APPEND_CHUNK);
    await notionClient.blocks.children.append({
      block_id: pageId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: chunk as any,
    });
  }
}

export interface UpsertResult {
  pageId: string;
  created: boolean;
  messageCount: number;
}

/**
 * 한 채팅방(=사람) 단위로 페이지를 upsert.
 * - 채팅방ID 로 기존 페이지 검색
 * - 있으면: 본문 비우고 새로 채움 + 속성 update
 * - 없으면: create + children append
 */
export async function upsertCsChatRoom(room: CsChatRoom): Promise<UpsertResult | null> {
  if (!env.NOTION_CS_DB_ID) {
    logger.warn('csDb', 'NOTION_CS_DB_ID 미설정 — 스킵');
    return null;
  }
  if (room.messages.length === 0) {
    logger.debug('csDb', `메시지 없음 — 스킵: ${room.chatName}`);
    return null;
  }

  const lastTs = room.messages[room.messages.length - 1]?.timestamp ?? new Date().toISOString();
  // Notion date 는 ISO 또는 YYYY-MM-DD 모두 허용 — 시간까지 보존
  const blocks = messagesToBlocks(room.messages);

  const existing = await findPageByChatId(room.chatId);

  const properties = {
    이름: { title: [{ text: { content: room.chatName } }] },
    채팅방ID: { rich_text: [{ text: { content: room.chatId } }] },
    최근업데이트: { date: { start: lastTs } },
    메시지수: { number: room.messages.length },
  };

  if (existing) {
    // 본문 갈아끼우기
    await clearPageChildren(existing.id);
    await notionClient.pages.update({
      page_id: existing.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: properties as any,
    });
    await appendChildrenInChunks(existing.id, blocks);
    return { pageId: existing.id, created: false, messageCount: room.messages.length };
  }

  // 신규 생성 — children 은 100개 제한이라 1차 100개만 같이 넣고 나머지는 append
  const initialChildren = blocks.slice(0, APPEND_CHUNK);
  const remaining = blocks.slice(APPEND_CHUNK);
  const page = await notionClient.pages.create({
    parent: { database_id: env.NOTION_CS_DB_ID },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: initialChildren as any,
  });
  if (remaining.length > 0) {
    await appendChildrenInChunks(page.id, remaining);
  }
  return { pageId: page.id, created: true, messageCount: room.messages.length };
}
