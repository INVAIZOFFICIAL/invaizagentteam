// 나미 자동 레퍼런스 파이프라인 cron 3종
//
// 03:00 — Threads 시드 계정 크롤 → 지식 베이스 DB 저장
// 06:00 — 어제~오늘 레퍼런스 중 TOP 10 큐레이션 → 노션 페이지 생성
// 07:00 — 큐레이션 결과를 #콘텐츠팀-나미 채널에 배달

import type { TextChannel } from 'discord.js';
import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { collectReferencesOnce } from '@/agents/nami/teams/research/collectReferences.js';
import { curateMorningReport, type CurationResult } from '@/agents/nami/teams/research/curateMorningReport.js';
import { deliverMorningReport } from '@/agents/nami/teams/research/deliverMorningReport.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';

async function getChannel(): Promise<TextChannel | null> {
  const ch = await discordClient.channels.fetch(env.DISCORD_CHANNEL_NAMI).catch(() => null);
  return ch?.isTextBased() ? (ch as TextChannel) : null;
}

// 06:00 큐레이션 결과를 07:00 배달 때 재활용하기 위한 경량 캐시.
// cron 사이에서 process 유지되므로 메모리 공유 가능. 실패 시 07:00 이 자체 재계산.
let lastCuration: CurationResult | null = null;

export function registerNamiReferenceJobs(): void {
  registerJob({
    name: '나미:레퍼런스-수집',
    schedule: CRON.DAILY_03,
    fn: async () => {
      const summary = await collectReferencesOnce();
      logger.info(
        'cron',
        `나미 레퍼런스 수집 — 시드 ${summary.attempted}, 통과 ${summary.collected}, 저장 ${summary.saved}`,
      );
      const ch = await getChannel();
      if (summary.saved > 0) {
        ch?.send(`🍊 **레퍼런스 수집 완료했어요!**\n시드 계정 ${summary.attempted}개 → 통과 ${summary.collected}건 → 노션 저장 ${summary.saved}건`);
      } else {
        ch?.send(`🍊 **레퍼런스 수집 완료했어요.** 오늘은 새로 저장된 레퍼런스가 없어요. (시드 ${summary.attempted}개 방문)`);
      }
    },
  });

  registerJob({
    name: '나미:큐레이션',
    schedule: CRON.DAILY_06,
    fn: async () => {
      lastCuration = await curateMorningReport();
      logger.info(
        'cron',
        `나미 큐레이션 — TOP ${lastCuration.top10.length} (후보 ${lastCuration.totalCandidates})`,
      );
    },
  });

  registerJob({
    name: '나미:리포트-배달',
    schedule: CRON.DAILY_07,
    fn: async () => {
      const result = lastCuration ?? (await curateMorningReport());
      await deliverMorningReport(result);
    },
  });

  logger.info('cron', '나미 레퍼런스 파이프라인 등록 완료 (03/06/07시)');
}
