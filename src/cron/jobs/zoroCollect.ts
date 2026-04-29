// 조로 역직구 셀러 정보 수집 cron
//
// 03:30 — Colosseum 마켓-트렌드 블로그 (한국어, 매일)
// 04:00 — ECのミカタ 크로스보더 뉴스 (일본어, 매일) ← namiContentGenerate와 동일 시간이므로 03:45로
// 04:30 — Seller Kingdom 셀러 전략 블로그 (영어, 월/수/금)
// 일요일 03:30 — Qoo10大学 성공사례 (일본어, 주 1회)
//
// 파이프라인: 스크랩 → Claude 관련성 검증 + 한국어 요약 → 노션 Inbox 저장

import type { TextChannel } from 'discord.js';
import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { collectColosseumArticles } from '@/agents/zoro/tasks/crawlColosseum.js';
import { collectEcnomikataArticles } from '@/agents/zoro/tasks/crawlEcnomikata.js';
import { collectSellerKingdomArticles } from '@/agents/zoro/tasks/crawlSellerKingdom.js';
import { collectQoo10UniversityStories } from '@/agents/zoro/tasks/crawlQoo10University.js';
import { closeBrowser } from '@/utils/browserPool.js';
import { collectKakaoOpenChatMessages } from '@/agents/zoro/tasks/crawlKakaoOpenChat.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';

async function getChannel(): Promise<TextChannel | null> {
  const ch = await discordClient.channels.fetch(env.DISCORD_CHANNEL_NAMI).catch(() => null);
  return ch?.isTextBased() ? (ch as TextChannel) : null;
}

export function registerZoroCollectJobs(): void {
  // Colosseum 마켓-트렌드 — 매일 03:30
  registerJob({
    name: '조로:Colosseum-수집',
    schedule: CRON.DAILY_03_30,
    fn: async () => {
      const s = await collectColosseumArticles();
      logger.info('cron', `조로 Colosseum — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
      const ch = await getChannel();
      ch?.send(`🍊 **Colosseum 수집 완료했어요.** 신규 ${s.scraped}건 → 저장 ${s.saved}건`);
    },
  });

  // ECのミカタ 크로스보더 뉴스 — 매일 03:45
  registerJob({
    name: '조로:ECのミカタ-수집',
    schedule: CRON.DAILY_03_45,
    fn: async () => {
      const s = await collectEcnomikataArticles();
      logger.info('cron', `조로 ECのミカタ — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
      const ch = await getChannel();
      ch?.send(`🍊 **ECのミカタ 수집 완료했어요.** 신규 ${s.scraped}건 → 저장 ${s.saved}건`);
    },
  });

  // Seller Kingdom 셀러 전략 — 월·수·금 04:30
  registerJob({
    name: '조로:SellerKingdom-수집',
    schedule: CRON.MON_WED_FRI_04_30,
    fn: async () => {
      const s = await collectSellerKingdomArticles();
      logger.info('cron', `조로 SellerKingdom — 신규 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
      const ch = await getChannel();
      ch?.send(`🍊 **Seller Kingdom 수집 완료했어요.** 신규 ${s.scraped}건 → 저장 ${s.saved}건`);
    },
  });

  // Qoo10大学 성공사례 — 매주 일요일 03:30 (Puppeteer 사용)
  registerJob({
    name: '조로:Qoo10大学-수집',
    schedule: CRON.WEEKLY_SUN_03_30,
    fn: async () => {
      try {
        const s = await collectQoo10UniversityStories();
        logger.info('cron', `조로 Qoo10大学 — 스크랩 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
        const ch = await getChannel();
        ch?.send(`🍊 **Qoo10大学 수집 완료했어요.** 신규 ${s.scraped}건 → 저장 ${s.saved}건`);
      } finally {
        await closeBrowser();
      }
    },
  });

  // 카카오 오픈채팅 역직구·셀러 방 — 매일 05:00
  registerJob({
    name: '조로:카카오오픈채팅-수집',
    schedule: CRON.DAILY_05,
    fn: async () => {
      const s = await collectKakaoOpenChatMessages();
      logger.info('cron', `조로 카카오오픈채팅 — 메시지 ${s.scraped}, 통과 ${s.validated}, 저장 ${s.saved}`);
      const ch = await getChannel();
      if (s.saved > 0) {
        const failNote = s.failedRooms > 0 ? ` (${s.failedRooms}개 방 접근 불가)` : '';
        ch?.send(`🍊 **카카오 오픈채팅 수집 완료했어요!**${failNote}\n메시지 ${s.scraped}건 → 저장 ${s.saved}건`);
      } else if (s.failedRooms > 0) {
        ch?.send(`🍊 **카카오 오픈채팅 수집 실패했어요.** ${s.failedRooms}개 방에 접근이 안 됐어요. 카카오톡 DB가 잠겨있는 것 같아요.`);
      } else {
        ch?.send(`🍊 **카카오 오픈채팅 수집 완료했어요.** 오늘은 새로 저장할 내용이 없어요.`);
      }
    },
  });

  logger.info('cron', '조로 수집 파이프라인 등록 완료 (03:30·03:45·04:30·05:00·일요일 03:30)');
}
