// 스레드 초안 생성 태스크 (04:00 cron + 수동 트리거)
//
// 역할: 레퍼런스 TOP 10 문체 주입 → Claude 초안 2건 생성 →
//       #콘텐츠팀-나미에 A/B 형태로 보고.
//
// 검수 세션 (draftSessions) 은 이 파일에서 관리.
// submitForApproval.ts 가 여기서 export 한 세션 맵을 직접 수정.

import type { Message, TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '@/agents/nami/nami.personality.js';
import { queryRecentReferences } from '@/notion/databases/knowledgeDb.js';
import { getPublishedThreadsContents } from '@/notion/databases/contentDb.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';

export interface Draft {
  title: string;
  content: string;
  hookCopy: string;
}

export interface DraftSession {
  draftA: Draft;
  draftB: Draft;
  active: 'A' | 'B' | null;
  currentDraft: Draft | null;
  botMessageId: string;
  channelId: string;
  createdAt: Date;
}

// channelId → 활성 검수 세션 (채널당 1개)
export const draftSessions = new Map<string, DraftSession>();

// channelId → 수동 초안 요청 Q&A 세션
export interface DraftRequestSession {
  channelId: string;
  createdAt: Date;
}
export const draftRequestSessions = new Map<string, DraftRequestSession>();

function yesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildGenerationPrompt(
  references: { title: string; summary: string; hooking: string }[],
  existingTitles: string[],
  userContext?: string,
): string {
  const refExamples = references
    .slice(0, 5)
    .map(
      (r, i) =>
        `[예시 ${i + 1}] 후킹 유형: ${r.hooking || '기타'}\n${r.summary.slice(0, 400)}`,
    )
    .join('\n\n---\n\n');

  const existingNote =
    existingTitles.length > 0
      ? `\n\n최근 발행 주제 (중복 각도 피하기):\n${existingTitles.map((t) => `- ${t}`).join('\n')}`
      : '';

  const userContextNote = userContext
    ? `\n\n[담당자 요청사항]\n${userContext}\n위 요청사항을 반드시 반영해.`
    : '';

  return `[레퍼런스 문체 예시]
${refExamples}${existingNote}

---

[임무]
위 레퍼런스의 문체·리듬·후킹 구조를 분석한 뒤, 역직구 셀러를 위한 Threads 포스트 초안 2건을 작성해.

우리는 DayZero 팀이야. 한국→일본 역직구 자동화 SaaS. 지금은 사전 신청 단계.

[작성 규칙]
- AI 말투 완전 금지: "~할 수 있습니다", "~이어야 합니다", "~해보세요" 형식 쓰지 마.
- 레퍼런스처럼 짧고 끊기는 문장. 독자가 멈추게 만들어.
- 역직구 셀러의 실제 고통·상황을 구체적으로 짚어.
- 소프트셀. DayZero 직접 언급 없어도 됨. 가치 제공 우선.
- 각 포스트 250자 이내.
- A와 B는 서로 다른 후킹 유형으로.${userContextNote}

[출력 형식] JSON만 출력. 다른 텍스트 없음.
{
  "draftA": {
    "title": "주제 요약 15자 이내",
    "content": "실제 Threads 본문",
    "hookCopy": "디스코드용 한 줄 요약 (어떤 각도인지)"
  },
  "draftB": {
    "title": "주제 요약 15자 이내",
    "content": "실제 Threads 본문",
    "hookCopy": "디스코드용 한 줄 요약 (어떤 각도인지)"
  }
}`;
}

function formatDraftMessage(
  pair: { draftA: Draft; draftB: Draft },
  refTitles: string[],
): string {
  const quoteA = pair.draftA.content.replace(/\n/g, '\n> ');
  const quoteB = pair.draftB.content.replace(/\n/g, '\n> ');
  const refLine =
    refTitles.length > 0
      ? `\n📚 **토대 레퍼런스:** ${refTitles.slice(0, 3).join(' / ')}`
      : '';
  return [
    `📝 **오늘 초안 2건**${refLine}`,
    ``,
    `**[초안 A]** ${pair.draftA.hookCopy}`,
    `> ${quoteA}`,
    ``,
    `**[초안 B]** ${pair.draftB.hookCopy}`,
    `> ${quoteB}`,
    ``,
    `---`,
    `A 또는 B 골라서 수정 요청하거나, 새 각도 아이디어 줘도 돼.`,
    `확정은 \`OK 내일 오전 10시\` 처럼 발행일시랑 같이.`,
  ].join('\n');
}

export async function generateThreadsPost(userContext?: string): Promise<void> {
  const channel = await discordClient.channels
    .fetch(env.DISCORD_CHANNEL_NAMI)
    .catch((err) => {
      logger.error('nami', '나미 채널 조회 실패', err);
      return null;
    });

  if (!channel || !channel.isTextBased()) {
    logger.warn('nami', '나미 채널 없음 — 초안 생성 스킵');
    return;
  }

  const textChannel = channel as TextChannel;
  await textChannel.send('🍊 초안 작성 중... 레퍼런스 분석하고 있어. 잠깐만.');

  try {
    const refs = await queryRecentReferences(yesterdayString());
    const sorted = [...refs].sort((a, b) => b.score - a.score).slice(0, 10);

    if (sorted.length === 0) {
      await textChannel.send(
        '🍊 레퍼런스가 없어. 오늘 수집된 게 없으니 초안 생성 보류.',
      );
      return;
    }

    const existing = await getPublishedThreadsContents(7).catch(() => []);
    const prompt = buildGenerationPrompt(
      sorted,
      existing.map((p) => p.title),
      userContext,
    );

    const rawResponse = await runClaude(prompt, 'nami', {
      systemPrompt: NAMI_PERSONALITY.systemPrompt,
      maxTurns: 1,
      timeoutMs: 90_000,
    });

    const jsonStr = extractJsonFromText(rawResponse, 'object');
    if (!jsonStr) throw new Error('Claude 응답에서 JSON 추출 실패');

    const pair = JSON.parse(jsonStr) as { draftA: Draft; draftB: Draft };
    if (!pair.draftA?.content || !pair.draftB?.content) {
      throw new Error('초안 형식 오류 — draftA/draftB content 없음');
    }

    const refTitles = sorted.slice(0, 3).map((r) => r.title);
    const sentMessages: import('discord.js').Message[] = [];
    for (const chunk of splitMessage(formatDraftMessage(pair, refTitles), 1900)) {
      const sent = await textChannel.send(chunk);
      sentMessages.push(sent);
    }

    const botMessageId = sentMessages[sentMessages.length - 1].id;
    draftSessions.set(env.DISCORD_CHANNEL_NAMI, {
      draftA: pair.draftA,
      draftB: pair.draftB,
      active: null,
      currentDraft: null,
      botMessageId,
      channelId: env.DISCORD_CHANNEL_NAMI,
      createdAt: new Date(),
    });

    logger.info('nami', `초안 2건 Discord 전송 완료 (refs: ${sorted.length}건)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('nami', '초안 생성 실패', err);
    await textChannel.send(
      `🍊 초안 생성 실패했어. 다시 트리거해줘.\n\`${msg.slice(0, 200)}\``,
    );
  }
}

/**
 * 수동 요청 시 질문 → 답변 받은 뒤 generateThreadsPost(userContext) 호출.
 * @returns 처리됐으면 true
 */
export async function handleDraftRequest(message: Message): Promise<boolean> {
  const channelId = message.channelId;
  const channel = message.channel as TextChannel;

  // 이미 Q&A 세션이 있으면 → 이번 메시지가 답변 → 생성 실행
  const session = draftRequestSessions.get(channelId);
  if (session) {
    // 1시간 만료
    if (Date.now() - session.createdAt.getTime() > 3_600_000) {
      draftRequestSessions.delete(channelId);
    } else {
      draftRequestSessions.delete(channelId);
      await generateThreadsPost(message.content.trim());
      return true;
    }
  }

  // 새 요청 → 질문 전송 후 세션 저장
  draftRequestSessions.set(channelId, { channelId, createdAt: new Date() });
  await channel.send(
    [
      `🍊 잠깐, 퀄리티 올리려면 먼저 체크할 게 있어.`,
      ``,
      `1. **이번에 다루고 싶은 주제나 각도** 있어? (없으면 "없음")`,
      `2. **사용할 이미지나 영상** 있어?`,
      `3. **참고하고 싶은 레퍼런스** URL 있으면 줘도 돼.`,
      ``,
      `다 답하면 바로 만들어줄게.`,
    ].join('\n'),
  );
  return true;
}
