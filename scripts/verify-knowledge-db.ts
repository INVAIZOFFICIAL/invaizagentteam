// 지식 베이스 DB 스키마 실측 + 레퍼런스 카드 왕복 테스트
//
// 1. DB retrieve로 실제 property 이름·타입 확인
// 2. '레퍼런스콘텐츠' Select 옵션 존재 여부 확인
// 3. 테스트 레퍼런스 카드 1건 저장 → 조회 → 정리
//
// 실행: ./node_modules/.bin/tsx scripts/verify-knowledge-db.ts

import { notionClient } from '../src/notion/client.js';
import { env } from '../src/config/env.js';
import { saveToKnowledgeBase } from '../src/notion/databases/knowledgeDb.js';
import { queryRecentReferences } from '../src/notion/databases/knowledgeDb.js';

async function main(): Promise<void> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) {
    console.error('❌ NOTION_KNOWLEDGE_DB_ID 미설정');
    process.exit(1);
  }

  console.log('▶ 지식 베이스 DB 스키마 조회...');
  const db = await notionClient.databases.retrieve({
    database_id: env.NOTION_KNOWLEDGE_DB_ID,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (db as any).properties as Record<string, { type: string; select?: { options: Array<{ name: string }> } }>;
  console.log('\n속성 목록:');
  for (const [name, prop] of Object.entries(props)) {
    console.log(`  ${name.padEnd(14)} : ${prop.type}`);
  }

  const categoryOptions = props['카테고리']?.select?.options.map((o) => o.name) ?? [];
  console.log('\n카테고리 Select 옵션:');
  console.log(`  ${categoryOptions.join(' · ')}`);
  if (!categoryOptions.includes('레퍼런스콘텐츠')) {
    console.warn('⚠ "레퍼런스콘텐츠" 옵션이 DB에 없음. Select 옵션 추가 필요.');
  }

  const collectorOptions = props['수집자']?.select?.options.map((o) => o.name) ?? [];
  console.log('\n수집자 Select 옵션:');
  console.log(`  ${collectorOptions.join(' · ')}`);
  if (!collectorOptions.includes('nami')) {
    console.warn('⚠ "nami" 옵션이 DB에 없음.');
  }

  // ─── 왕복 저장 테스트 ──────────────────────────
  console.log('\n▶ 테스트 레퍼런스 카드 저장 시도...');
  const testTitle = `[나미] 레퍼런스 — @test_probe — _스키마검증용_ — ${new Date().toISOString()}`;
  const url = await saveToKnowledgeBase({
    title: testTitle,
    category: '레퍼런스콘텐츠',
    collector: 'nami',
    content: '**스키마 검증용 더미 카드**\n\n이 카드는 `verify-knowledge-db.ts` 가 생성. 확인 후 수동 삭제 가능.',
    summary: '스키마 검증용 더미 레퍼런스',
    sourceUrl: 'https://www.threads.com/@test_probe/post/VERIFY',
    tags: ['후킹:기타', '업종:기타', '언어:한국어', 'score:42', 'seed:기타'],
    reliability: '1차자료',
    status: 'Raw',
  });

  if (!url) {
    console.error('❌ 저장 실패 — knowledgeDb 로그 확인');
    process.exit(1);
  }
  console.log(`✅ 저장 성공: ${url}`);

  // 쿼리 재확인
  console.log('\n▶ queryRecentReferences 로 역조회...');
  const today = new Date().toISOString().split('T')[0];
  const refs = await queryRecentReferences(today);
  const match = refs.find((r) => r.title.includes('@test_probe'));
  if (!match) {
    console.warn('⚠ 조회 결과에 방금 저장한 카드 안 보임.');
  } else {
    console.log('✅ 조회 성공. 파싱 결과:');
    console.log({
      author: match.author,
      score: match.score,
      topic: match.topic,
      hooking: match.hooking,
      language: match.language,
      tags: match.tags,
      sourceUrl: match.sourceUrl,
    });
  }

  console.log('\n검증 끝. 생성된 더미 카드는 노션에서 수동 삭제 권장.');
}

main().catch((err) => {
  console.error('❌ 에러:', err.message || err);
  if (err.code || err.status) {
    console.error('details:', { code: err.code, status: err.status, body: err.body });
  }
  process.exit(1);
});
