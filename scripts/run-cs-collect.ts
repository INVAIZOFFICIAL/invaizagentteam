// CS 카카오 수집 단발 실행 — 맥미니에서 cron 기다리지 않고 즉시 테스트
// 사용: npx tsx scripts/run-cs-collect.ts

import { collectKakaoCsConversations } from '@/cs/collectKakaoCs.js';

async function main() {
  console.log('CS 카카오 수집 시작...');
  const s = await collectKakaoCsConversations();
  console.log('\n=== 결과 ===');
  console.log(`감지된 CS 채팅방: ${s.detectedChats}개`);
  console.log(`upsert 완료: ${s.upsertedRooms}명 (신규 ${s.createdRooms}, 갱신 ${s.upsertedRooms - s.createdRooms})`);
  console.log(`총 메시지: ${s.totalMessages}건`);
  console.log(`실패: ${s.failedRooms}건`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
