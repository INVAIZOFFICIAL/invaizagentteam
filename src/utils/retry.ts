import { logger } from './logger.js';

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoffMultiplier = 2 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const waitMs = delayMs * Math.pow(backoffMultiplier, attempt - 1);
        logger.warn(context, `시도 ${attempt}/${maxAttempts} 실패, ${waitMs}ms 후 재시도`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError;
}
