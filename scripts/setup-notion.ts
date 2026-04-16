/**
 * 노션 DB 5개를 한 번에 생성하는 셋업 스크립트
 *
 * 스펙은 docs/notion-schema.md 에 정의돼 있음
 *
 * 실행: npm run setup:notion
 *
 * 전제 조건:
 * - .env.local 에 NOTION_TOKEN, NOTION_PARENT_PAGE_ID 설정
 * - Notion Integration 이 Parent page 에 Connections 로 추가돼 있어야 함
 *
 * 수행 작업:
 *   1. 📝 콘텐츠 DB 생성 (기본 필드만)
 *   2. 📊 성과 DB 생성 (콘텐츠 DB 와 양방향 Relation + Rollup + Formula)
 *   3. 💬 댓글 DB 생성 (콘텐츠 DB 와 양방향 Relation)
 *   4. 💬 댓글 DB 에 셀프 Relation (부모댓글) 추가
 *   5. 📚 지식 베이스 DB 생성 (콘텐츠/댓글 DB 와 양방향 Relation)
 *   6. ⚙️ 시스템 메타 DB 생성 + 초기 row 3개
 *   7. .env.local 에 생성된 DB ID 5개 자동 저장
 *
 * 주의: Notion API 는 뷰(View) 생성을 지원하지 않음.
 *       docs/notion-schema.md §6 참고해 노션 UI 에서 수동 추가하거나
 *       §9.1 프롬프트를 Notion AI 에 붙여넣어 생성.
 */

import { Client } from '@notionhq/client';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '@/config/env.js';

const TOKEN = env.NOTION_TOKEN;
const PARENT_PAGE_ID = env.NOTION_PARENT_PAGE_ID;

