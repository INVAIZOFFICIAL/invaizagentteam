// Claude Code CLI 응답에서 JSON 블록 추출 — 각 에이전트 태스크 공용 유틸
// 우선순위: ```json ... ``` 코드펜스 → 첫 {…} 또는 [...] 매치.
// 파싱은 호출자가 직접 JSON.parse 한다 (결과 타입 좁히기는 사용처 책임).

type JsonKind = 'object' | 'array';

const CODE_FENCE_REGEX = /```json\n?([\s\S]*?)\n?```/;
const OBJECT_FALLBACK_REGEX = /(\{[\s\S]*\})/;
const ARRAY_FALLBACK_REGEX = /(\[[\s\S]*\])/;

export function extractJsonFromText(text: string, kind: JsonKind): string | null {
  const fallback = kind === 'array' ? ARRAY_FALLBACK_REGEX : OBJECT_FALLBACK_REGEX;
  const match = text.match(CODE_FENCE_REGEX) ?? text.match(fallback);
  return match ? match[1] : null;
}
