// 검수 루프 — Discord 메시지 수신 → 수정 / OK → 노션 저장
//
// 호출: NamiAgent.executeTask() 에서 draftSessions 활성 시 진입.
// 세션은 generateThreadsPost.ts 의 draftSessions 에 관리됨.

import type { Message, TextChannel } from 'discord.js';
import { logger } from '@/utils/logger.js';
import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '@/agents/nami/nami.personality.js';
import { saveContentToNotion } from '@/notion/databases/contentDb.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';
import { draftSessions, type Draft } from './generateThreadsPost.js';

const OK_PATTERN = /^(ok|ㅇㅋ|오케이|저장|확정|발행)\b/i;
const SELECT_A = /\b[Aa]\b|초안\s*[Aa]|[Aa]안/;
const SELECT_B = /\b[Bb]\b|초안\s*[Bb]|[Bb]안/;

async function extractPublishDatetime(text: string): Promise<string | null> {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `오늘 날짜: ${today} (KST 기준)

다음 텍스트에서 발행 예정 날짜와 시간을 추출해서 KST 기준 ISO 8601 형식(YYYY-MM-DDTHH:mm:00+09:00)으로만 반환해.
날짜/시간 정보가 없으면 "NONE"만 출력. 다른 텍스트 없음.

텍스트: "${text}"`;

  try {
    const result = await runClaude(prompt, 'nami', { maxTurns: 1, timeoutMs: 20_000 });
    const trimmed = result.trim();
    if (trimmed === 'NONE' || !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

async function generateRevision(
  feedback: string,
  currentContent: string,
): Promise<{ opinion: string; content: string; hookCopy: string } | null> {
  const prompt = `현재 초안:
---
${currentContent}
---

피드백: "${feedback}"

[임무]
피드백을 반영해서 수정안을 만들어. 나미 콘텐츠 전략가로서 피드백이 성과 관점에서 타당한지 의견도 함께 줘.

[규칙]
- AI 말투 금지. 250자 이내.
- 수정된 본문 전체를 줘 (부분 수정 표시 금지).

[출력] JSON만.
{
  "opinion": "나미 의견 1~2줄",
  "content": "수정된 Threads 본문",
  "hookCopy": "한 줄 요약"
}`;

  try {
    const raw = await runClaude(prompt, 'nami', {
      systemPrompt: NAMI_PERSONALITY.systemPrompt,
      maxTurns: 1,
      timeoutMs: 60_000,
    });
    const jsonStr = extractJsonFromText(raw, 'object');
    if (!jsonStr) return null;
    return JSON.parse(jsonStr) as { opinion: string; content: string; hookCopy: string };
  } catch {
    return null;
  }
}

/**
 * 활성 검수 세션이 있는 채널에서 메시지 처리.
 * @returns 처리됐으면 true (상위에서 추가 처리 생략)
 */
export async function handleContentApproval(message: Message): Promise<boolean> {
  const session = draftSessions.get(message.channelId);
  if (!session) return false;

  // 24시간 만료
  if (Date.now() - session.createdAt.getTime() > 24 * 3_600_000) {
    draftSessions.delete(message.channelId);
    return false;
  }

  const text = message.content.trim();
  const channel = message.channel as TextChannel;

  // 초안 선택 (아직 선택 없을 때)
  if (!session.active) {
    if (SELECT_A.test(text)) {
      session.active = 'A';
      session.currentDraft = session.draftA;
      await channel.send('🍊 초안 A로 진행할게요. 수정 요청하거나 `OK 발행일시` 알려주세요.');
      return true;
    }
    if (SELECT_B.test(text)) {
      session.active = 'B';
      session.currentDraft = session.draftB;
      await channel.send('🍊 초안 B로 진행할게요. 수정 요청하거나 `OK 발행일시` 알려주세요.');
      return true;
    }
  }

  // OK 처리
  if (OK_PATTERN.test(text)) {
    const draft: Draft = session.currentDraft ?? session.draftA;
    const publishDatetime = await extractPublishDatetime(text);

    if (!publishDatetime) {
      await channel.send(
        '🍊 발행 예정일시가 없어요. 예) `OK 내일 오전 10시`',
      );
      return true;
    }

    try {
      const notionUrl = await saveContentToNotion({
        title: draft.title,
        channel: 'Threads',
        content: draft.content,
        status: '발행대기',
        agentName: 'nami',
        publishDate: publishDatetime,
        hookCopy: draft.hookCopy,
      });

      draftSessions.delete(message.channelId);

      const urlLine = notionUrl ? `\n📎 ${notionUrl}` : '';
      await channel.send(
        `🍊 노션 저장 완료했어요. 발행 예정: **${publishDatetime}**\n숫자가 말해주잖아요 — 이 각도 잘 될 거예요.${urlLine}`,
      );
    } catch (err) {
      logger.error('nami', '노션 저장 실패', err);
      await channel.send('🍊 노션 저장 실패했어요. 다시 시도해주세요.');
    }
    return true;
  }

  // 수정 요청 / 아이데이션
  const currentContent = session.currentDraft?.content ?? session.draftA.content;

  await channel.send('🍊 수정안 만드는 중이에요...');
  const result = await generateRevision(text, currentContent);

  if (!result) {
    await channel.send('🍊 수정안 생성 실패했어요. 다시 요청해주세요.');
    return true;
  }

  const updatedDraft: Draft = {
    title: session.currentDraft?.title ?? session.draftA.title,
    content: result.content,
    hookCopy: result.hookCopy,
  };
  session.currentDraft = updatedDraft;
  if (session.active === 'B') session.draftB = updatedDraft;
  else session.draftA = updatedDraft;

  const quoted = result.content.replace(/\n/g, '\n> ');
  const msg = [
    `🍊 **나미 의견:** ${result.opinion}`,
    ``,
    `**수정안:**`,
    `> ${quoted}`,
    ``,
    `OK 발행일시 or 추가 수정 알려주세요.`,
  ].join('\n');

  for (const chunk of splitMessage(msg, 1900)) {
    await channel.send(chunk);
  }
  return true;
}
