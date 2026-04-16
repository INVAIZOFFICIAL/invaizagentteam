// 에이전트 사단 공용 타임스탬프 유틸
// logger.ts 는 이 모듈을 쓰지 않는다 — 향후 timestamps 가 logger 에 의존할 가능성 차단용.

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDateOnly(): string {
  return new Date().toISOString().split('T')[0];
}
