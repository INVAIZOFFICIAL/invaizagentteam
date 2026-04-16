/**
 * fetchThreadsCommentsOnce() 1회 실행 — 수동 검증용
 *
 * 단계:
 *   1. Threads API 접근 테스트 (최근 글 5개 조회)
 *   2. 시스템 메타 DB "threads_comments_fetch" row 상태 확인
 *   3. 메인 파이프라인 1회 실행 (증분 수집)
 *   4. 실행 후 상태 확인
 *
 * 사용: ./node_modules/.bin/tsx scripts/run-fetch-comments.ts
 */

import { fetchThreadsCommentsOnce } from '@/cron/jobs/fetchThreadsComments.js';
import { getJobState } from '@/notion/databases/systemMetaDb.js';
import { fetchMyRecentThreads } from '@/threads/client.js';

const JOB_NAME = 'threads_comments_fetch';

async function main(): Promise<void> {
  console.log('━━━━━━━━━━ 사전 점검 ━━━━━━━━━━\n');

  // 1. Threads API 연결
  console.log('1️⃣  Threads API 연결 테스트...');
  try {
    const posts = await fetchMyRecentThreads(undefined, 5);
    console.log(`   ✓ 접근 성공 — 내 최근 글 ${posts.length}개 반환`);
    if (posts.length > 0) {
      console.log('');
      for (const p of posts.slice(0, 5)) {
        const preview = (p.text ?? '(본문 없음)').replace(/\n/g, ' ').slice(0, 50);
        console.log(`     • [${p.id}] ${preview}${(p.text?.length ?? 0) > 50 ? '…' : ''}`);
        console.log(`       시각: ${p.timestamp ?? '(없음)'} | 타입: ${p.media_type ?? '?'}`);
        if (p.permalink) console.log(`       permalink: ${p.permalink}`);
      }
    } else {
      console.log('   (계정에 글이 없거나 최근 기간에 글이 없음)');
    }
  } catch (err) {
    console.error(`   ❌ Threads API 실패: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error('   확인 사항:');
    console.error('   - THREADS_ACCESS_TOKEN 유효한가? (.env.local)');
    console.error('   - 토큰 권한에 threads_basic, threads_read_replies 포함됐나?');
    console.error('   - 토큰 만료 안 됐나? (.env.local 주석 참고)');
    process.exit(1);
  }
  console.log('');

  // 2. 시스템 메타 DB row 확인
  console.log(`2️⃣  시스템 메타 DB "${JOB_NAME}" 상태 조회...`);
  const before = await getJobState(JOB_NAME);
  if (!before) {
    console.error(`   ❌ row 없음 — 시스템 메타 DB 에 "${JOB_NAME}" row 를 먼저 만들어야 합니다.`);
    process.exit(1);
  }
  console.log(`   ✓ pageId=${before.pageId.slice(0, 8)}...`);
  console.log(`     활성화: ${before.isActive ? '✅' : '❌'}`);
  console.log(
    `     마지막실행: ${before.lastRunAt ? before.lastRunAt.toISOString() : '(없음 — 첫 실행)'}`,
  );
  console.log(`     누적처리: ${before.totalCount}`);
  console.log('');

  // 3. 메인 파이프라인 실행
  console.log('━━━━━━━━━━ 파이프라인 실행 ━━━━━━━━━━\n');
  await fetchThreadsCommentsOnce();
  console.log('');

  // 4. 실행 후 상태 재조회
  console.log('━━━━━━━━━━ 실행 후 상태 ━━━━━━━━━━\n');
  const after = await getJobState(JOB_NAME);
  if (after) {
    console.log(
      `   마지막실행: ${after.lastRunAt ? after.lastRunAt.toISOString() : '(없음)'}`,
    );
    console.log(`   누적처리: ${before.totalCount} → ${after.totalCount}`);
  }
  console.log('');
  console.log('✅ 검증 완료');
}

main().catch((err: unknown) => {
  console.error('\n❌ 예외:');
  console.error(err);
  process.exit(1);
});
