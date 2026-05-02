// Threads 액세스 토큰 재발급 스크립트
// 실행: npx tsx scripts/refresh-threads-token.ts
//
// 브라우저에서 wanju_builds 계정으로 앱 권한 승인 후
// 리다이렉트된 URL에서 code 값을 붙여넣으면 자동으로 토큰을 갱신합니다.

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key) result[key.trim()] = rest.join('=').trim();
  }
  return result;
}

function updateEnvFile(updates: Record<string, string>): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(envPath, content);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  const appId = env['THREADS_APP_ID'];
  const appSecret = env['THREADS_APP_SECRET'];

  if (!appId || !appSecret) {
    console.error('❌ .env.local에 THREADS_APP_ID와 THREADS_APP_SECRET이 없습니다.');
    process.exit(1);
  }

  // 필요한 모든 권한 스코프
  const scopes = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_insights',
    'threads_manage_replies',
    'threads_read_replies',
  ].join(',');

  // 리다이렉트 URI — Meta 개발자 콘솔에 등록된 것과 동일해야 함
  const redirectUri = 'https://localhost/callback';

  const authUrl =
    `https://threads.net/oauth/authorize` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_type=code`;

  console.log('\n=== Threads 토큰 재발급 ===\n');
  console.log('1️⃣  아래 URL을 브라우저에서 열고 wanju_builds 계정으로 로그인 후 앱 권한을 승인하세요:\n');
  console.log(authUrl);
  console.log('\n2️⃣  승인 후 "localhost로 연결할 수 없음" 페이지가 뜨는데 — 주소창 URL 전체를 복사해주세요.');
  console.log('   (예시: https://localhost/callback?code=XXXXXXXXXXXXXXX#_)\n');

  const redirectedUrl = await ask('3️⃣  복사한 URL을 여기에 붙여넣기: ');

  const codeMatch = redirectedUrl.match(/[?&]code=([^&#]+)/);
  if (!codeMatch) {
    console.error('❌ URL에서 code를 찾을 수 없습니다. URL 전체를 붙여넣었는지 확인하세요.');
    process.exit(1);
  }
  const code = codeMatch[1];
  console.log(`\n✅ code 추출 완료: ${code.slice(0, 20)}...`);

  // 단기 토큰 발급
  console.log('\n단기 토큰 발급 중...');
  const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  const tokenData = await tokenRes.json() as Record<string, unknown>;
  if (!tokenRes.ok || !tokenData['access_token']) {
    console.error('❌ 단기 토큰 발급 실패:', JSON.stringify(tokenData, null, 2));
    process.exit(1);
  }
  const shortToken = tokenData['access_token'] as string;
  const userId = String(tokenData['user_id'] ?? '');
  console.log(`✅ 단기 토큰 발급 완료 (user_id: ${userId})`);

  // 장기 토큰(60일) 발급
  console.log('장기 토큰(60일) 발급 중...');
  const longRes = await fetch(
    `https://graph.threads.net/access_token` +
    `?grant_type=th_exchange_token` +
    `&client_secret=${appSecret}` +
    `&access_token=${shortToken}`,
  );
  const longData = await longRes.json() as Record<string, unknown>;
  if (!longRes.ok || !longData['access_token']) {
    console.error('❌ 장기 토큰 발급 실패:', JSON.stringify(longData, null, 2));
    process.exit(1);
  }
  const longToken = longData['access_token'] as string;
  const expiresIn = Number(longData['expires_in'] ?? 0);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toLocaleDateString('ko-KR');
  console.log(`✅ 장기 토큰 발급 완료 (만료일: ${expiresAt})`);

  // .env.local 자동 업데이트
  updateEnvFile({
    THREADS_ACCESS_TOKEN: longToken,
    ...(userId ? { THREADS_USER_ID: userId } : {}),
  });

  console.log('\n🎉 .env.local 업데이트 완료!');
  console.log('서버를 재시작하면 새 토큰이 적용됩니다.');
  console.log(`토큰 만료일: ${expiresAt} (약 60일)`);
}

main().catch((err) => {
  console.error('오류:', err);
  process.exit(1);
});
