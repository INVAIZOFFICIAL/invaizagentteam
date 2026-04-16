// 나미 레퍼런스 파이프라인 end-to-end 드라이런 (개발 환경)
//
// 03:00/06:00/07:00 cron 을 기다리지 않고 지금 당장 한 번 돌려서:
//   1. collectReferencesOnce — Playwright 크롤 + Claude 분류 + Notion 저장
//   2. curateMorningReport   — 지식 베이스 쿼리 + TOP 10 + Notion 페이지 생성
//   3. deliverMorningReport  — Discord 봇 접속 → #콘텐츠팀-나미 발송
//
// 실행: ./node_modules/.bin/tsx scripts/dry-run-nami-pipeline.ts

import { startDiscordBot, discordClient } from '../src/discord/bot.js';
import { collectReferencesOnce } from '../src/agents/nami/tasks/collectReferences.js';
import { curateMorningReport } from '../src/agents/nami/tasks/curateMorningReport.js';
import { deliverMorningReport } from '../src/agents/nami/tasks/deliverMorningReport.js';

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('━━━ 나미 레퍼런스 파이프라인 드라이런 ━━━\n');

  // ── 1/3 ───────────────────────────────────────────
  console.log('[1/3] ▶ collectReferencesOnce — Playwright + Claude 분류 + Notion 저장');
  console.log('       (시드 21개, 계정당 5초 대기, 전체 약 2~3분 소요)\n');
  const collect = await collectReferencesOnce();
  console.log(
    `\n   ✔ 완료: 시드 ${collect.attempted}개 방문, 통과 ${collect.collected}건, 저장 ${collect.saved}건`,
  );

  // ── 2/3 ───────────────────────────────────────────
  console.log('\n[2/3] ▶ curateMorningReport — TOP 10 큐레이션 + Notion 페이지');
  const curation = await curateMorningReport();
  console.log(
    `   ✔ 완료: 후보 ${curation.totalCandidates}건 → TOP ${curation.top10.length} 선정`,
  );
  if (curation.notionPageUrl) {
    console.log(`   📄 노션 페이지: ${curation.notionPageUrl}`);
  }
  if (curation.top10.length > 0) {
    console.log('\n   TOP 3 미리보기:');
    curation.top10.slice(0, 3).forEach((r, i) => {
      console.log(
        `   ${i + 1}. ${r.author} · score ${r.score} · ${r.topic} · ${r.hooking}`,
      );
      console.log(`      ${r.summary.slice(0, 100).replace(/\n+/g, ' ')}…`);
    });
  }

  // ── 3/3 ───────────────────────────────────────────
  console.log('\n[3/3] ▶ deliverMorningReport — Discord #콘텐츠팀-나미 발송');
  console.log('       Discord 봇 접속 중...');
  await startDiscordBot();
  // 봇 ready 이벤트 대기 (최대 10초)
  if (!discordClient.isReady()) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 10_000);
      discordClient.once('ready', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  console.log(`       봇 로그인 완료 (${discordClient.user?.tag ?? '?'})`);
  await deliverMorningReport(curation);
  console.log('   ✔ 디스코드 발송 완료');

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n━━━ 드라이런 종료 (총 ${sec}s) ━━━`);

  discordClient.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ 드라이런 실패:', err);
  try {
    discordClient.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
