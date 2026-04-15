type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, agent: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${agent}]`;

  if (data) {
    console[level === 'debug' ? 'log' : level](`${prefix} ${message}`, data);
  } else {
    console[level === 'debug' ? 'log' : level](`${prefix} ${message}`);
  }
}

export const logger = {
  info: (agent: string, message: string, data?: unknown) => log('info', agent, message, data),
  warn: (agent: string, message: string, data?: unknown) => log('warn', agent, message, data),
  error: (agent: string, message: string, data?: unknown) => log('error', agent, message, data),
  debug: (agent: string, message: string, data?: unknown) => log('debug', agent, message, data),
};
