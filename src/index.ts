import { startDiscordBot } from '@/discord/bot.js';
import { registerAgent } from '@/discord/handlers/messageHandler.js';
import { NamiAgent } from '@/agents/nami/NamiAgent.js';
import { registerNamiReferenceJobs } from '@/cron/jobs/namiReferences.js';
import { logger } from '@/utils/logger.js';

// 에이전트 임포트 (구현되는 순서대로 주석 해제)
// import { LuffyAgent } from '@/agents/luffy/LuffyAgent.js';
// import { ZoroAgent } from '@/agents/zoro/ZoroAgent.js';
// import { UsoppAgent } from '@/agents/usopp/UsoppAgent.js';
// import { SanjiAgent } from '@/agents/sanji/SanjiAgent.js';
// import { ChopperAgent } from '@/agents/chopper/ChopperAgent.js';

async function main(): Promise<void> {
  logger.info('system', '루피 사단 시작 중...');

  // 에이전트 등록
  registerAgent(new NamiAgent());

  // cron 작업 등록 (production 환경에서만 실제 실행됨)
  registerNamiReferenceJobs();

  // Discord 봇 시작
  await startDiscordBot();
  logger.info('system', '루피 사단 준비 완료 🏴‍☠️');
}

main().catch((err) => {
  logger.error('system', '시작 실패', err);
  process.exit(1);
});
