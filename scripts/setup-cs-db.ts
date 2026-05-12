// CS 관리 DB에 필요한 속성을 자동 추가
// 한 번만 실행하면 되는 일회성 셋업
// 실행: npx tsx scripts/setup-cs-db.ts

import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

const DB_ID = env.NOTION_CS_DB_ID;
if (!DB_ID) {
  console.error('NOTION_CS_DB_ID 가 .env.local 에 없습니다.');
  process.exit(1);
}

const notion = new Client({ auth: env.NOTION_TOKEN });

// 추가/유지할 속성 — 이미 같은 이름이 있으면 Notion API 가 idempotent 처리
const PROPS = {
  채팅방ID: { rich_text: {} },
  최근업데이트: { date: {} },
  메시지수: { number: { format: 'number' } },
} as const;

async function main(): Promise<void> {
  const detail = await notion.databases.retrieve({ database_id: DB_ID });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (detail as any).properties as Record<string, { type: string }>;
  const have = new Set(Object.keys(existing));

  const toAdd: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(PROPS)) {
    if (have.has(name)) {
      console.log(`이미 존재 — 스킵: ${name}`);
      continue;
    }
    toAdd[name] = def;
  }

  if (Object.keys(toAdd).length === 0) {
    console.log('추가할 속성 없음. 모두 존재.');
    return;
  }

  await notion.databases.update({
    database_id: DB_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: toAdd as any,
  });

  console.log(`완료 — 추가된 속성: ${Object.keys(toAdd).join(', ')}`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
