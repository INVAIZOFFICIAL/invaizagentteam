import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

async function main() {
  const n = new Client({ auth: env.NOTION_TOKEN });
  const res = await n.databases.update({
    database_id: env.NOTION_CS_DB_ID!,
    properties: {
      수집일: { date: {} },
      유형: {
        select: {
          options: [
            { name: 'CS', color: 'blue' },
            { name: '단톡방', color: 'green' },
            { name: '온꿈사', color: 'orange' },
          ],
        },
      },
    },
  });
  const added = Object.keys(res.properties).filter((k) => ['수집일', '유형'].includes(k));
  console.log('속성 추가 완료:', added);
}
main().catch(console.error);
