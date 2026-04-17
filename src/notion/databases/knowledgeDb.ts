import { notionClient } from '@/notion/client.js';
import { markdownToBlocks } from '@/notion/pages/pageBuilder.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { todayDateOnly } from '@/utils/timestamps.js';
import type { NotionPageLike, NotionPropertyBag } from '@/types/notion.types.js';

// 지식 베이스 DB 에서 조회된 레퍼런스 카드 요약 (큐레이션용)
export interface KnowledgeRefSummary {
  pageId: string;
  title: string;
  author: string; // @handle, 파싱 실패 시 'unknown'
  summary: string;
  sourceUrl: string | null;
  collectedAt: string | null; // YYYY-MM-DD
  tags: string[];
  score: number; // tags 에서 'score:N' 파싱
  topic: string; // tags 에서 '업종:X' 파싱
  hooking: string; // tags 에서 '후킹:Y' 파싱
  language: string; // tags 에서 '언어:Z' 파싱
}

const HANDLE_REGEX = /— (@[\w.\-]+) —/;

function parseTagValue(tags: string[], prefix: string): string {
  const hit = tags.find((t) => t.startsWith(prefix + ':'));
  return hit ? hit.slice(prefix.length + 1) : '';
}

function parseScore(tags: string[]): number {
  const raw = parseTagValue(tags, 'score');
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

// 지식 베이스 DB 의 `카테고리` Select 값
export type KnowledgeCategory =
  | '시장동향'
  | '경쟁사'
  | 'UT인사이트'
  | '사용자Quote'
  | '스레드 레퍼런스'
  | '인스타 레퍼런스'
  | '데이터통계'
  | '툴리소스';

// 지식 베이스 DB 의 `신뢰도` Select 값
export type KnowledgeReliability = '1차자료' | '2차자료' | '소문추정';

// 지식 베이스 DB 의 `상태` Select 값
export type KnowledgeStatus = 'Raw' | '검증됨' | '활용됨' | '보관';

export interface KnowledgeEntry {
  title: string;
  category: KnowledgeCategory;
  collector: string; // 수집자 (에이전트 이름)
  content: string; // 페이지 children 본문 (배울점·메타)
  contentText?: string; // 콘텐츠 속성 — 원문+댓글 구분자 포함 (최대 2000자)
  author?: string; // 작성자 핸들
  likes?: number;
  replies?: number;
  reposts?: number;
  shares?: number;
  imageUrls?: string[]; // 포스트 이미지 external URL 목록
  summary?: string; // 한줄요약
  sourceUrl?: string; // 원본URL
  tags?: string[]; // 태그 (멀티 셀렉트)
  collectedAt?: string; // 수집일 (ISO date)
  reliability?: KnowledgeReliability;
  status?: KnowledgeStatus; // 기본 'Raw'
}

/**
 * 지식 베이스 DB 에 새 카드 저장
 * 사단 전체(루피·나미·조로·우솝·상디·초퍼)가 수집하는 지식 자산을 쌓는 공통 저장소.
 *
 * 예: 나미가 경쟁사 분석 결과를 `category: '경쟁사'` 로 저장,
 *     초퍼가 UT quote 를 `category: '사용자Quote'` 로 승급, 등.
 */
export async function saveToKnowledgeBase(entry: KnowledgeEntry): Promise<string | undefined> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) {
    logger.warn('knowledgeDb', 'NOTION_KNOWLEDGE_DB_ID가 설정되지 않아 노션 저장 건너뜀');
    return undefined;
  }

  try {
    const properties: NotionPropertyBag = {
      이름: { title: [{ text: { content: entry.title } }] },
      카테고리: { select: { name: entry.category } },
      수집자: { select: { name: entry.collector } },
      상태: { select: { name: entry.status ?? 'Raw' } },
    };

    if (entry.author) {
      properties['작성자'] = { multi_select: [{ name: entry.author }] };
    }
    if (entry.contentText) {
      // rich_text 최대 2000자 제한
      const truncated = entry.contentText.slice(0, 2000);
      properties['콘텐츠'] = { rich_text: [{ text: { content: truncated } }] };
    }
    if (entry.likes !== undefined) {
      properties['좋아요'] = { number: entry.likes };
    }
    if (entry.replies !== undefined) {
      properties['댓글'] = { number: entry.replies };
    }
    if (entry.reposts !== undefined) {
      properties['리포스트/인용'] = { number: entry.reposts };
    }
    if (entry.shares !== undefined) {
      properties['공유'] = { number: entry.shares };
    }
    if (entry.imageUrls && entry.imageUrls.length > 0) {
      properties['이미지'] = {
        files: entry.imageUrls.map((url) => ({
          name: '이미지',
          type: 'external',
          external: { url },
        })),
      };
    }
    if (entry.summary) {
      properties['한줄요약'] = { rich_text: [{ text: { content: entry.summary } }] };
    }
    if (entry.sourceUrl) {
      properties['원본URL'] = { url: entry.sourceUrl };
    }
    if (entry.tags && entry.tags.length > 0) {
      properties['태그'] = {
        multi_select: entry.tags.map((name) => ({ name })),
      };
    }
    if (entry.collectedAt) {
      properties['수집일'] = { date: { start: entry.collectedAt } };
    } else {
      properties['수집일'] = {
        date: { start: todayDateOnly() },
      };
    }
    if (entry.reliability) {
      properties['신뢰도'] = { select: { name: entry.reliability } };
    }

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_KNOWLEDGE_DB_ID },
      properties,
      children: markdownToBlocks(entry.content),
    });

    const pageUrl = (page as { url?: string }).url;
    logger.info('knowledgeDb', `지식 베이스 저장 완료: ${entry.title}`, { url: pageUrl });
    return pageUrl;
  } catch (error) {
    logger.error('knowledgeDb', '지식 베이스 저장 실패', error);
    return undefined;
  }
}

