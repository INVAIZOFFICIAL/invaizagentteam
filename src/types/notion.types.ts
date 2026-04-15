export interface NotionPage {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
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
