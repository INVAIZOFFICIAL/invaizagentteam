// API 호출 레이트 리미터 — 토큰 버킷 방식
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRatePerSecond: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens < 1) {
      // 토큰이 생길 때까지 대기
      const waitMs = (1 / this.refillRatePerSecond) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.refill();
    }

    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerSecond);
    this.lastRefill = now;
  }
}

// 에이전트별 레이트 리미터 (Discord: 초당 5건, Notion: 초당 3건)
export const discordLimiter = new RateLimiter(5, 5);
export const notionLimiter = new RateLimiter(3, 3);
