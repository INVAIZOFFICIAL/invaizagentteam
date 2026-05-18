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
  chatType?: string; // "CS" | "단톡방" | "온꿈사"
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

export async function getAllCsChatIds(): Promise<string[]> {
  const map = await getAllCsLastUpdated();
  return [...map.keys()];
}

// chatId → 최근업데이트(ISO) 맵 반환 — 증분 수집에서 since 기준으로 사용
export async function getAllCsLastUpdated(): Promise<Map<string, string>> {
  if (!env.NOTION_CS_DB_ID) return new Map();
  const result = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_CS_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      if (!('properties' in page)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;
      const chatId = props['채팅방ID']?.rich_text?.[0]?.plain_text;
      const lastUpdated = props['최근업데이트']?.date?.start;
      if (chatId) result.set(chatId, lastUpdated ?? '');
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return result;
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
      // 이미 아카이브된 블록은 delete 호출 시 validation_error → 스킵
      if (!('archived' in b) || !(b as { archived?: boolean }).archived) {
        allBlockIds.push(b.id);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // 병렬 삭제 (5개씩 묶어 Notion rate limit 여유 확보)
  for (let i = 0; i < allBlockIds.length; i += 5) {
    const chunk = allBlockIds.slice(i, i + 5);
    await Promise.all(
      chunk.map(async (id) => {
        try {
          await notionClient.blocks.delete({ block_id: id });
        } catch (err) {
          logger.warn('csDb', `블록 삭제 실패 (계속 진행) ${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }
}

function messagesToBlocks(messages: CsChatRoom['messages']): Array<{
  object: 'block';
  type: 'paragraph';
  paragraph: { rich_text: Array<{ type: 'text'; text: { content: string } }> };
}> {
  // kakaocli는 최신→오래된 순(내림차순)으로 반환 — 최근 N개를 역순해 오래된→최신(오름차순)으로 표시
  const recent = messages.slice(0, MAX_MESSAGES_PER_PAGE).reverse();
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
 * - appendOnly=true : 기존 본문 유지, 신규 메시지만 추가 (증분 수집)
 * - appendOnly=false: 본문 전체 교체 (첫 수집 또는 강제 전체 재수집)
 */
export async function upsertCsChatRoom(room: CsChatRoom, appendOnly = false): Promise<UpsertResult | null> {
  if (!env.NOTION_CS_DB_ID) {
    logger.warn('csDb', 'NOTION_CS_DB_ID 미설정 — 스킵');
    return null;
  }
  if (room.messages.length === 0) {
    logger.debug('csDb', `메시지 없음 — 스킵: ${room.chatName}`);
    return null;
  }

  // messages는 kakaocli 내림차순(최신→오래된) — [0]이 가장 최근 메시지
  const lastTs = room.messages[0]?.timestamp ?? new Date().toISOString();
  const now = new Date().toISOString();
  const blocks = messagesToBlocks(room.messages);

  const existing = await findPageByChatId(room.chatId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    이름: { title: [{ text: { content: room.chatName } }] },
    채팅방ID: { rich_text: [{ text: { content: room.chatId } }] },
    최근업데이트: { date: { start: lastTs } },
    수집일: { date: { start: now } },
    메시지수: { number: room.messages.length },
  };
  if (room.chatType) {
    properties['유형'] = { select: { name: room.chatType } };
  }

  if (existing) {
    if (appendOnly) {
      // 증분 모드 — 기존 본문 유지, 신규 메시지만 뒤에 추가
      await notionClient.pages.update({ page_id: existing.id, properties });
      await appendChildrenInChunks(existing.id, blocks);
    } else {
      // 전체 재수집 모드 — 본문 갈아끼우기
      await clearPageChildren(existing.id);
      await notionClient.pages.update({ page_id: existing.id, properties });
      await appendChildrenInChunks(existing.id, blocks);
    }
    return { pageId: existing.id, created: false, messageCount: room.messages.length };
  }

  // 신규 생성 — children 은 100개 제한이라 1차 100개만 같이 넣고 나머지는 append
  const initialChildren = blocks.slice(0, APPEND_CHUNK);
  const remaining = blocks.slice(APPEND_CHUNK);
  const page = await notionClient.pages.create({
    parent: { database_id: env.NOTION_CS_DB_ID },
    properties,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: initialChildren as any,
  });
  if (remaining.length > 0) {
    await appendChildrenInChunks(page.id, remaining);
  }
  return { pageId: page.id, created: true, messageCount: room.messages.length };
}
