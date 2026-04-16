/**
 * 일회성 수정: ⚙️ 시스템 메타 DB 의 3개 초기 row 의 `실행주기` 필드를
 * 올바른 cron 표현식으로 복원한다 (Notion AI 가 `*` 이후를 잘라서 "0 " / "0 9 " 로 저장함).
 *
 * 실행: ./node_modules/.bin/tsx scripts/fix-meta-schedule.ts
 */

import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

const TOKEN = env.NOTION_TOKEN;
const META_DB_ID = env.NOTION_SYSTEM_META_DB_ID;

if (!TOKEN || !META_DB_ID) {
  console.error('❌ NOTION_TOKEN 또는 NOTION_SYSTEM_META_DB_ID 없음');
  process.exit(1);
}

const notion = new Client({ auth: TOKEN });

const CORRECT_SCHEDULES: Record<string, string> = {
  threads_comments_fetch: '0 */6 * * *',
  threads_insights_fetch: '0 */6 * * *',
  comments_classification: '0 9 * * *',
};

async function main(): Promise<void> {
  const res = await notion.databases.query({ database_id: META_DB_ID! });
  console.log(`📋 시스템 메타 DB row ${res.results.length}개 조회`);

  let fixedCount = 0;
  for (const page of res.results) {
    if (!('properties' in page)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (page as any).properties;
    const title: string =
      props['작업이름']?.title?.[0]?.plain_text ?? '(제목 없음)';
    const correctSchedule = CORRECT_SCHEDULES[title];
    if (!correctSchedule) {
      console.log(`  - ${title}: 매핑 없음 (건너뜀)`);
      continue;
    }

    const currentSchedule =
      props['실행주기']?.rich_text?.[0]?.plain_text ?? '';
    if (currentSchedule === correctSchedule) {
      console.log(`  ✓ ${title}: 이미 정상 (${currentSchedule})`);
      continue;
    }

    await notion.pages.update({
      page_id: page.id,
      properties: {
        실행주기: {
          rich_text: [{ text: { content: correctSchedule } }],
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    console.log(`  🔧 ${title}: "${currentSchedule}" → "${correctSchedule}"`);
    fixedCount++;
  }

  console.log(`\n✅ 수정 완료 (${fixedCount}개 업데이트)`);
}

main().catch((err: unknown) => {
  console.error('❌ 실패:', err);
  process.exit(1);
});
