// 카카오톡 오픈채팅(DayZero CS) 수집 → Notion CS DB 사람별 upsert
// kakaocli query로 KakaoTalk 로컬 DB 직접 조회 — NTUser JOIN으로 실명 취득
//
// 수집 대상:
//   NTOpenLink에서 'DayZero' 이름을 가진 오픈링크의 type=3(오픈프로필 1:1) 채팅방 전체
//   → '[DayZero] 손주완' 및 'DayZero 사전 신청 Q&A' 오픈프로필 1:1 자동 감지
//
// 신규 문의자가 오픈프로필로 톡을 시작하면 새 채팅방이 자동 생성되고,
// 다음 실행 때 자동으로 Notion 행이 추가된다 (chatId 기반 upsert).

import { execFileSync } from 'node:child_process';
import { logger } from '@/utils/logger.js';
import { upsertCsChatRoom, getAllCsChatIds, type CsChatRoom } from '@/notion/databases/csDb.js';

const AGENT = 'cs:kakao';
const KAKAOCLI = `${process.env.HOME}/.local/bin/kakaocli`;
const KAKAO_USER_ID = 78259025;

const MESSAGE_LIMIT = 1000;

interface RawKakaoMessage {
  id: number;
  chat_id: number;
  sender_id: number;
  sender?: string;
  text?: string;
  timestamp: string;
  is_from_me: boolean;
  type?: string;
}

function runKakaoCli(args: string[]): string {
  // MacBook은 Homebrew 없이 ~/.local/lib에서 libsqlcipher를 로드 — Mac Mini는 무해하게 무시됨
  const localLib = `${process.env.HOME}/.local/lib`;
  const dyldPath = process.env.DYLD_LIBRARY_PATH
    ? `${localLib}:${process.env.DYLD_LIBRARY_PATH}`
    : localLib;
  return execFileSync(KAKAOCLI, args, {
    timeout: 60_000,
    encoding: 'utf8',
    env: { ...process.env, DYLD_LIBRARY_PATH: dyldPath },
  });
}

