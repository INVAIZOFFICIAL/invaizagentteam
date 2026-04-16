// 아침 레퍼런스 리포트 큐레이션 태스크 (06:00 cron)
//
// 1. 지식 베이스 DB 에서 어제 00:00 이후 수집된 레퍼런스콘텐츠 조회
// 2. Engagement score 기준 정렬 + 다양성 제약 (업종 max 3, 저자 max 1)
// 3. TOP 10 선정 → NOTION_PARENT_PAGE_ID 아래에 "🍊 오늘의 레퍼런스 — YYYY-MM-DD" 페이지 생성

import { notionClient } from '@/notion/client.js';
import { markdownToBlocks } from '@/notion/pages/pageBuilder.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import {
  queryRecentReferences,
  type KnowledgeRefSummary,
} from '@/notion/databases/knowledgeDb.js';

const TOP_N = 10;
const MAX_PER_TOPIC = 3;
const MAX_PER_AUTHOR = 1;

export interface CurationResult {
  date: string;
  top10: KnowledgeRefSummary[];
  notionPageUrl: string | undefined;
  totalCandidates: number;
}

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 다양성 제약 적용하며 TOP N 선정
function pickTopN(sorted: KnowledgeRefSummary[]): KnowledgeRefSummary[] {
  const selected: KnowledgeRefSummary[] = [];
  const topicCount = new Map<string, number>();
  const authorCount = new Map<string, number>();

  for (const ref of sorted) {
    if (selected.length >= TOP_N) break;
    const topic = ref.topic || '기타';
    const author = ref.author || 'unknown';
    if ((topicCount.get(topic) ?? 0) >= MAX_PER_TOPIC) continue;
    if ((authorCount.get(author) ?? 0) >= MAX_PER_AUTHOR) continue;
    selected.push(ref);
    topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
    authorCount.set(author, (authorCount.get(author) ?? 0) + 1);
  }

  // 10개 미만이면 제약 완화해서 채움 (저자 중복 허용)
  if (selected.length < TOP_N) {
    for (const ref of sorted) {
      if (selected.length >= TOP_N) break;
      if (selected.find((s) => s.pageId === ref.pageId)) continue;
      selected.push(ref);
    }
  }
  return selected;
}

function buildMarkdown(date: string, top10: KnowledgeRefSummary[], totalCandidates: number): string {
  const topicDist = new Map<string, number>();
  for (const r of top10) {
    const k = r.topic || '기타';
    topicDist.set(k, (topicDist.get(k) ?? 0) + 1);
  }
  const distStr = Array.from(topicDist.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}(${v})`)
    .join(' · ');

  const lines: string[] = [];
  lines.push(`# 🍊 오늘의 레퍼런스 — ${date}`);
  lines.push('');
  lines.push(`어제~오늘 수집된 **${totalCandidates}건** 중 나미가 고른 **TOP ${top10.length}**.`);
  lines.push(`업종 분포: ${distStr || '(없음)'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  top10.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.author} — score ${r.score}`);
    lines.push('');
    lines.push(`**업종**: ${r.topic || '기타'} · **후킹**: ${r.hooking || '기타'} · **언어**: ${r.language || '한국어'}`);
    if (r.sourceUrl) {
      lines.push(`**원문**: ${r.sourceUrl}`);
    }
    lines.push('');
    if (r.summary) {
      lines.push(`> ${r.summary.replace(/\n+/g, ' ')}`);
      lines.push('');
    }
  });
  lines.push('---');
  lines.push('');
  lines.push('*매일 03:00 수집 → 06:00 큐레이션 → 07:00 배달 (맥미니 cron).*');
  return lines.join('\n');
}

export async function curateMorningReport(): Promise<CurationResult> {
  const date = todayString();
  const since = yesterdayString();

  const refs = await queryRecentReferences(since);
  logger.info('nami', `큐레이션: 조회 ${refs.length}건 (since ${since})`);

  // score 내림차순 정렬
  const sorted = [...refs].sort((a, b) => b.score - a.score);
  const top10 = pickTopN(sorted);

  let pageUrl: string | undefined;
  if (env.NOTION_PARENT_PAGE_ID) {
    try {
      const md = buildMarkdown(date, top10, refs.length);
      const page = await notionClient.pages.create({
        parent: { page_id: env.NOTION_PARENT_PAGE_ID },
        properties: {
          title: { title: [{ text: { content: `🍊 오늘의 레퍼런스 — ${date}` } }] },
        },
        children: markdownToBlocks(md),
      });
      pageUrl = (page as { url?: string }).url;
      logger.info('nami', `큐레이션 페이지 생성: ${pageUrl}`);
    } catch (err) {
      logger.error('nami', '큐레이션 페이지 생성 실패', err);
    }
  } else {
    logger.warn('nami', 'NOTION_PARENT_PAGE_ID 미설정 — 페이지 생성 스킵');
  }

  return {
    date,
    top10,
    notionPageUrl: pageUrl,
    totalCandidates: refs.length,
  };
}