/**
 * 특정 날짜 이후에 수집된 레퍼런스콘텐츠 조회.
 *
 * @param sinceDate YYYY-MM-DD (inclusive). 예: 어제 날짜를 넘기면 어제·오늘 수집분.
 */
export async function queryRecentReferences(
  sinceDate: string,
): Promise<KnowledgeRefSummary[]> {
  if (!env.NOTION_KNOWLEDGE_DB_ID) {
    logger.warn('knowledgeDb', 'NOTION_KNOWLEDGE_DB_ID 미설정 — 빈 배열 반환');
    return [];
  }

  try {
    const results: KnowledgeRefSummary[] = [];
    let cursor: string | undefined;

    do {
      const res = await notionClient.databases.query({
        database_id: env.NOTION_KNOWLEDGE_DB_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: {
          and: [
            { property: '카테고리', select: { equals: '스레드 레퍼런스' } },
            { property: '수집일', date: { on_or_after: sinceDate } },
          ],
        },
      });

      for (const page of res.results) {
        const p = page as NotionPageLike;
        if (!p.properties) continue;

        const titleArr = p.properties['제목']?.title ?? [];
        const title = titleArr.map((t: { plain_text?: string }) => t.plain_text ?? '').join('');
        const contentArr = p.properties['콘텐츠']?.rich_text ?? [];
        const summary = contentArr.map((t: { plain_text?: string }) => t.plain_text ?? '').join('');
        const url = p.properties['원본URL']?.url ?? null;
        const tagsRaw = p.properties['태그']?.multi_select ?? [];
        const tags = tagsRaw.map((t: { name: string }) => t.name);
        const collectedAt = p.properties['수집일']?.date?.start ?? null;
        const authorRaw = p.properties['작성자']?.multi_select?.[0]?.name ?? 'unknown';

        const likes = p.properties['좋아요']?.number ?? 0;
        const replies = p.properties['댓글']?.number ?? 0;
        const reposts = p.properties['리포스트/인용']?.number ?? 0;
        const shares = p.properties['공유']?.number ?? 0;
        const score = likes + replies + reposts + shares;

        results.push({
          pageId: p.id,
          title,
          author: authorRaw,
          summary,
          sourceUrl: url,
          collectedAt,
          tags,
          score,
          topic: parseTagValue(tags, '업종'),
          hooking: parseTagValue(tags, '후킹'),
          language: parseTagValue(tags, '언어'),
        });
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);

    return results;
  } catch (error) {
    logger.error('knowledgeDb', '레퍼런스 조회 실패', error);
    return [];
  }
}
