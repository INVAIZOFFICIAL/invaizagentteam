#!/usr/bin/env tsx
// Discord, Notion, Claude 연결 상태 일괄 점검
import { env } from '../src/config/env.js';
import { notionClient } from '../src/notion/client.js';
import { runClaude } from '../src/claude/client.js';
import { Client, GatewayIntentBits } from 'discord.js';

const args = process.argv.slice(2);
const testDiscord = args.includes('--discord') || args.length === 0;
const testNotion = args.includes('--notion') || args.length === 0;
const testClaude = args.includes('--claude') || args.length === 0;

async function testDiscordConnection(): Promise<void> {
  console.log('\n🔍 Discord 연결 테스트...');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.DISCORD_TOKEN);
  console.log(`✅ Discord 연결 성공: ${client.user?.tag}`);
  await client.destroy();
}

async function testNotionConnection(): Promise<void> {
  console.log('\n🔍 Notion 연결 테스트...');
  const response = await notionClient.databases.retrieve({
    database_id: env.NOTION_CONTENT_DB_ID,
  });
  console.log(`✅ Notion 연결 성공: DB "${(response as { title?: Array<{ plain_text: string }> }).title?.[0]?.plain_text ?? response.id}"`);
}

async function testClaudeConnection(): Promise<void> {
  console.log('\n🔍 Claude CLI 연결 테스트...');
  const response = await runClaude('안녕! 한 줄로 대답해줘.', 'test', { timeoutMs: 30_000 });
  console.log(`✅ Claude 연결 성공: ${response.slice(0, 80)}...`);
}

async function main(): Promise<void> {
  console.log('=== 루피 사단 연결 점검 ===');

  try {
    if (testDiscord) await testDiscordConnection();
  } catch (e) {
    console.error('❌ Discord 실패:', e instanceof Error ? e.message : e);
  }

  try {
    if (testNotion) await testNotionConnection();
  } catch (e) {
    console.error('❌ Notion 실패:', e instanceof Error ? e.message : e);
  }

  try {
    if (testClaude) await testClaudeConnection();
  } catch (e) {
    console.error('❌ Claude 실패:', e instanceof Error ? e.message : e);
  }

  console.log('\n=== 점검 완료 ===');
  process.exit(0);
}

main();
