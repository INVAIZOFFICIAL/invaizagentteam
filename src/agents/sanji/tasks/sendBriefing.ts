import type { TextChannel } from 'discord.js';
import { logger } from '@/utils/logger.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import type { CompetitorIntelligence } from './trackCompetitors.js';

// 일일 브리핑 메시지를 Discord 채널에 전송
export async function sendDailyBriefing(
  channel: TextChannel,
  intelligence: CompetitorIntelligence
): Promise<void> {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  // 상디 말투로 브리핑 메시지 구성
  const lines: string[] = [
    `☕ **오늘의 시장 브리핑** — ${today}`,
    `상디가 정성껏 준비했습니다.`,
    '',
  ];

  // 긴급 알림 (있을 경우)
  if (intelligence.urgentAlerts.length > 0) {
    lines.push('🚨 **즉각 대응 필요**');
    for (const alert of intelligence.urgentAlerts) {
      lines.push(`• ${alert}`);
    }
    lines.push('');
  }

  // 시장 인사이트
  if (intelligence.marketInsights.length > 0) {
    lines.push('📊 **시장 인사이트**');
    for (const insight of intelligence.marketInsights) {
      lines.push(`• ${insight}`);
    }
    lines.push('');
  }

  // 경쟁사 현황 요약
  if (intelligence.competitors.length > 0) {
    lines.push('🔍 **경쟁사 현황**');
    for (const comp of intelligence.competitors) {
      if (comp.priceChanges.length > 0) {
        lines.push(`**${comp.competitorName}**`);
        for (const change of comp.priceChanges.slice(0, 3)) {
          const changeText = change.changePercent
            ? ` (${change.changePercent > 0 ? '+' : ''}${change.changePercent}%)`
            : '';
          lines.push(`  • ${change.product}: ${change.newPrice}${changeText}`);
        }
      }
    }
    lines.push('');
  }

  lines.push(`*분석 시각: ${new Date(intelligence.analyzedAt).toLocaleTimeString('ko-KR')}*`);

  const fullText = lines.join('\n');
  const chunks = splitMessage(fullText);

  for (const chunk of chunks) {
    await channel.send(chunk);
  }

  logger.info('sanji', `일일 브리핑 전송 완료 (${chunks.length}개 메시지)`);
}

// 긴급 알림만 별도 전송
export async function sendUrgentAlert(
  channel: TextChannel,
  alert: string
): Promise<void> {
  await channel.send(`🚨 **[긴급 시장 알림]**\n${alert}\n\n_상디가 즉각 보고드립니다._`);
  logger.info('sanji', `긴급 알림 전송: ${alert.slice(0, 50)}`);
}
