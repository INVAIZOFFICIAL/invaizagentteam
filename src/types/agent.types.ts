export type AgentName = 'luffy' | 'nami' | 'zoro' | 'usopp' | 'sanji' | 'chopper';

export interface AgentPersonality {
  systemPrompt: string;
  catchphrase: string;
  decisionCriteria: string[];
  expertise: string[];
  // 자신의 전문 영역이 아닐 때 리다이렉트할 메시지
  redirectMessage: (targetAgent: AgentName) => string;
}

export interface TaskResult {
  success: boolean;
  agentName: AgentName;
  taskType: string;
  summary: string;
  notionPageUrl?: string;
  error?: string;
  executedAt: Date;
  // true면 executeTask 내부에서 Discord 응답 완료 → handleMessage 중복 전송 생략
  alreadyReplied?: boolean;
}

export interface ContentDraft {
  id: string;
  type: 'threads' | 'blog';
  title: string;
  body: string;
  keywords?: string[];
  status: 'draft' | 'review' | 'approved' | 'published';
  createdAt: Date;
  notionPageId?: string;
}

export interface ParsedTask {
  agentName: AgentName;
  action: string;
  params: Record<string, string>;
  rawMessage: string;
}
