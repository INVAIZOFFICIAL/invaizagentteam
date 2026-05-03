// 발행대기 → Threads 자동 발행 (매 10분 cron 진입점)
//
// 조건: 상태=발행대기 + 발행일≤now + 직전 발행과 3시간 이상 간격

import { openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import type { TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { publishTextPost, publishReplies } from '@/threads/client.js';
import {
  getPendingContents,
  updateContentPublishInfo,
  updateContentStatusAndDate,
  getLastPublishedAt,
} from '@/notion/databases/contentDb.js';

const MIN_GAP_HOURS = 3;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10_000;
const LOCK_FILE = '/tmp/nami-publish.lock';
const LOCK_STALE_MS = 30 * 60 * 1000; // 30분 이상 된 락은 stale로 간주

function acquireLock(): boolean {
  try {
    // 30분 이상 된 stale 락이면 제거 후 재시도
    try {
      const stat = statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK_FILE);
        logger.warn('nami', 'stale 락 파일 제거 후 재시도');
      } else {
        return false; // 다른 프로세스가 발행 중
      }
    } catch {
      // 파일 없으면 정상 — 계속 진행
    }
    // wx 플래그: 파일이 없을 때만 원자적으로 생성 (두 프로세스가 동시에 시도해도 하나만 성공)
    const fd = openSync(LOCK_FILE, 'wx');
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try { unlinkSync(LOCK_FILE); } catch { /* 이미 없으면 무시 */ }
}

async function attemptPublish(
  content: string,
  mediaUrls: string[],
  retries = MAX_RETRIES,
): Promise<{ id: string; permalink?: string }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await publishTextPost(content, mediaUrls);
    } catch (err) {
      lastErr = err;
      if (attempt <= retries) {
        logger.warn('nami', `발행 실패 (시도 ${attempt}/${retries + 1}) — ${RETRY_DELAY_MS / 1000}초 후 재시도`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

function buildErrorReport(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 300);
  const lines: string[] = [err.message.slice(0, 200)];
  // Threads API 응답 본문이 메시지에 포함돼 있으면 그대로 노출
  const apiMatch = err.message.match(/Threads API \d+ on [^:]+: (.+)/s);
  if (apiMatch) {
    try {
      const parsed = JSON.parse(apiMatch[1]);
      const detail = parsed?.error?.message ?? parsed?.error ?? apiMatch[1];
      lines.push(`API 오류: ${String(detail).slice(0, 150)}`);
    } catch {
      lines.push(`API 응답: ${apiMatch[1].slice(0, 150)}`);
    }
  }
  return lines.join('\n');
}

export async function publishPendingThreads(): Promise<void> {
  if (!acquireLock()) {
    logger.info('nami', '발행 락 획득 실패 — 다른 프로세스가 발행 중, 스킵');
    return;
  }

  try {
    await _publishPendingThreads();
  } finally {
    releaseLock();
  }
}

async function _publishPendingThreads(): Promise<void> {
  const pending = await getPendingContents();
  if (pending.length === 0) return;

  logger.info('nami', `발행 대기 ${pending.length}건`);

  const lastPublishedAt = await getLastPublishedAt();

  const channel = await discordClient.channels.fetch(env.DISCORD_CHANNEL_NAMI).catch(() => null);
  const textChannel = channel?.isTextBased() ? (channel as TextChannel) : null;

  for (const item of pending) {
    // 3시간 간격 체크
    if (lastPublishedAt) {
      const gapHours = (Date.now() - lastPublishedAt.getTime()) / 3_600_000;
      if (gapHours < MIN_GAP_HOURS) {
        logger.info('nami', `3시간 간격 미충족 (${gapHours.toFixed(1)}h) — 발행 홀드`);
        break;
      }
    }

    const content = item.content;
    if (!content) {
      logger.warn('nami', `콘텐츠 속성 비어있음 — 스킵: ${item.title}`);
      textChannel?.send(
        `🍊 **발행 못 했어요.** 노션 **콘텐츠** 속성이 비어있어요.\n**${item.title}**\n콘텐츠 속성에 본문을 채워주시면 다음 발행 주기에 올려드릴게요.`,
      );
      continue;
    }

    try {
      const mediaCount = item.mediaUrls.length;
      const mediaLabel = mediaCount === 0 ? '' : mediaCount === 1 ? ' (이미지 1장)' : ` (이미지 ${mediaCount}장)`;
      logger.info('nami', `발행 시작: ${item.title}${mediaLabel}`);
      const result = await attemptPublish(content, item.mediaUrls);

      const publishUrl = result.permalink ?? `https://www.threads.net/p/${result.id}`;
      await updateContentPublishInfo(item.pageId, publishUrl);

      // 셀프 댓글 발행
      if (item.replyContents.length > 0) {
        try {
          await publishReplies(result.id, item.replyContents);
          logger.info('nami', `셀프 댓글 ${item.replyContents.length}건 발행: ${item.title}`);
        } catch (replyErr) {
          logger.warn('nami', `셀프 댓글 발행 실패 (본문은 올라감): ${item.title}`, replyErr);
          textChannel?.send(
            `🍊 본문은 올라갔는데 댓글 달기가 실패했어요.\n**${item.title}**\n📎 ${publishUrl}`,
          );
        }
      }

      logger.info('nami', `발행 완료: ${item.title} → ${publishUrl}`);
      const imageNote = mediaCount === 0 ? '' : mediaCount === 1 ? ' 📸 이미지 1장' : ` 📸 이미지 ${mediaCount}장`;
      const replyNote = item.replyContents.length > 0 ? ` 💬 댓글 ${item.replyContents.length}개` : '';
      textChannel?.send(
        `🍊 **스레드에 올라갔어요!**${imageNote}${replyNote}\n**${item.title}**\n📎 ${publishUrl}`,
      );
    } catch (err) {
      logger.error('nami', `발행 실패 (재시도 ${MAX_RETRIES}회 소진): ${item.title}`, err);
      // 상태를 보관으로 변경 — 다음 cron에서 재시도하지 않음
      await updateContentStatusAndDate(item.pageId, '보관').catch(() => {});
      const report = buildErrorReport(err);
      const mediaNote = item.mediaUrls.length > 0
        ? `\n**이미지 URL:**\n\`\`\`\n${item.mediaUrls.map((u) => u.slice(0, 120)).join('\n')}\n\`\`\``
        : '';
      textChannel?.send(
        `🍊 **발행 실패했어요.** 노션에서 수정 후 다시 발행대기로 바꿔주세요.\n**${item.title}**\n\n**실패 원인:**\n\`\`\`\n${report}\n\`\`\`${mediaNote}`,
      );
      break;
    }
  }
}