if (!TOKEN) {
  console.error('❌ NOTION_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}
if (!PARENT_PAGE_ID) {
  console.error('❌ NOTION_PARENT_PAGE_ID 가 .env.local 에 없습니다.');
  process.exit(1);
}

const notion = new Client({ auth: TOKEN });

// ─────────────────────────────────────────────────────────
// 공통 옵션 상수
// ─────────────────────────────────────────────────────────

const AGENT_OPTIONS = [
  { name: 'nami', color: 'orange' as const },
  { name: 'luffy', color: 'red' as const },
  { name: 'zoro', color: 'green' as const },
  { name: 'usopp', color: 'yellow' as const },
  { name: 'sanji', color: 'blue' as const },
  { name: 'chopper', color: 'pink' as const },
];

// ─────────────────────────────────────────────────────────
// 1. 📝 콘텐츠 DB
// ─────────────────────────────────────────────────────────

async function createContentDb(parentId: string) {
  return await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '📝' },
    title: [{ type: 'text', text: { content: '📝 콘텐츠' } }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: {
      이름: { title: {} },
      채널: {
        select: {
          options: [
            { name: 'Threads', color: 'purple' },
            { name: 'Blog', color: 'blue' },
          ],
        },
      },
      상태: {
        select: {
          options: [
            { name: '아이디어', color: 'gray' },
            { name: '초안', color: 'yellow' },
            { name: '검토중', color: 'orange' },
            { name: '발행대기', color: 'blue' },
            { name: '발행완료', color: 'green' },
            { name: '보관', color: 'brown' },
          ],
        },
      },
      담당에이전트: { select: { options: AGENT_OPTIONS } },
      발행예정일: { date: {} },
      발행일: { date: {} },
      발행URL: { url: {} },
      훅카피: { rich_text: {} },
      타겟페르소나: { multi_select: { options: [] } },
      댓글추적종료: { checkbox: {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// ─────────────────────────────────────────────────────────
// 2. 📊 성과 DB (콘텐츠 DB 와 양방향 Relation + Rollup + Formula)
// ─────────────────────────────────────────────────────────

async function createPerformanceDb(parentId: string, contentDbId: string) {
  return await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '📊' },
    title: [{ type: 'text', text: { content: '📊 콘텐츠 성과' } }],
    properties: {
      이름: { title: {} },
      콘텐츠: {
        relation: {
          database_id: contentDbId,
          type: 'dual_property',
          dual_property: { synced_property_name: '성과기록' },
        },
      },
      측정일: { date: {} },
      채널: {
        rollup: {
          relation_property_name: '콘텐츠',
          rollup_property_name: '채널',
          function: 'show_original',
        },
      },
      발행후경과일: { number: { format: 'number' } },
      조회수: { number: { format: 'number_with_commas' } },
      좋아요: { number: { format: 'number_with_commas' } },
      댓글수: { number: { format: 'number_with_commas' } },
      리포스트: { number: { format: 'number_with_commas' } },
      인용: { number: { format: 'number_with_commas' } },
      공유: { number: { format: 'number_with_commas' } },
      참여율: { number: { format: 'percent' } },
      수집방법: {
        select: {
          options: [
            { name: 'API자동', color: 'green' },
            { name: '수동', color: 'gray' },
          ],
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// ─────────────────────────────────────────────────────────
// 3. 💬 댓글 DB (콘텐츠 DB 와 양방향 Relation)
// ─────────────────────────────────────────────────────────

async function createCommentDb(parentId: string, contentDbId: string) {
  return await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '💬' },
    title: [{ type: 'text', text: { content: '💬 스레드 댓글' } }],
    properties: {
      이름: { title: {} },
      콘텐츠: {
        relation: {
          database_id: contentDbId,
          type: 'dual_property',
          dual_property: { synced_property_name: '댓글' },
        },
      },
      댓글ID: { rich_text: {} },
      작성자: { rich_text: {} },
      작성자ID: { rich_text: {} },
      본문: { rich_text: {} },
      작성시각: { date: {} },
      댓글좋아요: { number: { format: 'number_with_commas' } },
      톤: {
        select: {
          options: [
            { name: '긍정', color: 'green' },
            { name: '부정', color: 'red' },
            { name: '질문', color: 'blue' },
            { name: '중립', color: 'gray' },
            { name: '스팸', color: 'brown' },
          ],
        },
      },
      답변필요: { checkbox: {} },
      답변상태: {
        select: {
          options: [
            { name: '미확인', color: 'gray' },
            { name: '확인함', color: 'yellow' },
            { name: '답변완료', color: 'green' },
            { name: '보류', color: 'brown' },
          ],
        },
      },
      답변본문: { rich_text: {} },
      답변시각: { date: {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// 셀프 Relation (부모댓글) 은 DB 생성 후 추가
async function addSelfRelationToCommentDb(commentDbId: string) {
  await notion.databases.update({
    database_id: commentDbId,
    properties: {
      부모댓글: {
        relation: {
          database_id: commentDbId,
          type: 'single_property',
          single_property: {},
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// ─────────────────────────────────────────────────────────
// 4. 📚 지식 베이스 DB
// ─────────────────────────────────────────────────────────

async function createKnowledgeDb(parentId: string, contentDbId: string, commentDbId: string) {
  return await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '📚' },
    title: [{ type: 'text', text: { content: '📚 지식 베이스' } }],
    properties: {
      이름: { title: {} },
      카테고리: {
        select: {
          options: [
            { name: '시장동향', color: 'blue' },
            { name: '경쟁사', color: 'red' },
            { name: 'UT인사이트', color: 'purple' },
            { name: '사용자Quote', color: 'pink' },
            { name: '레퍼런스콘텐츠', color: 'orange' },
            { name: '데이터통계', color: 'yellow' },
            { name: '툴리소스', color: 'green' },
          ],
        },
      },
      수집자: { select: { options: AGENT_OPTIONS } },
      태그: { multi_select: { options: [] } },
      한줄요약: { rich_text: {} },
      원본URL: { url: {} },
      수집일: { date: {} },
      신뢰도: {
        select: {
          options: [
            { name: '1차자료', color: 'green' },
            { name: '2차자료', color: 'yellow' },
            { name: '소문추정', color: 'red' },
          ],
        },
      },
      활용콘텐츠: {
        relation: {
          database_id: contentDbId,
          type: 'dual_property',
          dual_property: { synced_property_name: '참조자료' },
        },
      },
      원천댓글: {
        relation: {
          database_id: commentDbId,
          type: 'dual_property',
          dual_property: { synced_property_name: '지식베이스승급' },
        },
      },
      상태: {
        select: {
          options: [
            { name: 'Raw', color: 'gray' },
            { name: '검증됨', color: 'blue' },
            { name: '활용됨', color: 'green' },
            { name: '보관', color: 'brown' },
          ],
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// ─────────────────────────────────────────────────────────
// 5. ⚙️ 시스템 메타 DB
// ─────────────────────────────────────────────────────────

async function createSystemMetaDb(parentId: string) {
  return await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '⚙️' },
    title: [{ type: 'text', text: { content: '⚙️ 시스템 운영 상태' } }],
    properties: {
      작업이름: { title: {} },
      설명: { rich_text: {} },
      마지막실행시각: { date: {} },
      마지막결과: {
        select: {
          options: [
            { name: '성공', color: 'green' },
            { name: '부분실패', color: 'yellow' },
            { name: '실패', color: 'red' },
            { name: '대기중', color: 'gray' },
          ],
        },
      },
      마지막가져온개수: { number: { format: 'number_with_commas' } },
      누적처리개수: { number: { format: 'number_with_commas' } },
      마지막에러: { rich_text: {} },
      다음실행예정: { date: {} },
      실행주기: { rich_text: {} },
      활성화: { checkbox: {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

async function createInitialMetaRows(metaDbId: string) {
  const rows = [
    {
      작업이름: 'threads_comments_fetch',
      설명: '스레드 댓글 증분 수집 (최근 30일 발행 글 대상)',
      실행주기: '0 */6 * * *',
    },
    {
      작업이름: 'threads_insights_fetch',
      설명: '스레드 성과 지표 마일스톤 수집 (D+0/1/3/7/14/30)',
      실행주기: '0 */6 * * *',
    },
    {
      작업이름: 'comments_classification',
      설명: '댓글 톤/답변필요 배치 분류 (runClaude 경유, 1일 1회)',
      실행주기: '0 9 * * *',
    },
  ];

  for (const row of rows) {
    await notion.pages.create({
      parent: { database_id: metaDbId },
      properties: {
        작업이름: { title: [{ text: { content: row.작업이름 } }] },
        설명: { rich_text: [{ text: { content: row.설명 } }] },
        실행주기: { rich_text: [{ text: { content: row.실행주기 } }] },
        마지막결과: { select: { name: '대기중' } },
        활성화: { checkbox: true },
      },
    });
  }
}

// ─────────────────────────────────────────────────────────
// 기존 DB 정리 (재실행 대비 — 멱등성 확보)
// ─────────────────────────────────────────────────────────

async function cleanupExistingDbs(parentId: string): Promise<void> {
  const targetTitles = new Set([
    '📝 콘텐츠',
    '📊 콘텐츠 성과',
    '💬 스레드 댓글',
    '📚 지식 베이스',
    '⚙️ 시스템 운영 상태',
  ]);

  let cursor: string | undefined;
  let archivedCount = 0;
  do {
    const res: Awaited<ReturnType<typeof notion.blocks.children.list>> =
      await notion.blocks.children.list({
        block_id: parentId,
        start_cursor: cursor,
      });

    for (const block of res.results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      if (b.type === 'child_database') {
        const title: string | undefined = b.child_database?.title;
        if (title && targetTitles.has(title)) {
          await notion.blocks.update({ block_id: b.id, archived: true });
          console.log(`    🗑️  기존 "${title}" 아카이브됨`);
          archivedCount++;
        }
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  if (archivedCount === 0) {
    console.log('    (기존 DB 없음)');
  }
}

// ─────────────────────────────────────────────────────────
// .env.local 업데이트
// ─────────────────────────────────────────────────────────

function updateEnvLocal(updates: Record<string, string>): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  let content = fs.readFileSync(envPath, 'utf-8');

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      if (!content.endsWith('\n')) content += '\n';
      content += `${key}=${value}\n`;
    }
  }

  fs.writeFileSync(envPath, content);
}

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🏴‍☠️  루피 사단 노션 DB 셋업 시작');
  console.log(`   Parent page: ${PARENT_PAGE_ID}`);
  console.log('');

  console.log('🔍 연결 테스트...');
  try {
    await notion.pages.retrieve({ page_id: PARENT_PAGE_ID! });
    console.log('   ✓ Parent page 접근 가능');
    console.log('');
  } catch (err) {
    console.error('❌ Parent page 접근 실패. 확인 사항:');
    console.error('   1. NOTION_TOKEN 이 유효한가?');
    console.error('   2. Integration 이 Parent page 에 Connections 로 추가됐는가?');
    console.error('   3. NOTION_PARENT_PAGE_ID 가 올바른가?');
    throw err;
  }

  console.log('🧹 기존 DB 정리 중 (재실행 대비)...');
  await cleanupExistingDbs(PARENT_PAGE_ID!);
  console.log('');

  console.log('1/6 📝 콘텐츠 DB 생성 중...');
  const contentDb = await createContentDb(PARENT_PAGE_ID!);
  console.log(`    ✓ ${contentDb.id}`);

  console.log('2/6 📊 성과 DB 생성 중...');
  const perfDb = await createPerformanceDb(PARENT_PAGE_ID!, contentDb.id);
  console.log(`    ✓ ${perfDb.id}`);

  console.log('3/6 💬 댓글 DB 생성 중...');
  const commentDb = await createCommentDb(PARENT_PAGE_ID!, contentDb.id);
  console.log(`    ✓ ${commentDb.id}`);

  console.log('    └ 셀프 Relation (부모댓글) 추가 중...');
  await addSelfRelationToCommentDb(commentDb.id);
  console.log('      ✓');

  console.log('4/6 📚 지식 베이스 DB 생성 중...');
  const knowledgeDb = await createKnowledgeDb(PARENT_PAGE_ID!, contentDb.id, commentDb.id);
  console.log(`    ✓ ${knowledgeDb.id}`);

  console.log('5/6 ⚙️  시스템 메타 DB 생성 중...');
  const metaDb = await createSystemMetaDb(PARENT_PAGE_ID!);
  console.log(`    ✓ ${metaDb.id}`);

  console.log('6/6 시스템 메타 DB 초기 row 3개 추가 중...');
  await createInitialMetaRows(metaDb.id);
  console.log('    ✓');

  console.log('');
  console.log('💾 .env.local 업데이트 중...');
  updateEnvLocal({
    NOTION_CONTENT_DB_ID: contentDb.id,
    NOTION_PERFORMANCE_DB_ID: perfDb.id,
    NOTION_COMMENT_DB_ID: commentDb.id,
    NOTION_KNOWLEDGE_DB_ID: knowledgeDb.id,
    NOTION_SYSTEM_META_DB_ID: metaDb.id,
  });
  console.log('    ✓');

  console.log('');
  console.log('🎉 셋업 완료!');
  console.log('');
  console.log('📌 다음 단계:');
  console.log('   1. 노션에서 INVAIZ-Test 페이지 열어 5개 DB 확인');
  console.log('   2. 뷰(View)는 Notion API 에서 미지원 — 아래 중 하나로 추가:');
  console.log('      (a) docs/notion-schema.md §6 참고해 노션 UI 에서 수동 추가');
  console.log('      (b) docs/notion-schema.md §9.1 프롬프트를 Notion AI 에 붙여넣어 생성');
  console.log('   3. src/notion/databases/contentDb.ts 리팩토링');
  console.log('      (qoo10_content 제거, 타입 → 채널 마이그레이션)');
}

main().catch((err: unknown) => {
  console.error('');
  console.error('❌ 셋업 실패:');
  console.error(err);
  process.exit(1);
});
