// 기존 레퍼런스콘텐츠 레코드를 새 스키마로 마이그레이션
//
// 변경 내용:
//   - 이름: 포스트 첫 줄 (훅 문장)
//   - 카테고리: '레퍼런스콘텐츠' → '스레드 레퍼런스'
//   - 작성자 속성: 제목에서 @handle 추출해서 저장
//   - 콘텐츠 속성: 페이지 본문의 '본문' 섹션 텍스트로 채우기
//   - 페이지 본문: '## 본문' 섹션 제거 (콘텐츠 속성으로 이동), 배울점·메타 유지
//
// 실행: ./node_modules/.bin/tsx scripts/backfill-references.ts

import { notionClient } from '../src/notion/client.js';
import { markdownToBlocks } from '../src/notion/pages/pageBuilder.js';
import { env } from '../src/config/env.js';

const HANDLE_REGEX = /— (@[\w.\-]+) —/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Record<string, any>;

function getPlainText(richTextArr: AnyBlock[]): string {
  return (richTextArr ?? []).map((t: AnyBlock) => t.plain_text ?? '').join('');
}

// 블록 배열을 섹션별로 파싱
function parseSections(blocks: AnyBlock[]): {
  body: string;
  learning: string;
  meta: string;
} {
  type Section = 'none' | 'body' | 'learning' | 'meta';
  let current: Section = 'none';
  const bodyLines: string[] = [];
  const learningLines: string[] = [];
  const metaLines: string[] = [];

  for (const b of blocks) {
    if (b.type === 'heading_2') {
      const text = getPlainText(b.heading_2?.rich_text ?? []);
      if (text === '본문') { current = 'body'; continue; }
      if (text === '배울 점') { current = 'learning'; continue; }
      if (text === '메타 정보') { current = 'meta'; continue; }
    }
    if (b.type === 'divider') continue;

    const line = (() => {
      if (b.type === 'paragraph') return getPlainText(b.paragraph?.rich_text ?? []);
      if (b.type === 'bulleted_list_item') return '- ' + getPlainText(b.bulleted_list_item?.rich_text ?? []);
      return '';
    })();

    if (current === 'body') bodyLines.push(line);
    else if (current === 'learning') learningLines.push(line);
    else if (current === 'meta') metaLines.push(line);
  }

  return {
    body: bodyLines.join('\n').trim(),
    learning: learningLines.join('\n').trim(),
    meta: metaLines.join('\n').trim(),
  };
}

function buildNewBody(learning: string, meta: string): string {
  const parts: string[] = [];
  if (meta) parts.push(`## 메타 정보\n\n${meta}`);
  if (learning) parts.push(`## 배울 점\n\n${learning}`);
  return parts.join('\n\n---\n\n');
}

async function fetchAllBlocks(pageId: string): Promise<AnyBlock[]> {
  const all: AnyBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    all.push(...(res.results as AnyBlock[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

async function deleteAllBlocks(blocks: AnyBlock[]): Promise<void> {
  for (const b of blocks) {
    try {
      await notionClient.blocks.delete({ block_id: b.id });
    } catch {
      // 이미 삭제됐거나 권한 없으면 스킵
    }
  }
}

async function main(): Promise<void> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) {
    console.error('❌ NOTION_KNOWLEDGE_DB_ID 미설정');
    process.exit(1);
  }

  // title 속성명 자동 감지
  const dbInfo = await notionClient.databases.retrieve({ database_id: env.NOTION_KNOWLEDGE_DB_ID });
  const titlePropName = Object.entries(dbInfo.properties).find(([, p]) => p.type === 'title')?.[0] ?? '이름';
  console.log(`▶ title 속성명: "${titlePropName}"`);

  console.log('▶ 스레드 레퍼런스 레코드 조회 중...');

  const pages: AnyBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.databases.query({
      database_id: env.NOTION_KNOWLEDGE_DB_ID,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        property: '카테고리',
        select: { equals: '스레드 레퍼런스' },
      },
    });
    pages.push(...(res.results as AnyBlock[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`총 ${pages.length}건 마이그레이션 대상\n`);

  let success = 0;
  let fail = 0;

  for (const page of pages) {
    const pageId: string = page.id;
    const titleArr = page.properties?.[titlePropName]?.title ?? [];
    const currentTitle: string = titleArr.map((t: AnyBlock) => t.plain_text ?? '').join('');

    // 작성자 추출
    const handleMatch = currentTitle.match(HANDLE_REGEX);
    const author = handleMatch ? handleMatch[1] : '';

    try {
      // 블록 읽기
      const blocks = await fetchAllBlocks(pageId);
      const { body, learning, meta } = parseSections(blocks);

      // 한줄요약에서 앞쪽 핸들 단어 제거 후 폴백 제목 추출
      const summaryRaw = (page.properties?.['한줄요약']?.rich_text ?? [])
        .map((t: AnyBlock) => t.plain_text ?? '').join('');
      const summaryWords = summaryRaw.split(' ').filter(Boolean);
      while (summaryWords.length > 0 && /^[@\w.]+$/.test(summaryWords[0])) {
        summaryWords.shift();
      }
      const summaryFallback = summaryWords.slice(0, 12).join(' ').trim();

      // 새 제목: 본문 첫 줄(핸들·시간 제외) → 한줄요약 폴백 → currentTitle
      const isNoise = (l: string) =>
        /^[@\w.]+$/.test(l) ||
        /^\d+(일|시간|분|초|주|개월)전?$/.test(l) ||
        /^(방금|just now)$/i.test(l);

      const firstLine =
        body.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !isNoise(l)) ||
        summaryFallback ||
        currentTitle.slice(0, 60);
      const newTitle = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;

      // 콘텐츠 속성용 — 2000자 제한
      const contentText = body.slice(0, 2000);

      // 속성 업데이트
      const properties: AnyBlock = {
        [titlePropName]: { title: [{ text: { content: newTitle } }] },
        카테고리: { select: { name: '스레드 레퍼런스' } },
      };
      if (author) {
        properties['작성자'] = { multi_select: [{ name: author }] };
      }
      if (contentText) {
        properties['콘텐츠'] = { rich_text: [{ text: { content: contentText } }] };
      }

      await notionClient.pages.update({ page_id: pageId, properties });

      // 페이지 본문 교체 (본문 섹션 제거, 배울점·메타만 유지)
      const newBody = buildNewBody(learning, meta);
      if (newBody) {
        await deleteAllBlocks(blocks);
        await notionClient.blocks.children.append({
          block_id: pageId,
          children: markdownToBlocks(newBody) as AnyBlock[],
        });
      }

      console.log(`✅ ${newTitle.slice(0, 50)}`);
      success++;
    } catch (err) {
      console.error(`❌ ${currentTitle.slice(0, 40)} —`, (err as Error).message);
      fail++;
    }

    // Notion API 레이트 리밋 방지
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n완료: 성공 ${success}건 / 실패 ${fail}건`);
}

main().catch((err) => {
  console.error('❌ 치명적 오류:', err.message || err);
  process.exit(1);
});
