// 역직구 콘텐츠 관련성 검증 + 한국어 요약 생성
// 모든 크롤러 공용 — 저장 전 Claude를 통해 정보의 정확성·관련성 이중 확인

import { runClaude } from '@/claude/client.js';
import { extractJsonFromText } from '@/utils/jsonExtraction.js';
import { logger } from '@/utils/logger.js';

export interface ArticleToValidate {
  title: string;
  url: string;
  content: string;
  source: string;
  language: 'ko' | 'ja' | 'en';
}

export interface ValidationResult {
  url: string;
  relevant: boolean;
  summary: string;        // 한국어 2-3문장 (역직구 셀러 관점 핵심 요약)
  contentType: 'news' | 'guide' | 'case_study' | 'opinion';
  tags: string[];
  confidenceLevel: 'high' | 'medium' | 'low';
}

const BATCH_SIZE = 5;

const SYSTEM_PROMPT = `너는 역직구(한국 셀러가 Qoo10·Amazon·eBay 등 해외 마켓에서 판매) 전문가 편집자야.
수집된 기사들을 검토하고, 역직구 셀러에게 실제로 유용한 정보인지 판단한다.

관련 있는 주제: 해외 이커머스 트렌드, 플랫폼 정책/수수료 변화, 국제 물류·배송, 관세·세금, 소비자 동향,
마케팅·광고 전략, 성공 사례, 시장 규제, 환율·결제, 상품 카테고리 동향.

판단 기준:
- 역직구 전문 미디어(colosseum, ecnomikata 등 크로스보더 전문 사이트)에서 수집된 기사는 완전히 무관한 게 아닌 한 relevant=true 로 판단한다.
- 국제 물류·배송·풀필먼트 정보도 역직구 셀러에게 직접 필요하므로 relevant=true.
- 완전히 무관한 것만 relevant=false: 국내 오프라인 유통, 비-이커머스 산업, 순수 광고·홍보 글.

중요: 요약은 반드시 **한국어**로 작성. 일본어·영어 원문도 한국어로 요약할 것.`;

export async function validateArticles(
  articles: ArticleToValidate[],
): Promise<ValidationResult[]> {
  if (articles.length === 0) return [];

  const results: ValidationResult[] = [];

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);

    const articlesPayload = batch.map((a) => ({
      url: a.url,
      title: a.title,
      content: a.content.slice(0, 600),
      language: a.language,
      source: a.source,
    }));

    const prompt = `아래 ${batch.length}개 기사를 역직구 셀러 관점에서 검토해줘.

기사:
${JSON.stringify(articlesPayload, null, 2)}

각 기사에 대해 아래 JSON 배열로만 응답해. 추가 설명 없이 JSON만:

\`\`\`json
[
  {
    "url": "기사 URL 그대로",
    "relevant": true,
    "summary": "역직구 셀러를 위한 한국어 핵심 요약 2-3문장",
    "contentType": "news",
    "tags": ["트렌드"],
    "confidenceLevel": "high"
  }
]
\`\`\`

contentType: "news"(공식 발표·뉴스) | "guide"(방법론·가이드) | "case_study"(성공사례) | "opinion"(칼럼·의견)
tags 중 해당하는 것 선택: 물류, 관세/세금, 플랫폼정책, 마케팅, 트렌드, 규제, 소비자동향, 성공사례, 배송, 광고/키워드
confidenceLevel: "high"(공식발표·데이터·수치 근거) | "medium"(실무 전문가) | "low"(개인의견·광고성)`;

    try {
      const output = await runClaude(prompt, 'zoro:validate', {
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 1,
        timeoutMs: 90_000,
      });

      const jsonStr = extractJsonFromText(output, 'array');
      if (!jsonStr) {
        logger.warn('zoro:validate', 'JSON 파싱 실패 — 배치 스킵', { output: output.slice(0, 300) });
        continue;
      }

      const parsed = JSON.parse(jsonStr) as ValidationResult[];
      results.push(...parsed);
      logger.debug('zoro:validate', `배치 ${i / BATCH_SIZE + 1} 완료 — ${parsed.filter((r) => r.relevant).length}/${parsed.length}건 통과`);
    } catch (err) {
      logger.error('zoro:validate', '배치 검증 실패', err);
    }
  }

  return results;
}
