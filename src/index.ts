import { startDiscordBot } from '@/discord/bot.js';
import { registerAgent } from '@/discord/handlers/messageHandler.js';
import { NamiAgent } from '@/agents/nami/NamiAgent.js';
import { registerNamiReferenceJobs } from '@/cron/jobs/namiReferences.js';
import { registerFetchThreadsCommentsJob } from '@/cron/jobs/fetchThreadsComments.js';
import { registerFetchThreadsInsightsJob } from '@/cron/jobs/fetchThreadsInsights.js';
import { registerWeeklyReportJob } from '@/cron/jobs/weeklyReport.js';
import { logger } from '@/utils/logger.js';
import fs from 'node:fs';
import path from 'node:path';

// 에이전트 임포트 (구현되는 순서대로 주석 해제)
// import { LuffyAgent } from '@/agents/luffy/LuffyAgent.js';
// import { ZoroAgent } from '@/agents/zoro/ZoroAgent.js';
// import { UsoppAgent } from '@/agents/usopp/UsoppAgent.js';
// import { SanjiAgent } from '@/agents/sanji/SanjiAgent.js';
// import { ChopperAgent } from '@/agents/chopper/ChopperAgent.js';

const PID_FILE = path.resolve(process.cwd(), 'logs', 'luffy-squad.pid');

function acquireLock(): void {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  // O_EXCL: atomic create — 파일이 이미 존재하면 throw (경쟁 조건 방지)
  let fd: number;
  try {
    fd = fs.openSync(PID_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
  } catch {
    // 파일이 이미 존재 — 살아있는 프로세스인지 확인
    try {
      const existing = fs.readFileSync(PID_FILE, 'utf-8').trim();
      const pid = Number(existing);
      if (pid && !isNaN(pid)) {
        process.kill(pid, 0);
        console.error(`이미 실행 중인 인스턴스가 있습니다 (PID: ${pid}). 종료합니다.`);
        process.exit(1);
      }
    } catch {
      // stale lock (프로세스 없음) — 삭제 후 재시도
    }
    fs.unlinkSync(PID_FILE);
    fd = fs.openSync(PID_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
  }
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
}

function releaseLock(): void {
  try { fs.unlinkSync(PID_FILE); } catch { /* 무시 */ }
}

async function main(): Promise<void> {
  acquireLock();
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

  logger.info('system', '루피 사단 시작 중...');

  // 에이전트 등록
  registerAgent(new NamiAgent());

  // cron 작업 등록 (production 환경에서만 실제 실행됨)
  registerNamiReferenceJobs();
  registerFetchThreadsCommentsJob();
  registerFetchThreadsInsightsJob();
  registerWeeklyReportJob();

  // Discord 봇 시작
  await startDiscordBot();
  logger.info('system', '루피 사단 준비 완료 🏴‍☠️');
}

main().catch((err) => {
  logger.error('system', '시작 실패', err);
  process.exit(1);
});
