// 실제 Threads 포스트 + 분류 결과가 노션에 어떻게 저장되는지 왕복 검증
//
// 실행: ./node_modules/.bin/tsx scripts/verify-reference-body.ts

import { notionClient } from '../src/notion/client.js';
import { saveToKnowledgeBase } from '../src/notion/databases/knowledgeDb.js';

// 실 크롤로 얻은 포스트 (@storyteller_jhk 87 좋아요 글)
const realPost = {
  permalink: 'https://www.threads.com/@storyteller_jhk/post/DXDyQT-Eoal',
  text: `<언젠간 닥쳐올 창작자로서의 죽음>

열의는 사라진 채, 재능의 유산으로 연명하는 사람을 보면 두렵다.
언젠간 나도 저리 될 테니. 필연적이며 서글픈 공포가 잠식할 때.
내가 저항할 수 있는 방법은 그저 의자에 앉아서 보고 쓰기 뿐.
창작이라는 게임의 룰은 절대 공평하지 않다.
다만 위안이 되는 건. 모든 건 확률게임.
마지막 장을 넘기기 전에 세상을 눈물바다로 만들 확률을 높이자.`,
  timestamp: '2026-04-13T04:53:37.000Z',
  likes: 87,
  replies: 10,
  reposts: 2,
  shares: 0,
};

// runClaude 대신 mock 분류 (Max 한도 절약)
const mockClassification = {
  hookingType: '인사이트선언형',
  topicCategory: '창작자',
  language: '한국어',
  learning: '장문 에세이 + 감정 선언형 클로징으로 공감·저장 유도 → 역직구 셀러 번아웃 주제에 응용 가능',
};

const score = realPost.likes + realPost.reposts * 3 + realPost.replies * 2;

const body = `## 본문

${realPost.text}

---

## 배울 점

${mockClassification.learning}

---

## 메타 정보

- **작성자**: @storyteller_jhk (시드: 마케팅)
- **작성시각**: ${realPost.timestamp}
- **링크**: ${realPost.permalink}
- **지표**: ❤ ${realPost.likes} · 💬 ${realPost.replies} · 🔁 ${realPost.reposts} · ↗ ${realPost.shares} · **Score ${score}**
- **분류**: ${mockClassification.hookingType} · ${mockClassification.topicCategory} · ${mockClassification.language}
`;

async function main(): Promise<void> {
  const titleExcerpt = realPost.text.slice(0, 40).replace(/\s+/g, ' ');
  const title = `[나미] 레퍼런스 — @storyteller_jhk — ${titleExcerpt}…`;

  console.log('▶ 저장 시도');
  const url = await saveToKnowledgeBase({
    title,
    category: '레퍼런스콘텐츠',
    collector: 'nami',
    content: body,
    summary: realPost.text.slice(0, 180).replace(/\s+/g, ' '),
    sourceUrl: realPost.permalink,
    tags: [
      `후킹:${mockClassification.hookingType}`,
      `업종:${mockClassification.topicCategory}`,
      `언어:${mockClassification.language}`,
      `score:${score}`,
      'seed:마케팅',
    ],
    reliability: '1차자료',
    status: 'Raw',
  });

  if (!url) {
    console.error('❌ 저장 실패');
    process.exit(1);
  }
  console.log(`✅ 저장: ${url}\n`);

  // 페이지 ID 추출 (URL 끝 32자)
  const pageIdMatch = url.match(/([a-f0-9]{32})$/);
  const pageId = pageIdMatch ? pageIdMatch[1] : null;
  if (!pageId) {
    console.error('pageId 추출 실패');
    return;
  }

  // 속성(properties) 재조회
  console.log('▶ 페이지 properties 조회');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = (await notionClient.pages.retrieve({ page_id: pageId })) as any;
  const props = page.properties as Record<string, unknown>;

  const dump = (name: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = props[name] as any;
    if (!p) return '(없음)';
    if (p.type === 'title') return p.title.map((t: { plain_text: string }) => t.plain_text).join('');
    if (p.type === 'rich_text') return p.rich_text.map((t: { plain_text: string }) => t.plain_text).join('');
    if (p.type === 'select') return p.select?.name ?? '(비어있음)';
    if (p.type === 'multi_select') return p.multi_select.map((m: { name: string }) => m.name).join(', ');
    if (p.type === 'url') return p.url ?? '(비어있음)';
    if (p.type === 'date') return p.date?.start ?? '(비어있음)';
    return `[${p.type}]`;
  };

  console.log(`  이름       : ${dump('이름')}`);
  console.log(`  카테고리   : ${dump('카테고리')}`);
  console.log(`  수집자     : ${dump('수집자')}`);
  console.log(`  상태       : ${dump('상태')}`);
  console.log(`  신뢰도     : ${dump('신뢰도')}`);
  console.log(`  수집일     : ${dump('수집일')}`);
  console.log(`  한줄요약   : ${dump('한줄요약')}`);
  console.log(`  원본URL    : ${dump('원본URL')}`);
  console.log(`  태그       : ${dump('태그')}`);

  // 페이지 본문 블록 조회
  console.log('\n▶ 페이지 본문 블록 조회');
  const blocks = await notionClient.blocks.children.list({ block_id: pageId, page_size: 50 });
  console.log(`  블록 수: ${blocks.results.length}\n`);
  for (let i = 0; i < blocks.results.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks.results[i] as any;
    const t = b.type;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const richToText = (arr: any[]): string =>
      Array.isArray(arr) ? arr.map((r) => r.plain_text ?? '').join('') : '';
    let preview = '';
    if (t === 'paragraph') preview = richToText(b.paragraph.rich_text);
    else if (t === 'heading_1') preview = '# ' + richToText(b.heading_1.rich_text);
    else if (t === 'heading_2') preview = '## ' + richToText(b.heading_2.rich_text);
    else if (t === 'heading_3') preview = '### ' + richToText(b.heading_3.rich_text);
    else if (t === 'bulleted_list_item') preview = '• ' + richToText(b.bulleted_list_item.rich_text);
    else if (t === 'quote') preview = '> ' + richToText(b.quote.rich_text);
    else preview = `[${t}]`;
    console.log(`  [${String(i + 1).padStart(2)}] ${t.padEnd(20)} ${preview.slice(0, 100)}`);
  }

  console.log('\n검증 끝. 노션에서 실제로 확인:');
  console.log(`  ${url}`);
}

main().catch((err) => {
  console.error('❌ 에러:', err.message || err);
  process.exit(1);
});
