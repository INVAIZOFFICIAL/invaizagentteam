/**
 * Threads API (Meta Graph API) 경량 래퍼
 *
 * 사용 엔드포인트:
 *   GET /v1.0/me/threads             내 스레드 글 목록 (since 파라미터로 필터)
 *   GET /v1.0/{thread-id}/replies    글에 달린 댓글 목록
 *
 * 인증: env.THREADS_ACCESS_TOKEN (60일 장기 토큰, 만료일은 .env.local 주석 참고)
 *       토큰 만료 시 Meta 개발자 콘솔에서 재발급 후 갱신.
 */

import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

const API_BASE = 'https://graph.threads.net/v1.0';

export interface ThreadsPost {
  id: string;
  media_type?: string;
  text?: string;
  permalink?: string;
  timestamp?: string; // ISO 8601
}

export interface ThreadsReply {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string; // ISO 8601
  root_post?: { id: string };
  replied_to?: { id: string };
  hide_status?: string;
  media_type?: string;
}

async function threadsGet<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const token = env.THREADS_ACCESS_TOKEN;
  if (!token) {
    throw new Error('THREADS_ACCESS_TOKEN 이 설정되지 않았습니다.');
  }

  const url = new URL(API_BASE + path);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads API ${res.status} on ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * 내 계정의 스레드 글 목록 조회
 * @param since 이 시각 이후 작성된 글만 (Unix timestamp 초 단위)
 * @param limit 페이지 크기 (기본 25, 최대 ~100)
 */
