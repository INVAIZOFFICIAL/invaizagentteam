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
