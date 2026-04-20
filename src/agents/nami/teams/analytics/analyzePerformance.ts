import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '../../nami.personality.js';
import { logger } from '@/utils/logger.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';
import { nowIso } from '@/utils/timestamps.js';

export interface ContentPerformanceData {
  contentId: string;
  title: string;
  publishedAt: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue?: number;
}

export interface PerformanceAnalysis {
  contentId: string;
  ctr: number;            // 클릭률 (%)
  conversionRate: number; // 전환율 (%)
  roas?: number;          // 광고 수익률
  insights: string[];     // 나미가 분석한 인사이트
  recommendations: string[]; // 개선 권고사항
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  analyzedAt: string;
}

// 콘텐츠 성과 분석 — Claude Code CLI 사용
export async function analyzePerformance(
  data: ContentPerformanceData[]
): Promise<PerformanceAnalysis[]> {
  if (data.length === 0) return [];

  // 기본 지표 계산
  const withMetrics = data.map(d => ({
    ...d,
    ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
    conversionRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
    roas: d.revenue && d.conversions > 0 ? d.revenue / d.conversions : undefined,
  }));

  const dataText = withMetrics
    .map(
      d =>
        `[${d.contentId}] "${d.title}" — 노출:${d.impressions} / 클릭:${d.clicks} (CTR:${d.ctr.toFixed(2)}%) / 전환:${d.conversions} (CVR:${d.conversionRate.toFixed(2)}%)${d.roas ? ` / ROAS:${d.roas.toFixed(1)}x` : ''}`
    )
    .join('\n');

  const prompt = `
다음 콘텐츠 성과 데이터를 분석해줘. 데이터 기반으로 냉정하게 분석하고, 각 콘텐츠에 S~D 등급을 매겨줘.

${dataText}

반드시 아래 JSON 배열 형식으로만 응답해줘 (다른 말 없이):
[
  {
    "contentId": "...",
    "insights": ["인사이트1", "인사이트2"],
    "recommendations": ["개선안1", "개선안2"],
    "grade": "A"
  }
]
  `.trim();

  logger.info('nami', `성과 분석 시작: ${data.length}개 콘텐츠`);

  // Claude Code CLI를 통해 실행
  const rawText = await runClaude(prompt, 'nami', {
    systemPrompt: NAMI_PERSONALITY.systemPrompt,
    timeoutMs: 120_000,
  });

  const jsonRaw = extractJsonFromText(rawText, 'array');
  if (!jsonRaw) {
    throw new Error(`성과 분석 응답에서 JSON 추출 실패:\n${rawText.slice(0, 200)}`);
  }

  type ClaudeAnalysis = {
    contentId: string;
    insights: string[];
    recommendations: string[];
    grade: 'S' | 'A' | 'B' | 'C' | 'D';
  };
  const claudeAnalysis = JSON.parse(jsonRaw) as ClaudeAnalysis[];
  const analysisMap = new Map(claudeAnalysis.map(a => [a.contentId, a]));

  logger.info('nami', `성과 분석 완료: ${data.length}개 콘텐츠`);

  return withMetrics.map(d => {
    const analysis = analysisMap.get(d.contentId);
    return {
      contentId: d.contentId,
      ctr: d.ctr,
      conversionRate: d.conversionRate,
      roas: d.roas,
      insights: analysis?.insights ?? [],
      recommendations: analysis?.recommendations ?? [],
      grade: analysis?.grade ?? 'C',
      analyzedAt: nowIso(),
    };
  });
}
