// 에이전트 사단 공용 타임스탬프 유틸
// logger.ts 는 이 모듈을 쓰지 않는다 — 향후 timestamps 가 logger 에 의존할 가능성 차단용.

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDateOnly(): string {
  // KST(UTC+9) 기준 날짜 반환 — UTC 기준으로 반환하면 새벽 cron(05:00 KST = 20:00 UTC)이
  // 전날 날짜로 인식되어 dedup 오작동 발생
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + kstOffset).toISOString().split('T')[0];
}
