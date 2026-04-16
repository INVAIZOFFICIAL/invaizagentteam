import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// LaunchAgent 환경에서 stdout 이 block-buffered 되어 로그가 지연되는 문제 회피.
// console 출력 + 파일에도 동시 기록 (fs.appendFileSync 는 즉시 flush).
const LOG_DIR = process.env.LUFFY_LOG_DIR ?? path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // 권한·존재 문제는 콘솔 출력만으로 가도록 무시
}

function formatData(data: unknown): string {
  if (data === undefined) return '';
  if (typeof data === 'string') return ' ' + data;
  try {
    return ' ' + JSON.stringify(data);
  } catch {
    return ' [unserializable]';
  }
}

function log(level: LogLevel, agent: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${agent}]`;
  const line = `${prefix} ${message}${formatData(data)}`;

  // 파일에 즉시 기록 (버퍼링 없음)
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* 파일 기록 실패는 무시, 콘솔은 시도 */
  }

  // 콘솔 출력 (dev 환경 실시간 확인용)
  const method = level === 'debug' ? 'log' : level;
  if (data !== undefined) {
    console[method](`${prefix} ${message}`, data);
  } else {
    console[method](`${prefix} ${message}`);
  }
}

export const logger = {
  info: (agent: string, message: string, data?: unknown) => log('info', agent, message, data),
  warn: (agent: string, message: string, data?: unknown) => log('warn', agent, message, data),
  error: (agent: string, message: string, data?: unknown) => log('error', agent, message, data),
  debug: (agent: string, message: string, data?: unknown) => log('debug', agent, message, data),
};
