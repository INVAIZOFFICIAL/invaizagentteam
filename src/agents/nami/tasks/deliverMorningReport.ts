// 아침 리포트 디스코드 배달 (07:00 cron)
//
// curateMorningReport 의 결과(TOP 10 + 노션 페이지 URL)를 #콘텐츠팀-나미 채널에 발송.

import type { TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import type { CurationResult } from './curateMorningReport.js';

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

  const { date, top10, notionPageUrl, totalCandidates } = result;

  const lines: string[] = [];
  lines.push(`🍊 **오늘의 레퍼런스** — ${date}`);
  lines.push('');

  if (top10.length === 0) {
    lines.push('어제~오늘 수집된 레퍼런스가 없거나 기준 통과분이 없어요.');
    lines.push('오늘은 재료가 부족해. 기다려줘.');
  } else {
    lines.push(
      `어제~오늘 수집 ${totalCandidates}건 중 TOP ${top10.length} 나미가 골랐어 — 숫자가 말해주잖아.`,
    );
    if (notionPageUrl) {
      lines.push(`🔗 전체 리포트: ${notionPageUrl}`);
    }
    lines.push('');
    lines.push('**미리보기 TOP 3**');
    for (let i = 0; i < Math.min(3, top10.length); i++) {
      const r = top10[i];
      const preview = r.summary.length > 120 ? r.summary.slice(0, 120) + '…' : r.summary;
      lines.push('');
      lines.push(
        `**${i + 1}. ${r.author}** · score ${r.score} · ${r.topic || '기타'} · ${r.hooking || '기타'}`,
      );
      lines.push(`> ${preview.replace(/\n+/g, ' ')}`);
      if (r.sourceUrl) lines.push(`${r.sourceUrl}`);
    }
  }

  const msg = lines.join('\n');
  for (const chunk of splitMessage(msg, 1900)) {
    await (channel as TextChannel).send(chunk);
  }
  logger.info('nami', `아침 리포트 배달 완료: ${top10.length}건`);
}
