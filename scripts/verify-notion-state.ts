/**
 * B안 마이그레이션 이후 노션 상태 검증 스크립트
 *
 * 체크 항목:
 *   1. 📊 성과 DB 의 Number 필드 포맷 (number_with_commas 여부)
 *   2. ⚙️ 시스템 메타 DB 의 초기 row 3개 존재 여부
 *   3. 5개 DB 전부 env 변수로 접근 가능한지
 *
 * 뷰(View) 는 Notion API 가 미지원하므로 사용자가 직접 확인해야 함.
 */

import { Client } from '@notionhq/client';
import { env } from '@/config/env.js';

const TOKEN = env.NOTION_TOKEN;
if (!TOKEN) {
  console.error('❌ NOTION_TOKEN 없음');
  process.exit(1);
}

const notion = new Client({ auth: TOKEN });

const EXPECTED_COMMAS_FIELDS = ['조회수', '좋아요', '댓글수', '리포스트', '인용', '공유'];

const EXPECTED_META_JOBS = [
  'threads_comments_fetch',
  'threads_insights_fetch',
  'comments_classification',
];

async function main(): Promise<void> {
  console.log('🔍 노션 상태 검증 시작\n');

  // ─────────────────────────────────────
  // 1. 5개 DB env 접근 확인
  // ─────────────────────────────────────
  console.log('━━━ 1. 5개 DB env 접근 ━━━');
  const dbIds: Record<string, string | undefined> = {
    콘텐츠: env.NOTION_CONTENT_DB_ID,
    성과: env.NOTION_PERFORMANCE_DB_ID,
    댓글: env.NOTION_COMMENT_DB_ID,
    지식베이스: env.NOTION_KNOWLEDGE_DB_ID,
    시스템메타: env.NOTION_SYSTEM_META_DB_ID,
  };
  for (const [name, id] of Object.entries(dbIds)) {
    console.log(`  ${id ? '✓' : '❌'} ${name}: ${id ?? '(없음)'}`);
  }
  console.log('');

  // ─────────────────────────────────────
  // 2. 성과 DB Number 필드 포맷 확인
  // ─────────────────────────────────────
  console.log('━━━ 2. 📊 성과 DB Number 필드 포맷 ━━━');
  if (!env.NOTION_PERFORMANCE_DB_ID) {
    console.log('  ❌ NOTION_PERFORMANCE_DB_ID 없어서 스킵');
  } else {
    const perfDb = await notion.databases.retrieve({
      database_id: env.NOTION_PERFORMANCE_DB_ID,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (perfDb as any).properties;

    let commasCount = 0;
    for (const field of EXPECTED_COMMAS_FIELDS) {
      const p = props[field];
      if (!p) {
        console.log(`  ❌ ${field}: 필드 없음`);
        continue;
      }
      if (p.type !== 'number') {
        console.log(`  ⚠️  ${field}: ${p.type} (Number 아님)`);
        continue;
      }
      const format = p.number?.format ?? 'number';
      const isCommas = format === 'number_with_commas';
      console.log(`  ${isCommas ? '✓' : '⚠️ '} ${field}: ${format}`);
      if (isCommas) commasCount++;
    }
    console.log(
      `  → ${commasCount}/${EXPECTED_COMMAS_FIELDS.length} 필드가 number_with_commas 포맷`,
    );
  }
  console.log('');

  // ─────────────────────────────────────
  // 3. 시스템 메타 DB 초기 row 3개
  // ─────────────────────────────────────
  console.log('━━━ 3. ⚙️ 시스템 메타 DB 초기 row ━━━');
  if (!env.NOTION_SYSTEM_META_DB_ID) {
    console.log('  ❌ NOTION_SYSTEM_META_DB_ID 없어서 스킵');
  } else {
    const rows = await notion.databases.query({
      database_id: env.NOTION_SYSTEM_META_DB_ID,
      page_size: 20,
    });

    console.log(`  총 row 수: ${rows.results.length}`);
    const foundJobs: Set<string> = new Set();
    for (const page of rows.results) {
      if (!('properties' in page)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;
      const titleProp = props['작업이름'] ?? props['Name'] ?? props['이름'];
      const title = titleProp?.title?.[0]?.plain_text ?? '(제목 없음)';
      const desc =
        props['설명']?.rich_text?.[0]?.plain_text?.slice(0, 40) ?? '';
      const schedule = props['실행주기']?.rich_text?.[0]?.plain_text ?? '';
      const active = props['활성화']?.checkbox ?? false;
      const result = props['마지막결과']?.select?.name ?? '';
      console.log(`    • ${title}`);
      console.log(
        `      설명: ${desc} / 주기: ${schedule} / 활성: ${active ? '✓' : '✗'} / 결과: ${result}`,
      );
      foundJobs.add(title);
    }

    console.log('');
    console.log('  예상 초기 row 체크:');
    for (const expected of EXPECTED_META_JOBS) {
      console.log(`    ${foundJobs.has(expected) ? '✓' : '❌'} ${expected}`);
    }
  }
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('검증 완료');
}

main().catch((err: unknown) => {
  console.error('❌ 실패:', err);
  process.exit(1);
});
