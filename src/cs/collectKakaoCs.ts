// 카카오톡 오픈채팅(DayZero CS) 수집 → Notion CS DB 사람별 upsert
// kakaocli(~/.local/bin/kakaocli)로 로컬 KakaoTalk DB 직접 읽기 — production(맥미니) 전용
//
// 자동 감지 패턴:
//   - 채팅방 이름에 'DayZero' 또는 'dayzero'(대소문자 무관) 포함
//   - 즉 '[DayZero] 손주완' 오픈프로필의 1:1 + 'DayZero 사전 신청 Q&A' 그룹 모두 매칭
//
// 신규 문의자가 [DayZero] 손주완 프로필로 톡을 시작하면 새 채팅방이 자동 생성되고,
// 다음 실행 때 자동으로 Notion 행이 추가된다 (chatId 기반 upsert).

import { execFileSync } from 'node:child_process';
import { logger } from '@/utils/logger.js';
import { upsertCsChatRoom, type CsChatRoom } from '@/notion/databases/csDb.js';

const AGENT = 'cs:kakao';
const KAKAOCLI = `${process.env.HOME}/.local/bin/kakaocli`;
const KAKAO_USER_ID = 78259025; // 조로 코드와 동일 — 맥미니의 KakaoTalk 사용자 ID

// 한 채팅방당 최대 메시지 수 — 너무 오래된 건 잘라냄 (Notion 페이지 한도 + 노션 AI 처리 한도)
const MESSAGE_LIMIT = 1000;
// 메시지 조회 기간 — 90일이면 충분히 누적 (그 이전 대화는 한번 잘리면 복구 불가하지만 CS 맥락상 충분)
const SINCE_DAYS = 90;

// 채팅방 이름에 이 단어가 포함되면 CS 채팅방으로 간주 (대소문자 무관)
const NAME_PATTERNS = [/dayzero/i, /데이제로/i];

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

interface RawChat {
  // kakaocli chats 출력 형식이 환경별로 다를 수 있어 후보 키를 모두 검사
  id?: number | string;
  chatId?: number | string;
  chat_id?: number | string;
  name?: string;
  title?: string;
  chatName?: string;
}

function runKakaoCli(args: string[]): string {
  return execFileSync(KAKAOCLI, args, { timeout: 60_000, encoding: 'utf8' });
}

function listAllChats(): Array<{ chatId: string; name: string }> {
  try {
    const raw = runKakaoCli(['chats', '--user-id', String(KAKAO_USER_ID), '--json']);
    const parsed = JSON.parse(raw) as RawChat[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => {
        const id = c.id ?? c.chatId ?? c.chat_id;
        const name = c.name ?? c.title ?? c.chatName ?? '';
        return { chatId: id != null ? String(id) : '', name: String(name) };
      })
      .filter((c) => c.chatId && c.name);
  } catch (err) {
    logger.error(AGENT, `chats 조회 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return [];
  }
}

function fetchMessages(chatId: string): RawKakaoMessage[] {
  try {
    const raw = runKakaoCli([
      'messages',
      '--user-id', String(KAKAO_USER_ID),
      '--chat-id', chatId,
      '--since', `${SINCE_DAYS * 24}h`,
      '--limit', String(MESSAGE_LIMIT),
      '--json',
    ]);
    return JSON.parse(raw) as RawKakaoMessage[];
  } catch (err) {
    logger.warn(AGENT, `메시지 조회 실패 chatId=${chatId}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    return [];
  }
}

function isCsChat(name: string): boolean {
  return NAME_PATTERNS.some((re) => re.test(name));
}

export interface CollectSummary {
  detectedChats: number;
  upsertedRooms: number;
  createdRooms: number;
  totalMessages: number;
  failedRooms: number;
}

export async function collectKakaoCsConversations(): Promise<CollectSummary> {
  const allChats = listAllChats();
  if (allChats.length === 0) {
    logger.warn(AGENT, '카카오 채팅 목록을 가져오지 못함 (kakaocli 미설치 또는 DB 잠김)');
    return { detectedChats: 0, upsertedRooms: 0, createdRooms: 0, totalMessages: 0, failedRooms: 0 };
  }

  const csChats = allChats.filter((c) => isCsChat(c.name));
  logger.info(AGENT, `전체 ${allChats.length}개 중 CS 채팅방 ${csChats.length}개 감지`);

  let upserted = 0;
  let created = 0;
  let totalMessages = 0;
  let failed = 0;

  for (const chat of csChats) {
    const rawMessages = fetchMessages(chat.chatId);
    // 텍스트 없는 메시지(사진·이모티콘 등) 제외 — CS 맥락상 텍스트만 의미 있음
    const textMessages = rawMessages.filter((m) => m.text && m.text.trim().length > 0);

    if (textMessages.length === 0) {
      logger.debug(AGENT, `메시지 없음 — 스킵: ${chat.name}`);
      continue;
    }

    const room: CsChatRoom = {
      chatId: chat.chatId,
      chatName: chat.name,
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
