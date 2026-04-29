// 카카오톡 오픈채팅방 크롤러 — 역직구·쇼피·셀러 관련 오픈채팅 메시지 수집
// kakaocli(~/.local/bin/kakaocli)로 로컬 KakaoTalk DB를 직접 읽는다
// 수집 대상 채팅방은 OPEN_CHATS 목록에서 관리

import { execFileSync } from 'node:child_process';
import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import {
  saveToKnowledgeBase,
  queryExistingSourceUrls,
} from '@/notion/databases/knowledgeDb.js';
import { validateArticles, type ArticleToValidate } from './validateContent.js';

const AGENT = 'zoro:kakao-openchat';
const KAKAOCLI = `${process.env.HOME}/.local/bin/kakaocli`;
const KAKAO_USER_ID = 78259025;

// 수집 대상 오픈채팅방 목록 — chatId는 kakaocli chats --user-id로 확인
const OPEN_CHATS: Array<{ chatId: string; name: string }> = [
  { chatId: '18448772167537701', name: '쇼피 정보 Shopee 정예방' },
  { chatId: '18460639519204160', name: '쇼피 자동화 셀러 모임' },
  { chatId: '18277474418348262', name: '쇼피 왕초보방' },
  { chatId: '18456633333515513', name: '바밤바X박코드 역직구 수출' },
  { chatId: '18319241319923701', name: '쇼피셀러 천사방' },
  { chatId: '18458322695031316', name: '온셀로그 동남아 역직구 쇼피' },
  { chatId: '18428968328245216', name: '큐텐재팬' },
  { chatId: '18450961640142740', name: '셀러픽 역직구(큐텐,쇼피)' },
  { chatId: '18480011034067090', name: '투트랙X데이제로 큐텐jp' },
  { chatId: '18310226027956708', name: 'GBA 해외 온라인 판매(이베이·아마존)' },
  { chatId: '18395583795633476', name: '쇼피파이 정보 공유' },
  { chatId: '18389911611539666', name: '쇼피파이 자사몰 운영' },
  { chatId: '18468085985535440', name: '레아 역직구 부업' },
];

// 최근 N시간 메시지만 수집 (cron 1일 1회 → 25h로 여유 확보)
const SINCE_HOURS = 25;

interface KakaoMessage {
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
  return execFileSync(KAKAOCLI, args, {
    timeout: 60_000,
    encoding: 'utf8',
  });
}

