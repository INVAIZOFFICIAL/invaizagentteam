import { runClaude } from '@/claude/client.js';
import { NAMI_PERSONALITY } from '../nami.personality.js';
import { logger } from '@/utils/logger.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';
import { nowIso } from '@/utils/timestamps.js';
import type { CompetitorContent } from './crawlCompetitor.js';

export interface Qoo10ContentInput {
  productName: string;
  category: string;
  features: string[];
  targetAudience: string;
  pricePoint?: string;
  competitorData?: CompetitorContent[];
}

export interface Qoo10ContentOutput {
  title: string;           // 상품명 (최대 100자)
  shortDescription: string; // 짧은 설명 (검색 노출용)
  fullDescription: string; // 상세 설명
  keywords: string[];      // SEO 키워드
  sellingPoints: string[]; // 핵심 판매 포인트
  generatedAt: string;
}

// Qoo10 상품 설명 생성 — Claude Code CLI 사용 (API 직접 호출 금지)
export async function generateQoo10Content(
  input: Qoo10ContentInput
): Promise<Qoo10ContentOutput> {
  // 경쟁사 데이터 컨텍스트 구성
  const competitorContext = input.competitorData && input.competitorData.length > 0
    ? `\n\n## 경쟁사 분석 데이터\n${input.competitorData
        .map(c => `- ${c.title}: ${c.description.slice(0, 200)}`)
        .join('\n')}`
    : '';

  const prompt = `
다음 INVAIZ DayZero 상품의 Qoo10 상품 설명을 작성해줘.

## 상품 정보
- 상품명: ${input.productName}
- 카테고리: ${input.category}
- 주요 기능: ${input.features.join(', ')}
- 타겟 고객: ${input.targetAudience}
${input.pricePoint ? `- 가격대: ${input.pricePoint}` : ''}
${competitorContext}

## 요구사항
1. 제목: 검색 최적화된 상품명 (100자 이내, 한국어+영어 키워드 포함)
2. 짧은 설명: 3줄 이내 핵심 어필 문구
3. 상세 설명: 구매 욕구를 자극하는 500-800자 설명
4. SEO 키워드: 10개
5. 핵심 판매 포인트: 5개 bullet

반드시 아래 JSON 형식으로만 응답해줘 (다른 말 없이):
{
  "title": "...",
  "shortDescription": "...",
  "fullDescription": "...",
  "keywords": ["...", "..."],
  "sellingPoints": ["...", "..."]
}
  `.trim();

  logger.info('nami', `Qoo10 콘텐츠 생성 시작: ${input.productName}`);

  // Claude Code CLI를 통해 실행 — Max 구독 활용, API 키 불필요
  const rawText = await runClaude(prompt, 'nami', {
    systemPrompt: NAMI_PERSONALITY.systemPrompt,
    timeoutMs: 120_000,
  });

  const jsonRaw = extractJsonFromText(rawText, 'object');
  if (!jsonRaw) {
    throw new Error(`Claude Code 응답에서 JSON 추출 실패:\n${rawText.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonRaw) as Omit<Qoo10ContentOutput, 'generatedAt'>;

  logger.info('nami', `Qoo10 콘텐츠 생성 완료: ${input.productName}`);

  return {
    ...parsed,
    generatedAt: nowIso(),
  };
}
