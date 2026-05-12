// CS DB 스키마 일회성 조회
// npx tsx scripts/inspect-cs-db.ts

import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

const DB_ID = '35e9cd20-1d15-8047-90e0-df20d955089c';

const notion = new Client({ auth: env.NOTION_TOKEN });

async function main() {
  const detail = await notion.databases.retrieve({ database_id: DB_ID });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = detail as any;
  console.log('Title:', d.title?.map((t: { plain_text: string }) => t.plain_text).join(''));
  console.log('---Properties---');
  const props = d.properties as Record<
    string,
    {
      type: string;
      select?: { options: { name: string }[] };
      multi_select?: { options: { name: string }[] };
      status?: { options: { name: string }[] };
    }
  >;
  for (const [name, def] of Object.entries(props)) {
    let line = `  • ${name}: ${def.type}`;
    if (def.type === 'select' && def.select?.options)
      line += `  [${def.select.options.map((o) => o.name).join(' / ')}]`;
    if (def.type === 'multi_select' && def.multi_select?.options)
      line += `  [${def.multi_select.options.map((o) => o.name).join(' / ')}]`;
    if (def.type === 'status' && def.status?.options)
      line += `  [${def.status.options.map((o) => o.name).join(' / ')}]`;
    console.log(line);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
