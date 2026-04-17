// 스레드 초안 생성 태스크 (04:00 cron + 수동 트리거)
//
// 역할: 레퍼런스 TOP 10 문체 주입 → Claude 초안 2건 생성 →
//       #콘텐츠팀-나미에 A/B 형태로 보고.
//
// 검수 세션 (draftSessions) 은 이 파일에서 관리.
// submitForApproval.ts 가 여기서 export 한 세션 맵을 직접 수정.

import type { TextChannel } from 'discord.js';
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

function yesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildGenerationPrompt(
  references: { title: string; summary: string; hooking: string }[],
  existingTitles: string[],
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
- A와 B는 서로 다른 후킹 유형으로.

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

function formatDraftMessage(pair: { draftA: Draft; draftB: Draft }): string {
  const quoteA = pair.draftA.content.replace(/\n/g, '\n> ');
  const quoteB = pair.draftB.content.replace(/\n/g, '\n> ');
  return [
    `📝 **오늘 초안 2건**`,
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

export async function generateThreadsPost(): Promise<void> {
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
    const prompt = buildGenerationPrompt(sorted, existing.map((p) => p.title));

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

    const sentMessages: import('discord.js').Message[] = [];
    for (const chunk of splitMessage(formatDraftMessage(pair), 1900)) {
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
