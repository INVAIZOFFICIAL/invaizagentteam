/**
 * 노션 워크스페이스에서 특정 페이지 하위 DB 의 스키마를 덤프하는 일회성 검사 스크립트
 *
 * 사용: npx tsx scripts/inspect-notion.ts "루피 해적단"
 *       (검색어 생략 시 "루피" 로 검색)
 */

import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

const TOKEN = env.NOTION_TOKEN;
if (!TOKEN) {
  console.error('❌ NOTION_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

const notion = new Client({ auth: TOKEN });

const searchQuery = process.argv[2] ?? '루피';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPageTitle(page: any): string {
  if (page.properties) {
    for (const key of Object.keys(page.properties)) {
      const prop = page.properties[key];
      if (prop?.type === 'title' && prop.title?.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return prop.title.map((t: any) => t.plain_text).join('');
      }
    }
  }
  if (page.child_page?.title) return page.child_page.title;
  return '(제목 없음)';
}

async function main(): Promise<void> {
  console.log(`🔍 "${searchQuery}" 검색 중...\n`);

  const search = await notion.search({
    query: searchQuery,
    filter: { property: 'object', value: 'page' },
  });

  console.log(`검색 결과 ${search.results.length} 개:`);
  for (const r of search.results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = r as any;
    console.log(`  - ${extractPageTitle(page)}  (${page.id})`);
  }
  console.log('');

  // 가장 관련성 높은 페이지 선택 (제목에 검색어 포함)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetPage = search.results.find((r: any) => {
    const title = extractPageTitle(r);
    return title.includes(searchQuery) || title.includes('해적단') || title.includes('루피');
  });

  if (!targetPage) {
    console.log(`❌ "${searchQuery}" 매치되는 페이지 못 찾음`);
    return;
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log(`🎯 대상 페이지: ${extractPageTitle(targetPage as any)}`);
  console.log(`   ID: ${targetPage.id}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 페이지 하위 블록 조회
  let cursor: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const databases: Array<{ id: string; title: string }> = [];
  do {
    const children = await notion.blocks.children.list({
      block_id: targetPage.id,
      start_cursor: cursor,
    });
    for (const block of children.results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      if (b.type === 'child_database') {
        databases.push({
          id: b.id,
          title: b.child_database?.title ?? '(제목 없음)',
        });
      }
    }
    cursor = children.has_more ? (children.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`📂 페이지 하위 DB ${databases.length} 개:\n`);
  for (const db of databases) {
    console.log(`  📊 ${db.title}`);
  }
  console.log('');

  // 각 DB 의 스키마 출력
  for (const db of databases) {
    console.log(`\n━━━━━━━━━ ${db.title} ━━━━━━━━━`);
    console.log(`ID: ${db.id}`);

    try {
      const detail = await notion.databases.retrieve({ database_id: db.id });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (detail as any).properties;

      for (const [propName, propDefRaw] of Object.entries(props)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = propDefRaw as any;
        let line = `  • ${propName}: ${p.type}`;

        if (p.type === 'select' && p.select?.options) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const opts = p.select.options.map((o: any) => o.name).join(' / ');
          line += `  [${opts}]`;
        } else if (p.type === 'multi_select' && p.multi_select?.options) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const opts = p.multi_select.options.map((o: any) => o.name).join(' / ');
          line += opts ? `  [${opts}]` : `  [빈 옵션]`;
        } else if (p.type === 'status' && p.status?.options) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const opts = p.status.options.map((o: any) => o.name).join(' / ');
          line += `  [Status: ${opts}]`;
        } else if (p.type === 'relation') {
          const targetId = p.relation?.database_id?.slice(0, 8) ?? '?';
          const relType = p.relation?.type ?? '';
          line += `  → ${targetId}... (${relType})`;
          if (relType === 'dual_property' && p.relation?.dual_property?.synced_property_name) {
            line += ` ↔ "${p.relation.dual_property.synced_property_name}"`;
          }
        } else if (p.type === 'rollup') {
          line += `  via "${p.rollup?.relation_property_name}" → "${p.rollup?.rollup_property_name}" (${p.rollup?.function})`;
        } else if (p.type === 'formula') {
          const expr = (p.formula?.expression ?? '').slice(0, 80);
          line += `  = ${expr}${(p.formula?.expression?.length ?? 0) > 80 ? '...' : ''}`;
        } else if (p.type === 'number') {
          line += `  (format: ${p.number?.format ?? 'number'})`;
        }

        console.log(line);
      }
    } catch (err) {
      console.log(`  ❌ 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('검사 완료');
}

main().catch((err: unknown) => {
  console.error('\n❌ 실패:');
  console.error(err);
  process.exit(1);
});