export async function fetchMyRecentThreads(
  since?: Date,
  limit = 50,
): Promise<ThreadsPost[]> {
  const params: Record<string, string | number> = {
    fields: 'id,media_type,text,permalink,timestamp',
    limit,
  };
  if (since) {
    params.since = Math.floor(since.getTime() / 1000);
  }

  try {
    const res = await threadsGet<{ data: ThreadsPost[] }>('/me/threads', params);
    return res.data ?? [];
  } catch (err) {
    logger.error('threads', '내 글 목록 조회 실패', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────
// Insights (성과 지표)
// ─────────────────────────────────────────────────────────

export interface ThreadsInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

/**
 * 특정 스레드 글의 성과 지표 조회
 * @param mediaId Threads API 내부 ID
 * @returns 현재 시점의 누적 지표 (lifetime)
 *
 * 필요 권한: threads_manage_insights
 */
export async function fetchPostInsights(mediaId: string): Promise<ThreadsInsights> {
  try {
    const res = await threadsGet<{
      data: Array<{ name: string; values: Array<{ value: number }> }>;
    }>(`/${mediaId}/insights`, {
      metric: 'views,likes,replies,reposts,quotes',
    });

    const metrics: Record<string, number> = {};
    for (const item of res.data ?? []) {
      metrics[item.name] = item.values?.[0]?.value ?? 0;
    }

    return {
      views: metrics['views'] ?? 0,
      likes: metrics['likes'] ?? 0,
      replies: metrics['replies'] ?? 0,
      reposts: metrics['reposts'] ?? 0,
      quotes: metrics['quotes'] ?? 0,
    };
  } catch (err) {
    logger.error('threads', `인사이트 조회 실패 (mediaId=${mediaId})`, err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────
// Replies (댓글)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Publishing (발행)
// ─────────────────────────────────────────────────────────

async function threadsPost<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error('THREADS_ACCESS_TOKEN이 설정되지 않았습니다.');

  const url = new URL(API_BASE + path);
  const body = new URLSearchParams({ access_token: token, ...params });

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Threads API POST ${res.status} on ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

function inferMediaType(url: string): 'IMAGE' | 'VIDEO' {
  return /\.(mp4|mov|avi|webm)(\?|$)/i.test(url) ? 'VIDEO' : 'IMAGE';
}

// 미디어 URL 접근 가능 여부 사전 확인 (HEAD가 막힌 S3 대비 GET Range 사용)
async function validateMediaUrl(url: string): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`미디어 URL 접근 실패 (HTTP ${res.status}): ${url.slice(0, 120)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('미디어 URL')) throw err;
    throw new Error(`미디어 URL에 연결할 수 없어요: ${url.slice(0, 120)}`);
  }
}

async function waitForContainer(creationId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const timeoutLabel = `${Math.round(timeoutMs / 1000)}s`;
  while (Date.now() < deadline) {
    const res = await threadsGet<{ status: string; error_message?: string }>(
      `/${creationId}`,
      { fields: 'status,error_message' },
    );
    if (res.status === 'FINISHED') return;
    if (res.status === 'ERROR') throw new Error(`미디어 컨테이너 오류: ${res.error_message ?? 'unknown'}`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`미디어 컨테이너 준비 타임아웃 (${timeoutLabel})`);
}

/**
 * 단일 미디어 컨테이너 생성
 * is_carousel_item=true 이면 캐러셀 아이템용
 */
async function createSingleMediaContainer(
  userId: string,
  mediaUrl: string,
  isCarouselItem = false,
): Promise<string> {
  const mediaType = inferMediaType(mediaUrl);
  const params: Record<string, string> = { media_type: mediaType };
  if (mediaType === 'IMAGE') params['image_url'] = mediaUrl;
  else params['video_url'] = mediaUrl;
  if (isCarouselItem) params['is_carousel_item'] = 'true';

  const res = await threadsPost<{ id: string }>(`/${userId}/threads`, params);
  // 동영상은 인코딩 시간이 필요 — 더 긴 타임아웃 적용
  const timeout = mediaType === 'VIDEO' ? 180_000 : 30_000;
  await waitForContainer(res.id, timeout);
  return res.id;
}

/**
 * 미디어 컨테이너 생성 (발행 1단계)
 * - mediaUrls 없으면 TEXT
 * - 1장이면 단일 IMAGE/VIDEO
 * - 2장 이상이면 CAROUSEL (최대 10장)
 */
export async function createMediaContainer(text: string, mediaUrls: string[] = []): Promise<string> {
  const userId = env.THREADS_USER_ID;
  if (!userId) throw new Error('THREADS_USER_ID가 설정되지 않았습니다.');

  // 이미지 URL 사전 검증 — Notion 내부 URL 또는 접근 불가 URL 조기 차단
  for (const url of mediaUrls) {
    await validateMediaUrl(url);
  }

  if (mediaUrls.length === 0) {
    const res = await threadsPost<{ id: string }>(`/${userId}/threads`, {
      media_type: 'TEXT',
      text,
    });
    return res.id;
  }

  if (mediaUrls.length === 1) {
    const mediaType = inferMediaType(mediaUrls[0]);
    const params: Record<string, string> = { media_type: mediaType, text };
    if (mediaType === 'IMAGE') params['image_url'] = mediaUrls[0];
    else params['video_url'] = mediaUrls[0];
    const res = await threadsPost<{ id: string }>(`/${userId}/threads`, params);
    // 동영상은 Threads 서버 인코딩에 최대 수 분 소요 — 이미지보다 긴 타임아웃 적용
    const timeout = mediaType === 'VIDEO' ? 180_000 : 30_000;
    await waitForContainer(res.id, timeout);
    return res.id;
  }

  // 동영상이 하나라도 포함되면 캐러셀 불가 — 첫 번째 미디어만 단일 발행
  // (Threads API는 VIDEO 캐러셀 아이템을 지원하지 않음)
  const hasVideo = mediaUrls.some((u) => inferMediaType(u) === 'VIDEO');
  if (hasVideo) {
    const url = mediaUrls[0];
    const mediaType = inferMediaType(url);
    const params: Record<string, string> = { media_type: mediaType, text };
    if (mediaType === 'IMAGE') params['image_url'] = url;
    else params['video_url'] = url;
    logger.warn('threads', `동영상 포함 — 캐러셀 불가, 첫 번째 미디어만 발행 (전체 ${mediaUrls.length}개 중 1개)`);
    const res = await threadsPost<{ id: string }>(`/${userId}/threads`, params);
    await waitForContainer(res.id, 180_000);
    return res.id;
  }

  // 이미지만 있을 때 캐러셀 (최대 10장)
  const capped = mediaUrls.slice(0, 10);
  const itemIds: string[] = [];
  for (const url of capped) {
    const id = await createSingleMediaContainer(userId, url, true);
    itemIds.push(id);
  }

  const res = await threadsPost<{ id: string }>(`/${userId}/threads`, {
    media_type: 'CAROUSEL',
    children: itemIds.join(','),
    text,
  });
  await waitForContainer(res.id);
  return res.id;
}

/**
 * 컨테이너 발행 (발행 2단계)
 * @returns 발행된 Threads 글 ID
 */
export async function publishContainer(containerId: string): Promise<string> {
  const userId = env.THREADS_USER_ID;
  if (!userId) throw new Error('THREADS_USER_ID가 설정되지 않았습니다.');

  const res = await threadsPost<{ id: string }>(`/${userId}/threads_publish`, {
    creation_id: containerId,
  });
  return res.id;
}

/**
 * 포스트 1건 발행 (컨테이너 생성 → 발행 → permalink 조회)
 * mediaUrls 1장 = 단일 이미지, 2장 이상 = 캐러셀
 */
export async function publishTextPost(text: string, mediaUrls: string[] = []): Promise<{ id: string; permalink?: string }> {
  const label = mediaUrls.length === 0
    ? '텍스트'
    : mediaUrls.length === 1
    ? `미디어(${inferMediaType(mediaUrls[0])})`
    : `캐러셀(${mediaUrls.length}장)`;
  logger.info('threads', `${label} 발행 시작 (${text.length}자)`);

  const containerId = await createMediaContainer(text, mediaUrls);
  const postId = await publishContainer(containerId);
  logger.info('threads', `발행 완료: postId=${postId}`);

  try {
    const recent = await fetchMyRecentThreads(new Date(Date.now() - 120_000), 5);
    const match = recent.find((p) => p.id === postId);
    return { id: postId, permalink: match?.permalink };
  } catch {
    return { id: postId };
  }
}

/**
 * 본문 발행 후 셀프 댓글 순서대로 달기
 * @param postId 본문 Threads 글 ID
 * @param replies 댓글 텍스트 배열 (순서 유지)
 */
export async function publishReplies(postId: string, replies: string[]): Promise<void> {
  const userId = env.THREADS_USER_ID;
  if (!userId) throw new Error('THREADS_USER_ID가 설정되지 않았습니다.');

  // 체인 구조: 첫 댓글은 본문에, 이후 댓글은 바로 앞 댓글에 달아 스레드 연결
  let replyToId = postId;
  for (const text of replies) {
    const res = await threadsPost<{ id: string }>(`/${userId}/threads`, {
      media_type: 'TEXT',
      text,
      reply_to_id: replyToId,
    });
    // reply_to_id 포함 컨테이너는 Meta 서버 처리 시간이 필요 — FINISHED 상태 확인 후 발행
    await waitForContainer(res.id);
    const publishedId = await publishContainer(res.id);
    // 다음 댓글은 방금 발행한 댓글에 연결
    replyToId = publishedId;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  logger.info('threads', `셀프 댓글 ${replies.length}건 발행 완료 (postId=${postId})`);
}

/**
 * 특정 스레드 글에 달린 댓글(답글) 목록 조회
 * @param threadId 대상 글 ID (Threads API 내부 ID)
 * @param limit 페이지 크기
 */
export async function fetchReplies(
  threadId: string,
  limit = 100,
): Promise<ThreadsReply[]> {
  const params: Record<string, string | number> = {
    fields:
      'id,text,username,timestamp,root_post,replied_to,hide_status,media_type',
    limit,
  };

  try {
    const res = await threadsGet<{ data: ThreadsReply[] }>(
      `/${threadId}/replies`,
      params,
    );
    return res.data ?? [];
  } catch (err) {
    logger.error('threads', `댓글 조회 실패 (threadId=${threadId})`, err);
    throw err;
  }
}
