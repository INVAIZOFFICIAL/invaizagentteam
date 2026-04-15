import type { Message, TextChannel } from 'discord.js';
import { runClaude } from '@/claude/client.js';
import { AgentMemory } from './AgentMemory.js';
import { splitMessage } from '@/discord/formatters/messageFormatter.js';
import { logger } from '@/utils/logger.js';
import type { AgentName, AgentPersonality, TaskResult, ParsedTask } from '@/types/agent.types.js';

export abstract class BaseAgent {
  abstract readonly name: AgentName;
  abstract readonly displayName: string;
  abstract readonly personality: AgentPersonality;

  protected memory: AgentMemory;

  constructor() {
    this.memory = new AgentMemory();
  }

  // 메시지를 받아 태스크로 파싱
  protected abstract parseTask(content: string): Promise<ParsedTask>;

  // 태스크 실행
  protected abstract executeTask(task: ParsedTask, message: Message): Promise<TaskResult>;

  // 메인 메시지 핸들러
  async handleMessage(message: Message): Promise<void> {
    const channel = message.channel as TextChannel;

    // 장시간 작업 시작 알림 (캐릭터 말투)
    const thinkingMsg = await channel.send(await this.getThinkingMessage());

    try {
      this.memory.add('user', message.content);
      const task = await this.parseTask(message.content);
      const result = await this.executeTask(task, message);

      const responseText = result.success
        ? `${result.summary}${result.notionPageUrl ? `\n\n📝 노션에 저장했어: ${result.notionPageUrl}` : ''}`
        : `${this.personality.catchphrase}... 이런, 문제가 생겼어.\n${result.error}`;

      this.memory.add('assistant', responseText);
      await thinkingMsg.delete().catch(() => null);
      await this.replyToDiscord(channel, responseText);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(this.name, '메시지 처리 실패', errMsg);
      await thinkingMsg.delete().catch(() => null);
      await channel.send(`문제가 생겼어! 에러: ${errMsg}`);
    }
  }

  // 분할 전송 처리
  protected async replyToDiscord(channel: TextChannel, text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  // Claude CLI를 통한 작업 실행
  protected async askClaude(prompt: string, options?: { timeoutMs?: number }): Promise<string> {
    const context = this.memory.getContextString();
    const fullPrompt = context
      ? `이전 대화:\n${context}\n\n---\n\n${prompt}`
      : prompt;

    return runClaude(fullPrompt, this.name, {
      systemPrompt: this.personality.systemPrompt,
      ...options,
    });
  }

  // 캐릭터별 "생각 중" 메시지
  private async getThinkingMessage(): Promise<string> {
    const messages: Record<AgentName, string> = {
      luffy:   '오케이! 지금 생각 중이야!',
      nami:    '잠깐, 숫자 좀 확인해볼게...',
      zoro:    '...확인 중.',
      usopp:   '오... 분석 중이야! 잠깐만!',
      sanji:   '정보 요리하는 중이야, 잠시만~',
      chopper: '으... 분석하는 중이야! 기다려!',
    };
    return messages[this.name];
  }
}
