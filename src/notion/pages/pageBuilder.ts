import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js';

// Notion rich_text 항목 (공식 타입 경로가 내부용이라 로컬 정의)
type RichText =
  | { type: 'text'; text: { content: string } }
  | { type: 'text'; text: { content: string }; annotations: { bold: true } };

// 한 줄 안의 **bold** 마크다운을 Notion rich_text 배열로 변환
function parseInlineBold(line: string): RichText[] {
  const items: RichText[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > lastIdx) {
      items.push({ type: 'text', text: { content: line.slice(lastIdx, m.index) } });
    }
    items.push({
      type: 'text',
      text: { content: m[1] },
      annotations: { bold: true },
    });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < line.length) {
    items.push({ type: 'text', text: { content: line.slice(lastIdx) } });
  }
  return items.length > 0 ? items : [{ type: 'text', text: { content: line } }];
}

// Markdown 텍스트를 Notion 블록 배열로 변환
// 지원: # / ## / ### 헤딩, - / * 불릿, > 인용, --- 구분선, **bold** 인라인
export function markdownToBlocks(markdown: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: parseInlineBold(line.slice(2)) },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: parseInlineBold(line.slice(3)) },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: parseInlineBold(line.slice(4)) },
      });
    } else if (line.trim() === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInlineBold(line.slice(2)) },
      });
    } else if (line.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: parseInlineBold(line.slice(2)) },
      });
    } else if (line.trim() === '') {
      // 빈 줄은 단락 구분
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: parseInlineBold(line) },
      });
    }
  }

  return blocks;
}
