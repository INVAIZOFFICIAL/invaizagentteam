// 에이전트 멀티턴 컨텍스트 관리 — 최근 20턴 유지
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class AgentMemory {
  private history: ConversationTurn[] = [];
  private readonly maxTurns: number;

  constructor(maxTurns = 20) {
    this.maxTurns = maxTurns;
  }

  add(role: 'user' | 'assistant', content: string): void {
    this.history.push({ role, content, timestamp: new Date() });
    // 최대 턴 수 초과 시 가장 오래된 것부터 제거 (2개씩 제거 — user+assistant 쌍)
    if (this.history.length > this.maxTurns * 2) {
      this.history.splice(0, 2);
    }
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  getContextString(): string {
    return this.history
      .slice(-10) // 최근 10턴만 컨텍스트로 전달
      .map(t => `${t.role === 'user' ? '직원' : '나'}: ${t.content}`)
      .join('\n');
  }

  clear(): void {
    this.history = [];
  }
}
