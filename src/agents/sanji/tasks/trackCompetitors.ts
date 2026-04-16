import { runClaude } from '@/claude/client.js';
import { SANJI_PERSONALITY } from '../sanji.personality.js';
import { logger } from '@/utils/logger.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';
import { nowIso } from '@/utils/timestamps.js';
import type { MarketInfo } from './crawlMarket.js';

export interface CompetitorSnapshot {
  competitorName: string;
  url: string;
  priceChanges: {
    product: string;
    oldPrice?: string;
    newPrice: string;
    changePercent?: number;
  }[];
  newProducts: string[];
  promotions: string[];
  trackedAt: string;
}

export interface CompetitorIntelligence {
  competitors: CompetitorSnapshot[];
  marketInsights: string[];    // Claude Code가 분석한 시장 시사점
  urgentAlerts: string[];      // 즉각 대응 필요 이슈
  analyzedAt: string;
}

// 수집된 시장 정보를 바탕으로 경쟁사 인텔리전스 생성 — Claude Code CLI 사용
export async function trackCompetitors(
  marketData: MarketInfo[],
  snapshots: CompetitorSnapshot[]
): Promise<CompetitorIntelligence> {
  const marketSummary = marketData
    .slice(0, 20)
    .map(m => `[${m.category}] ${m.headline}`)
    .join('\n');

  const snapshotSummary = snapshots
    .map(s => {
      const changes = s.priceChanges.map(p => `  - ${p.product}: ${p.newPrice}`).join('\n');
      return `${s.competitorName}:\n${changes || '  변화 없음'}`;
    })
    .join('\n\n');

  const prompt = `
INVAIZ DayZero의 시장 상황을 분석해줘.

## 최근 시장 뉴스
${marketSummary || '수집된 뉴스 없음'}

## 경쟁사 현황
${snapshotSummary || '경쟁사 데이터 없음'}

반드시 아래 JSON 형식으로만 응답해줘 (다른 말 없이):
{
  "marketInsights": ["시사점1", "시사점2"],
  "urgentAlerts": ["긴급이슈1"]
}
  `.trim();

  logger.info('sanji', '경쟁사 인텔리전스 분석 시작');

  // Claude Code CLI를 통해 실행 — API 직접 호출 금지
  const rawText = await runClaude(prompt, 'sanji', {
    systemPrompt: SANJI_PERSONALITY.systemPrompt,
    timeoutMs: 120_000,
  });

  const jsonRaw = extractJsonFromText(rawText, 'object');

  type ClaudeResult = { marketInsights: string[]; urgentAlerts: string[] };
  let parsed: ClaudeResult = { marketInsights: [], urgentAlerts: [] };
  if (jsonRaw) {
    parsed = JSON.parse(jsonRaw) as ClaudeResult;
  }

  logger.info('sanji', '경쟁사 인텔리전스 분석 완료');

  return {
    competitors: snapshots,
    marketInsights: parsed.marketInsights,
    urgentAlerts: parsed.urgentAlerts,
    analyzedAt: nowIso(),
  };
}