// DayZero 오픈프로필 type=3 1:1 채팅방 전체 → 모두 "CS"
function getDayzeroChatsFromDb(): Array<{ chatId: string; name: string }> {
  try {
    const linkRaw = runKakaoCli([
      'query',
      `SELECT CAST(linkId AS TEXT) FROM NTOpenLink WHERE (linkName LIKE '%DayZero%' OR linkName LIKE '%데이제로%') AND linkId > 0`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const linkRows = JSON.parse(linkRaw) as [string][];
    if (linkRows.length === 0) {
      logger.warn(AGENT, 'DayZero 오픈링크를 DB에서 찾지 못함');
      return [];
    }
    const linkIds = linkRows.map((r) => r[0]).join(',');

    const chatRaw = runKakaoCli([
      'query',
      `SELECT CAST(r.chatId AS TEXT),
              COALESCE(NULLIF(r.chatName, ''), u.nickName, u.displayName, '(unknown)') AS resolvedName
       FROM NTChatRoom r
       LEFT JOIN NTUser u ON u.directChatId = r.chatId
       WHERE r.type = 3 AND r.linkId IN (${linkIds})`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const chatRows = JSON.parse(chatRaw) as [string, string][];
    return chatRows.map(([chatId, name]) => ({ chatId, name: name || '(unknown)' }));
  } catch (err) {
    logger.error(AGENT, `DB 직접 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return [];
  }
}

// 단톡방 3개: chatName 패턴으로 탐지 (맥미니 전용 채팅방)
// [투트랙X데이제로] 큐텐jp 자동업로드 프로그램 / 온꿈사 x DayZero 피드백 / 큐텐강사 임재형강사님
function getGroupChatsFromDb(): Array<{ chatId: string; name: string; chatType: string }> {
  try {
    const chatRaw = runKakaoCli([
      'query',
      `SELECT CAST(r.chatId AS TEXT), r.chatName FROM NTChatRoom r
       WHERE (r.chatName LIKE '%투트랙%' OR r.chatName LIKE '%온꿈사%' OR r.chatName LIKE '%임재형%' OR r.chatName LIKE '%큐텐강사%')
       AND r.chatId > 0`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const rows = JSON.parse(chatRaw) as [string, string][];
    return rows.map(([chatId, name]) => ({ chatId, name: name || '(unknown)', chatType: '단톡방' }));
  } catch (err) {
    logger.error(AGENT, `단톡방 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return [];
  }
}

function fetchMessages(chatId: string): RawKakaoMessage[] {
  try {
    // --since 없이 전체 기간 조회, --limit으로 최근 N건만 수집 (kakaocli는 최신→오래된 순 반환)
    const raw = runKakaoCli([
      'messages',
      '--user-id', String(KAKAO_USER_ID),
      '--chat-id', chatId,
      '--limit', String(MESSAGE_LIMIT),
      '--json',
    ]);
    return JSON.parse(raw) as RawKakaoMessage[];
  } catch (err) {
    logger.warn(AGENT, `메시지 조회 실패 chatId=${chatId}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    return [];
  }
}

export interface CollectSummary {
  detectedChats: number;
  upsertedRooms: number;
  createdRooms: number;
  totalMessages: number;
  failedRooms: number;
}

export async function collectKakaoCsConversations(): Promise<CollectSummary> {
  const dayzeroChats = getDayzeroChatsFromDb();
  const groupChats = getGroupChatsFromDb();

  const groupChatIds = new Set(groupChats.map((c) => c.chatId));
  const allDetectedChats: Array<{ chatId: string; name: string; chatType: string }> = [
    ...dayzeroChats
      .filter((c) => !groupChatIds.has(c.chatId)) // 단톡방과 중복 제거
      .map((c) => ({ ...c, chatType: 'CS' })),
    ...groupChats,
  ];

  if (allDetectedChats.length === 0) {
    logger.warn(AGENT, 'DayZero CS 채팅방을 가져오지 못함 (kakaocli 미설치 또는 DB 잠김)');
    return { detectedChats: 0, upsertedRooms: 0, createdRooms: 0, totalMessages: 0, failedRooms: 0 };
  }

  const dbChatIds = new Set(allDetectedChats.map((c) => c.chatId));

  // Notion에 저장된 chatId 중 DB 쿼리에서 누락된 것도 재수집 (엣지케이스: DB 정리 후에도 기록 유지)
  const knownChatIds = await getAllCsChatIds();
  const notionOnly = knownChatIds
    .filter((id) => !dbChatIds.has(id))
    .map((id) => ({ chatId: id, name: '(unknown)', chatType: undefined as string | undefined }));

  const csChats = [...allDetectedChats, ...notionOnly];
  logger.info(AGENT, `CS 채팅방 ${csChats.length}개 (DB감지 ${allDetectedChats.length} + Notion전용 ${notionOnly.length})`);

  let upserted = 0;
  let created = 0;
  let totalMessages = 0;
  let failed = 0;

  for (const chat of csChats) {
    const rawMessages = fetchMessages(chat.chatId);
    const textMessages = rawMessages.filter((m) => m.text && m.text.trim().length > 0);

    if (textMessages.length === 0) {
      logger.debug(AGENT, `메시지 없음 — 스킵: ${chat.name}`);
      continue;
    }

    const room: CsChatRoom = {
      chatId: chat.chatId,
      chatName: chat.name,
      chatType: chat.chatType,
      messages: textMessages.map((m) => ({
        timestamp: m.timestamp,
        sender: m.sender ?? (m.is_from_me ? '나' : '익명'),
        text: m.text ?? '',
        isFromMe: m.is_from_me,
      })),
    };

    try {
      const result = await upsertCsChatRoom(room);
      if (result) {
        upserted++;
        if (result.created) created++;
        totalMessages += result.messageCount;
        logger.info(AGENT, `${result.created ? '신규' : '갱신'}: ${chat.name} (메시지 ${result.messageCount}건)`);
      }
    } catch (err) {
      failed++;
      logger.error(AGENT, `Notion upsert 실패: ${chat.name}`, err);
    }
  }

  logger.info(AGENT, `완료 — 감지 ${csChats.length}, upsert ${upserted}(신규 ${created}), 메시지 ${totalMessages}, 실패 ${failed}`);
  return {
    detectedChats: csChats.length,
    upsertedRooms: upserted,
    createdRooms: created,
    totalMessages,
    failedRooms: failed,
  };
}
