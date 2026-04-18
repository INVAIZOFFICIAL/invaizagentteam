import { spawn } from 'child_process';
import { logger } from '@/utils/logger.js';

interface ClaudeOptions {
  systemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

// Claude Code CLI를 spawn하여 실행 (Max 구독 활용)
// API 키 없이 claude CLI를 통해 작업 수행
export async function runClaude(
  prompt: string,
  agentName: string,
  options: ClaudeOptions = {}
): Promise<string> {
  const { systemPrompt, maxTurns = 10, timeoutMs = 120_000 } = options;

  // 인격 프롬프트를 포함한 최종 프롬프트 구성
  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${prompt}`
    : prompt;

  return new Promise((resolve, reject) => {
    const args = [
      '--print',           // 결과를 stdout으로 출력
      '--output-format', 'text',
      '--max-turns', String(maxTurns),
      fullPrompt,
    ];

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    // 타임아웃 처리
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude 실행 타임아웃 (${timeoutMs}ms)`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        logger.debug(agentName, 'Claude 실행 완료', { outputLength: output.length });
        resolve(output.trim());
      } else {
        logger.error(agentName, 'Claude 실행 실패', { code, output: output.slice(0, 300), errorOutput });
        reject(new Error(`Claude 프로세스 종료 코드: ${code}\n${output.slice(0, 300)}\n${errorOutput}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Claude CLI 실행 오류: ${err.message}\nclaude CLI가 PATH에 있는지 확인하세요.`));
    });
  });
}
