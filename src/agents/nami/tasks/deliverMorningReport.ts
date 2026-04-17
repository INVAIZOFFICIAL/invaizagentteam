// 아침 리포트 디스코드 배달 (07:00 cron)
//
// TOP N 레퍼런스를 나미 인격의 Claude에게 넘겨 DayZero 적용 아이디어 포함한
// 브리핑 생성 → #콘텐츠팀-나미 채널에 발송.

import type { TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '@/agents/nami/nami.personality.js';
import type { CurationResult } from './curateMorningReport.js';

function buildPrompt(result: CurationResult): string {
  const { date, top10, totalCandidates } = result;

  const refList = top10
    .map((r, i) => {
      const content = r.summary ? r.summary.slice(0, 300) : '(내용 없음)';
      return [
        `[${i + 1}] ${r.author} · ${r.topic || '기타'} · 후킹: ${r.hooking || '기타'} · score: ${r.score}`,
        `내용: ${content}`,
        r.sourceUrl ? `링크: ${r.sourceUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return `오늘(${date}) 스레드 레퍼런스 총 ${totalCandidates}건이 수집됐어. 그 중 TOP ${top10.length}야.

---
${refList}
---

[임무]
이 레퍼런스들을 보고 팀에게 아침 브리핑을 해줘.

우리는 DayZero 팀이야. 한국→일본 역직구 자동화 SaaS고, 지금 사전 신청 단계. 목표는 100명 사전 신청.

[규칙]
- 단순 요약이나 나열은 절대 하지 마.
- 전체 수집 현황을 한 줄로 시작해.
- 레퍼런스 중 우리에게 실제로 써먹을 수 있는 것 3~5개만 골라.
- 각 항목마다: 해당 포스트 핵심 1~2줄 + "💡 DayZero 적용:" 으로 구체적 활용 방안 (후킹 구조/메시지 전략/콘텐츠 형식 등을 역직구 SaaS에 어떻게 비틀지).
- 마지막에 오늘 팀이 시도해볼 한 줄 액션 제안.
- 뜬구름 잡는 말 금지. "역직구 불안감 해소형 포스트로 써봐" 같이 실행 가능하게.
- 나미 말투 유지. 전체 1500자 이내.`;
}

export async function deliverMorningReport(result: CurationResult): Promise<void> {
  const channel = await discordClient.channels
    .fetch(env.DISCORD_CHANNEL_NAMI)
    .catch((err) => {
      logger.error('nami', '나미 채널 조회 실패', err);
      return null;
    });

  if (!channel || !channel.isTextBased()) {
    logger.warn('nami', '나미 채널 없음 또는 텍스트 채널 아님 — 배달 스킵');
    return;
  }

  const { date, top10, totalCandidates } = result;

  if (top10.length === 0) {
    await (channel as TextChannel).send(
      `🍊 **오늘의 레퍼런스** — ${date}\n\n어제~오늘 수집된 레퍼런스가 없어. 오늘은 재료가 부족해. 기다려줘.`,
    );
    return;
  }

  let analysis: string;
  try {
    analysis = await runClaude(buildPrompt(result), 'nami', {
      systemPrompt: NAMI_PERSONALITY.systemPrompt,
      maxTurns: 1,
      timeoutMs: 60_000,
    });
  } catch (err) {
    logger.error('nami', '나미 브리핑 생성 실패', err);
    analysis = `(분석 실패 — Claude 응답 없음. 원본 ${totalCandidates}건 수집됨)`;
  }

  const header = `🍊 **오늘의 레퍼런스 브리핑** — ${date}\n\n`;
  const msg = header + analysis;

  for (const chunk of splitMessage(msg, 1900)) {
    await (channel as TextChannel).send(chunk);
  }
  logger.info('nami', `아침 브리핑 배달 완료: ${top10.length}건 분석`);
}
