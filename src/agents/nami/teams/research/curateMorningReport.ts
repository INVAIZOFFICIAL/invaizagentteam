// 아침 레퍼런스 큐레이션 태스크 (06:00 cron)
//
// 1. 지식 베이스 DB에서 어제 이후 수집된 스레드 레퍼런스 조회
// 2. Engagement score 기준 정렬 + 다양성 제약 (업종 max 3, 저자 max 1)
// 3. TOP N 선정 → deliverMorningReport 로 전달

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
  totalCandidates: number;
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

export async function curateMorningReport(): Promise<CurationResult> {
  const date = todayString();
  const since = yesterdayString();

  const refs = await queryRecentReferences(since);
  logger.info('nami', `큐레이션: 조회 ${refs.length}건 (since ${since})`);

  const sorted = [...refs].sort((a, b) => b.score - a.score);
  const top10 = pickTopN(sorted);

  return { date, top10, totalCandidates: refs.length };
}
