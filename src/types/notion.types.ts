export interface NotionPage {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
}

// Notion SDK page 응답 중 "properties 를 읽고 쓰기 위한 최소 shape".
// @notionhq/client 의 PageObjectResponse 는 discriminated union 이라
// 한국어 프로퍼티 키 접근 시 타입이 과도하게 좁아져 실용적이지 않다.
// 여기서 any 를 한 번만 허용하고, 호출부의 `as any` 캐스트를 전부 제거한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type NotionPropertyBag = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface NotionPageLike {
  id: string;
  url?: string;
  properties?: NotionPropertyBag;
}

export interface ContentRecord {
  title: string;
  type: 'threads' | 'blog';
  status: 'draft' | 'review' | 'approved' | 'published';
  body: string;
  keywords?: string[];
  publishedAt?: Date;
  notionPageId?: string;
}

export interface PerformanceRecord {
  contentId: string;
  platform: 'threads' | 'blog';
  likes: number;
  comments: number;
  reposts: number;
  views: number;
  recordedAt: Date;
}

export interface ReferenceRecord {
  source: 'qoo10' | 'threads' | 'news' | 'other';
  url: string;
  title: string;
  summary: string;
  performanceScore?: number;
  collectedAt: Date;
}
