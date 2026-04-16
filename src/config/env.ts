import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// .env.local 파일을 직접 파싱 (dotenv 대신 경량 방식)
function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  }
}

loadEnvFile();

const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN이 필요합니다'),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_CHANNEL_GENERAL: z.string().min(1),
  DISCORD_CHANNEL_LUFFY: z.string().min(1),
  DISCORD_CHANNEL_NAMI: z.string().min(1),
  DISCORD_CHANNEL_ZORO: z.string().min(1),
  DISCORD_CHANNEL_USOPP: z.string().min(1),
  DISCORD_CHANNEL_SANJI: z.string().min(1),
  DISCORD_CHANNEL_CHOPPER: z.string().min(1),
  DISCORD_CHANNEL_ERROR: z.string().min(1),

  // Notion (세팅 전까지 optional)
  NOTION_TOKEN: z.string().optional(),
  NOTION_PARENT_PAGE_ID: z.string().optional(),
  NOTION_CONTENT_DB_ID: z.string().optional(),
  NOTION_PERFORMANCE_DB_ID: z.string().optional(),
  NOTION_COMMENT_DB_ID: z.string().optional(),
  NOTION_KNOWLEDGE_DB_ID: z.string().optional(),
  NOTION_SYSTEM_META_DB_ID: z.string().optional(),
  NOTION_LEAD_DB_ID: z.string().optional(),
  NOTION_RESEARCH_DB_ID: z.string().optional(),
  NOTION_DOM_SPEC_DB_ID: z.string().optional(),
  NOTION_APPLICANT_DB_ID: z.string().optional(),

  // Threads
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  THREADS_ACCESS_TOKEN: z.string().optional(),
  THREADS_USER_ID: z.string().optional(),

  // SendGrid
  SENDGRID_API_KEY: z.string().optional(),

  // 운영 환경
  NODE_ENV: z.enum(['development', 'production']).default('development'),

  // 로그 디렉토리 (미지정 시 logger 에서 cwd/logs 사용)
  LUFFY_LOG_DIR: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('환경변수 검증 실패:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
