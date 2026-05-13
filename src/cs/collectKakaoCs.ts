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

// DayZero 오픈프로필 1:1 채팅방 전체를 DB에서 조회, NTUser JOIN으로 실명 + linkId 반환
// linkId=458487784 → "[DayZero] 손주완" → chatType "CS"
// linkId=460388081 → "DayZero 사전 신청 Q&A" → chatType "단톡방"
function getDayzeroChatsFromDb(): Array<{ chatId: string; name: string; linkId: string }> {
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

    // chatId가 Number.MAX_SAFE_INTEGER를 초과하므로 TEXT로 캐스팅
    const chatRaw = runKakaoCli([
      'query',
      `SELECT CAST(r.chatId AS TEXT),
              COALESCE(NULLIF(r.chatName, ''), u.nickName, u.displayName, '(unknown)') AS resolvedName,
              CAST(r.linkId AS TEXT)
       FROM NTChatRoom r
       LEFT JOIN NTUser u ON u.directChatId = r.chatId
       WHERE r.type = 3 AND r.linkId IN (${linkIds})`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const chatRows = JSON.parse(chatRaw) as [string, string, string][];
    return chatRows.map(([chatId, name, linkId]) => ({
      chatId,
      name: name || '(unknown)',
      linkId,
    }));
  } catch (err) {
    logger.error(AGENT, `DB 직접 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return [];
  }
}

// chatName 패턴으로 추가 채팅방 탐색 (온꿈사 등 DayZero 오픈프로필 밖의 채팅방)
function getExtraChatsFromDb(
  namePatterns: string[],
  chatType: string,
): Array<{ chatId: string; name: string; chatType: string }> {
  try {
    const likeConditions = namePatterns
      .map((p) => `r.chatName LIKE '${p.replace(/'/g, "''")}'`)
      .join(' OR ');
    const chatRaw = runKakaoCli([
      'query',
      `SELECT CAST(r.chatId AS TEXT), r.chatName FROM NTChatRoom r WHERE (${likeConditions}) AND r.chatId > 0`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const rows = JSON.parse(chatRaw) as [string, string][];
    return rows.map(([chatId, name]) => ({ chatId, name: name || '(unknown)', chatType }));
  } catch (err) {
    logger.error(AGENT, `추가 채팅방 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
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

// DayZero 오픈링크 ID → 유형 매핑 (NTOpenLink에서 동적으로 조회된 linkId 사용)
// "[DayZero] 손주완" 오픈프로필 1:1 → CS, "DayZero 사전 신청 Q&A" → 단톡방
function resolveChatType(linkId: string, linkNameMap: Map<string, string>): string {
  const linkName = linkNameMap.get(linkId) ?? '';
  if (linkName.includes('Q&A') || linkName.includes('단톡') || linkName.includes('사전 신청')) return '단톡방';
  return 'CS';
}

export async function collectKakaoCsConversations(): Promise<CollectSummary> {
  // DayZero 오픈링크 이름 맵 (linkId → linkName) 로드
  let linkNameMap = new Map<string, string>();
  try {
    const linkRaw = runKakaoCli([
      'query',
      `SELECT CAST(linkId AS TEXT), linkName FROM NTOpenLink WHERE (linkName LIKE '%DayZero%' OR linkName LIKE '%데이제로%') AND linkId > 0`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const linkRows = JSON.parse(linkRaw) as [string, string][];
    linkNameMap = new Map(linkRows);
  } catch {
    // 조회 실패해도 진행 — chatType이 기본 'CS'로 설정됨
  }

  const dayzeroChats = getDayzeroChatsFromDb();
  // 온꿈사: 임재형 강사님 채팅방 (맥미니에만 존재하는 chatName 기반 탐지)
  const onkkumsaChats = getExtraChatsFromDb(['%임재형%', '%큐텐강사%'], '온꿈사');

  const allDetectedChats: Array<{ chatId: string; name: string; chatType: string }> = [
    ...dayzeroChats.map((c) => ({ ...c, chatType: resolveChatType(c.linkId, linkNameMap) })),
    ...onkkumsaChats,
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
