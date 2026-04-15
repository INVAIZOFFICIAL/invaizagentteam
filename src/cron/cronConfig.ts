// cron 표현식 상수 — 직접 문자열 사용 금지
export const CRON = {
  HOURLY:         '0 * * * *',
  DAILY_06:       '0 6 * * *',
  DAILY_09:       '0 9 * * *',
  DAILY_10:       '0 10 * * *',
  WEEKLY_MON_09:  '0 9 * * 1',
  EVERY_6H:       '0 */6 * * *',
} as const;
