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
import { upsertCsChatRoom, getAllCsLastUpdated, type CsChatRoom } from '@/notion/databases/csDb.js';

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

// DayZero 관련 모든 채팅방 조회:
// - type=3 (오픈프로필 1:1) → chatType "CS", NTUser.nickName으로 실명 취득
// - type=4/1 (그룹/단체) → chatType "단톡방", NTOpenLink.linkName으로 채팅방명 취득
function getDayzeroChatsFromDb(): Array<{ chatId: string; name: string; chatType: string }> {
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

    // chatId가 Number.MAX_SAFE_INTEGER 초과 → TEXT 캐스팅 필수
    // 1:1(type=3): directChatId JOIN 우선, 없으면 NTChatMessage.authorId → NTUser로 실명 취득
    // 그룹(type!=3): NTOpenLink.linkName 우선
    const chatRaw = runKakaoCli([
      'query',
      `SELECT CAST(r.chatId AS TEXT),
              COALESCE(
                NULLIF(r.chatName, ''),
                u.nickName, u.displayName,
                u2.nickName, u2.displayName,
                CASE WHEN r.type != 3 THEN ol.linkName END,
                '(unknown)'
              ) AS resolvedName,
              r.type
       FROM NTChatRoom r
       LEFT JOIN NTUser u ON u.directChatId = r.chatId
       LEFT JOIN NTOpenLink ol ON ol.linkId = r.linkId
       LEFT JOIN (
         SELECT chatId, MIN(authorId) AS otherAuthorId
         FROM NTChatMessage
         WHERE authorId != ${KAKAO_USER_ID} AND authorId > 0
         GROUP BY chatId
       ) msg ON msg.chatId = r.chatId
       LEFT JOIN NTUser u2 ON u2.userId = msg.otherAuthorId
       WHERE r.linkId IN (${linkIds}) AND r.chatId > 0 AND r.type != 9999`,
      '--user-id', String(KAKAO_USER_ID),
    ]);
    const chatRows = JSON.parse(chatRaw) as [string, string, number][];
    return chatRows.map(([chatId, name, type]) => ({
      chatId,
      name: name || '(unknown)',
      chatType: type === 3 ? 'CS' : '단톡방',
    }));
  } catch (err) {
    logger.error(AGENT, `DB 직접 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return [];
  }
}

// chatName이 비어있어 패턴 탐지가 안 되는 단톡방 수동 등록
// chatId는 서버 할당 — 맥북/맥미니 동일
const FIXED_GROUP_CHATS: Array<{ chatId: string; name: string; chatType: string }> = [
  { chatId: '468603915984425', name: '큐텐강사 임재형강사님', chatType: '단톡방' },
  { chatId: '466739426073413', name: '온꿈사 x DayZero 피드백', chatType: '단톡방' },
];

// 단톡방 3개: chatName 패턴으로 탐지 + 위 수동 등록 목록 병합
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
    const fromDb = rows.map(([chatId, name]) => ({ chatId, name: name || '(unknown)', chatType: '단톡방' }));

    // 수동 등록 채팅방 중 DB에서 이미 탐지된 것 제외하고 추가
    const dbIds = new Set(fromDb.map((c) => c.chatId));
    const fixed = FIXED_GROUP_CHATS.filter((c) => !dbIds.has(c.chatId));
    return [...fromDb, ...fixed];
  } catch (err) {
    logger.error(AGENT, `단톡방 쿼리 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return FIXED_GROUP_CHATS; // DB 실패 시 수동 등록 채팅방만이라도 반환
  }
}

function fetchMessages(chatId: string, since?: string): RawKakaoMessage[] {
  try {
    const args = [
      'messages',
      '--user-id', String(KAKAO_USER_ID),
      '--chat-id', chatId,
      '--limit', String(MESSAGE_LIMIT),
      '--json',
    ];
    // since가 있으면 해당 시각 이후 신규 메시지만 조회 (증분 수집)
    if (since) args.push('--since', since);
    const raw = runKakaoCli(args);
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
  // getDayzeroChatsFromDb()가 type 기반으로 chatType을 이미 설정 — 덮어쓰지 않음
  const allDetectedChats: Array<{ chatId: string; name: string; chatType: string }> = [
    ...dayzeroChats.filter((c) => !groupChatIds.has(c.chatId)), // 단톡방과 중복 제거
    ...groupChats,
  ];

  if (allDetectedChats.length === 0) {
    logger.warn(AGENT, 'DayZero CS 채팅방을 가져오지 못함 (kakaocli 미설치 또는 DB 잠김)');
    return { detectedChats: 0, upsertedRooms: 0, createdRooms: 0, totalMessages: 0, failedRooms: 0 };
  }

  const dbChatIds = new Set(allDetectedChats.map((c) => c.chatId));

  // Notion에 저장된 chatId + 최근업데이트 맵 — 증분 수집 기준 및 Notion전용 방 보충
  const lastUpdatedMap = await getAllCsLastUpdated();
  const notionOnly = [...lastUpdatedMap.keys()]
    .filter((id) => !dbChatIds.has(id))
    .map((id) => ({ chatId: id, name: '(unknown)', chatType: undefined as string | undefined }));

  const csChats = [...allDetectedChats, ...notionOnly];
  logger.info(AGENT, `CS 채팅방 ${csChats.length}개 (DB감지 ${allDetectedChats.length} + Notion전용 ${notionOnly.length})`);

  let upserted = 0;
  let created = 0;
  let totalMessages = 0;
  let failed = 0;

  for (const chat of csChats) {
    // 기존 방은 마지막 수집 이후 신규 메시지만 조회 (증분), 신규 방은 전체 조회
    const lastUpdated = lastUpdatedMap.get(chat.chatId);
    const isIncremental = !!lastUpdated;
    const rawMessages = fetchMessages(chat.chatId, lastUpdated || undefined);
    const textMessages = rawMessages.filter((m) => m.text && m.text.trim().length > 0);

    if (textMessages.length === 0) {
      logger.debug(AGENT, `신규 메시지 없음 — 스킵: ${chat.name}`);
      continue;
    }

    // 이름 미해결 방: sender_id → NTUser 추가 조회
    let resolvedName = chat.name;
    if (resolvedName === '(unknown)') {
      const otherMsg = rawMessages.find((m) => !m.is_from_me && m.sender_id && m.sender_id > 0);
      if (otherMsg?.sender_id) {
        try {
          const userRaw = runKakaoCli([
            'query',
            `SELECT COALESCE(nickName, displayName, '') FROM NTUser WHERE userId = ${otherMsg.sender_id}`,
            '--user-id', String(KAKAO_USER_ID),
          ]);
          const rows = JSON.parse(userRaw) as [string][];
          if (rows[0]?.[0]) resolvedName = rows[0][0];
        } catch { /* 조회 실패 시 (unknown) 유지 */ }
      }
    }

    const room: CsChatRoom = {
      chatId: chat.chatId,
      chatName: resolvedName,
      chatType: chat.chatType,
      messages: textMessages.map((m) => ({
        timestamp: m.timestamp,
        sender: m.sender ?? (m.is_from_me ? '나' : '익명'),
        text: m.text ?? '',
        isFromMe: m.is_from_me,
      })),
    };

    try {
      const result = await upsertCsChatRoom(room, isIncremental);
      if (result) {
        upserted++;
        if (result.created) created++;
        totalMessages += result.messageCount;
        const mode = result.created ? '신규' : (isIncremental ? '증분' : '갱신');
        logger.info(AGENT, `${mode}: ${chat.name} (신규메시지 ${result.messageCount}건)`);
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
