// Threads 세션 최초 설정 스크립트
// 실행: npm run setup:threads
//
// 브라우저가 열리면 Threads에 로그인하고 Enter를 누르세요.
// 이후 모든 cron 작업이 이 세션을 자동 재사용합니다.

import { chromium } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const PLAYWRIGHT_PROFILE_DIR = path.resolve(os.homedir(), '.threads-playwright');
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n로그인 완료 후 Enter를 누르세요...', () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log('=== Threads 세션 설정 ===');
  console.log(`프로필 저장 경로: ${PLAYWRIGHT_PROFILE_DIR}`);
  console.log('브라우저가 열립니다. Threads에 로그인하세요.\n');

  const context = await chromium.launchPersistentContext(PLAYWRIGHT_PROFILE_DIR, {
    headless: false,
    userAgent: CHROME_UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });

  const page = await context.newPage();
  await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await waitForEnter();

  // 로그인 확인
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    console.error('로그인이 완료되지 않았습니다. 다시 시도하세요.');
    await context.close();
    process.exit(1);
  }

  await context.close();
  console.log('\n세션 저장 완료!');
  console.log('이제 npm run dev 로 에이전트를 시작하면 Threads 수집이 자동 작동합니다.');
}

main().catch((err) => {
  console.error('오류:', err);
  process.exit(1);
});
