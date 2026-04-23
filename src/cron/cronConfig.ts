// cron 표현식 상수 — 직접 문자열 사용 금지
export const CRON = {
  HOURLY:             '0 * * * *',
  DAILY_03:           '0 3 * * *',
  DAILY_03_30:        '30 3 * * *',
  DAILY_03_45:        '45 3 * * *',
  DAILY_04:           '0 4 * * *',
  DAILY_04_30:        '30 4 * * *',
  DAILY_06:           '0 6 * * *',
  DAILY_07:           '0 7 * * *',
  DAILY_09:           '0 9 * * *',
  DAILY_10:           '0 10 * * *',
  DAILY_14:           '0 14 * * *',
  WEEKLY_MON_09:      '0 9 * * 1',
  WEEKLY_SUN_03_30:   '30 3 * * 0',
  MON_WED_FRI_04_30:  '30 4 * * 1,3,5',
  EVERY_6H:           '0 */6 * * *',
  EVERY_10MIN:        '*/10 * * * *',
} as const;