function fetchMessages(chatId: string, sinceHours: number): KakaoMessage[] | null {
  try {
    const raw = runKakaoCli([
      'messages',
      '--user-id', String(KAKAO_USER_ID),
      '--chat-id', chatId,
      '--since', `${sinceHours}h`,
      '--limit', '200',
      '--json',
    ]);
    return JSON.parse(raw) as KakaoMessage[];
  } catch (err) {
    // null 반환 = 에러(타임아웃·DB 잠금 등) / [] 와 구분해 호출부에서 조기 중단 처리
    logger.warn(AGENT, `카카오 메시지 조회 실패 (chatId=${chatId}): ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    return null;
  }
}

// 사진 메시지의 CDN URL 수집 — attachment JSON에서 url 추출
// KakaoTalk CDN URL은 발송 후 약 3일 유효 (expire 필드 기준)
function fetchPhotoUrls(chatId: string, sinceHours: number): string[] {
  try {
    const sinceEpochSec = Math.floor(Date.now() / 1000) - sinceHours * 3600;
    // chatId, sinceEpochSec 모두 숫자 — SQL injection 없음
    const sql = `SELECT attachment FROM NTChatMessage WHERE chatId = ${chatId} AND type = 2 AND sentAt >= ${sinceEpochSec} ORDER BY sentAt DESC LIMIT 10`;
    const raw = runKakaoCli(['query', '--user-id', String(KAKAO_USER_ID), sql]);
    const rows = JSON.parse(raw) as Array<[string]>;
    const urls: string[] = [];
    for (const [attachJson] of rows) {
      try {
        const att = JSON.parse(attachJson) as { url?: string };
        if (att.url) urls.push(att.url);
      } catch {
        // 개별 파싱 실패 무시
      }
    }
    return urls;
  } catch {
    return [];
  }
}

function buildSourceUrl(chatId: string, date: string): string {
  // Notion dedup 키로 사용 — 날짜별로 1건 저장
  return `kakao-openchat://${chatId}/${date}`;
}

function buildContent(
  chatName: string,
  messages: KakaoMessage[],
  photoUrls: string[] = [],
): string {
  // Notion blocks ≤ 100 — summary 헤더 ~8블록 + 이미지 최대 12블록 소비, 나머지 메시지는 최대 50줄
  // 메시지 내 개행을 공백으로 치환해 1메시지 = 1블록 보장
  const lines = messages
    .filter((m) => m.text && m.text.length > 5)
    .slice(0, 50)
    .map((m) => {
      const sender = m.is_from_me ? '나' : (m.sender ?? '익명');
      const time = m.timestamp ? m.timestamp.substring(11, 16) : '';
      const text = (m.text ?? '').replace(/\n+/g, ' ').slice(0, 200);
      return `[${time}] ${sender}: ${text}`;
    });

  let content = `## 오픈채팅 원문 (${chatName})\n\n${lines.join('\n')}`;

  if (photoUrls.length > 0) {
    const imageBlocks = photoUrls.map((url) => `![이미지](${url})`).join('\n');
    content += `\n\n## 공유된 사진 (${photoUrls.length}장)\n\n${imageBlocks}`;
  }

  return content;
}

export interface CollectSummary {
  scraped: number;
  validated: number;
  saved: number;
  failedRooms: number; // kakaocli 오류로 스킵된 방 수
}

export async function collectKakaoOpenChatMessages(): Promise<CollectSummary> {
  const today = todayDateOnly();

  const existingUrls = await queryExistingSourceUrls('오픈채팅방');

  let totalScraped = 0;
  let totalValidated = 0;
  let totalSaved = 0;
  let totalFailed = 0;

  const toValidate: ArticleToValidate[] = [];
  const articleMap = new Map<string, { chatId: string; chatName: string; content: string; imageUrls: string[] }>();

  for (const chat of OPEN_CHATS) {
    const sourceUrl = buildSourceUrl(chat.chatId, today);
    if (existingUrls.has(sourceUrl)) {
      logger.debug(AGENT, `이미 수집됨: ${chat.name}`);
      continue;
    }

    const messages = fetchMessages(chat.chatId, SINCE_HOURS);
    if (messages === null) {
      totalFailed++;
      continue;
    }
    const textMessages = messages.filter((m) => m.text && m.text.length > 5);
    logger.info(AGENT, `${chat.name}: ${textMessages.length}건`);

    if (textMessages.length < 3) continue;

    totalScraped += textMessages.length;
    const photoUrls = fetchPhotoUrls(chat.chatId, SINCE_HOURS);
    if (photoUrls.length > 0) {
      logger.info(AGENT, `${chat.name}: 사진 ${photoUrls.length}장`);
    }
    const content = buildContent(chat.name, messages, photoUrls);
    const preview = textMessages
      .slice(0, 5)
      .map((m) => m.text ?? '')
      .join(' ')
      .slice(0, 600);

    articleMap.set(sourceUrl, { chatId: chat.chatId, chatName: chat.name, content, imageUrls: photoUrls });
    toValidate.push({
      title: chat.name,
      url: sourceUrl,
      content: preview,
      source: 'kakao-openchat',
      language: 'ko',
    });
  }

  if (toValidate.length === 0) {
    logger.info(AGENT, '신규 메시지 없음 (방별 실패는 위 warn 로그 참고)');
    return { scraped: 0, validated: 0, saved: 0, failedRooms: totalFailed };
  }

  const validationResults = await validateArticles(toValidate);
  const passed = validationResults.filter((r) => r.relevant);
  totalValidated = passed.length;

  for (const r of passed) {
    const article = articleMap.get(r.url);
    if (!article) continue;
    const articleTitle = toValidate.find((a) => a.url === r.url)?.title ?? article.chatName;

    await saveToKnowledgeBase({
      title: articleTitle,
      category: '오픈채팅방',
      content: `## 핵심 인사이트\n\n${r.summary}\n\n${article.content}`,
      contentText: r.summary,
      sourceUrl: r.url,
      imageUrls: article.imageUrls.length > 0 ? article.imageUrls : undefined,
      tags: [
        ...r.tags.map((t) => `주제:${t}`),
        `타입:${r.contentType}`,
        `신뢰도:${r.confidenceLevel}`,
        `채팅방:${article.chatName}`,
        '출처:카카오오픈채팅',
        '언어:한국어',
        ...(article.imageUrls.length > 0 ? [`사진:${article.imageUrls.length}장`] : []),
      ],
      collectedAt: today,
      status: 'Inbox',
    });
    existingUrls.add(r.url);
    totalSaved++;
  }

  logger.info(AGENT, `완료 — 메시지 ${totalScraped}, 채팅방 ${passed.length}건 통과, 저장 ${totalSaved}`);
  return { scraped: totalScraped, validated: totalValidated, saved: totalSaved, failedRooms: totalFailed };
}
