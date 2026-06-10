import {
  UsageType,
  UsageRecord,
  UsageQueryRequest,
  UsageSummary,
  UserFeedback,
  Session,
  LowScoreAnswerExport,
  StorageAdapter,
} from '../types';
import { generateId, formatDateKey } from '../utils';

const ALL_USAGE_TYPES: UsageType[] = [
  'document_upload',
  'question_rewrite',
  'similar_question',
  'answer_generate',
  'feedback_submit',
  'faq_recommend',
  'retrieval',
  'llm_call',
];

export type DimensionKey = 'type' | 'tenantId' | 'userId' | 'sessionId' | 'date' | 'success';

export class UsageTracker {
  private records: UsageRecord[] = [];
  private storage?: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage = storage;
  }

  record(
    type: UsageType,
    options: {
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      tokens?: number;
      duration?: number;
      success?: boolean;
    } = {}
  ): UsageRecord {
    const record: UsageRecord = {
      id: generateId('usage'),
      type,
      tenantId: options.tenantId,
      userId: options.userId,
      sessionId: options.sessionId,
      timestamp: Date.now(),
      metadata: options.metadata,
      tokens: options.tokens,
      duration: options.duration,
      success: options.success !== undefined ? options.success : true,
    };

    this.records.push(record);
    this.save();
    return record;
  }

  query(request: UsageQueryRequest = {}): UsageRecord[] {
    const { tenantId, userId, sessionId, startDate, endDate, type, success } = request;

    return this.records.filter(record => {
      if (tenantId && record.tenantId !== tenantId) {
        return false;
      }

      if (userId && record.userId !== userId) {
        return false;
      }

      if (sessionId && record.sessionId !== sessionId) {
        return false;
      }

      if (type && record.type !== type) {
        return false;
      }

      if (success !== undefined && record.success !== success) {
        return false;
      }

      if (startDate && record.timestamp < startDate) {
        return false;
      }

      if (endDate && record.timestamp > endDate) {
        return false;
      }

      return true;
    }).sort((a, b) => b.timestamp - a.timestamp);
  }

  getSummary(request: UsageQueryRequest = {}): UsageSummary {
    const records = this.query(request);

    const byType: Record<UsageType, number> = {} as Record<UsageType, number>;
    for (const t of ALL_USAGE_TYPES) {
      byType[t] = 0;
    }

    const byDate: Record<string, number> = {};
    const byTenant: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const bySession: Record<string, number> = {};
    let earliest = Infinity;
    let latest = 0;
    let successCount = 0;
    let totalTokens = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const record of records) {
      byType[record.type] = (byType[record.type] || 0) + 1;

      const dateKey = formatDateKey(record.timestamp);
      byDate[dateKey] = (byDate[dateKey] || 0) + 1;

      if (record.tenantId) {
        byTenant[record.tenantId] = (byTenant[record.tenantId] || 0) + 1;
      }

      if (record.userId) {
        byUser[record.userId] = (byUser[record.userId] || 0) + 1;
      }

      if (record.sessionId) {
        bySession[record.sessionId] = (bySession[record.sessionId] || 0) + 1;
      }

      if (record.success) {
        successCount++;
      }

      if (record.tokens) {
        totalTokens += record.tokens;
      }

      if (typeof record.duration === 'number') {
        totalDuration += record.duration;
        durationCount++;
      }

      if (record.timestamp < earliest) {
        earliest = record.timestamp;
      }
      if (record.timestamp > latest) {
        latest = record.timestamp;
      }
    }

    return {
      total: records.length,
      successCount,
      byType,
      byDate,
      byTenant,
      byUser,
      bySession,
      totalTokens,
      averageDuration: durationCount > 0 ? totalDuration / durationCount : 0,
      startDate: request.startDate || (earliest === Infinity ? Date.now() : earliest),
      endDate: request.endDate || (latest === 0 ? Date.now() : latest),
    };
  }

  getLowScoreFeedbacks(
    feedbacks: UserFeedback[],
    getSession: (sessionId: string) => Session | undefined,
    options: {
      tenantId?: string;
      userId?: string;
      startDate?: number;
      endDate?: number;
      threshold?: number;
    } = {}
  ): LowScoreAnswerExport[] {
    const { tenantId, userId, startDate, endDate, threshold = 3 } = options;

    return feedbacks
      .filter(feedback => {
        if (feedback.rating >= threshold) {
          return false;
        }

        if (tenantId && feedback.tenantId !== tenantId) {
          return false;
        }

        if (userId && feedback.userId !== userId) {
          return false;
        }

        if (startDate && feedback.createdAt < startDate) {
          return false;
        }

        if (endDate && feedback.createdAt > endDate) {
          return false;
        }

        return true;
      })
      .map(feedback => {
        const session = getSession(feedback.sessionId);
        let question = '';
        let answer = '';
        const citations: string[] = feedback.citations || [];

        if (session) {
          const messages = session.messages;
          for (let i = 0; i < messages.length; i++) {
            if (messages[i].questionId === feedback.questionId) {
              if (messages[i].role === 'assistant') {
                answer = messages[i].content;
                if (i > 0 && messages[i - 1].role === 'user') {
                  question = messages[i - 1].content;
                }
              } else if (messages[i].role === 'user') {
                question = messages[i].content;
                if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                  answer = messages[i + 1].content;
                }
              }
              break;
            }
          }
        }

        return {
          feedbackId: feedback.id,
          questionId: feedback.questionId,
          sessionId: feedback.sessionId,
          question,
          answer,
          rating: feedback.rating,
          helpful: feedback.helpful,
          comment: feedback.comment,
          citations,
          createdAt: new Date(feedback.createdAt).toISOString(),
        };
      })
      .sort((a, b) => a.rating - b.rating);
  }

  getCountByDimensions(
    dimensions: DimensionKey[],
    request: UsageQueryRequest = {}
  ): Record<string, number> {
    const records = this.query(request);
    const result: Record<string, number> = {};

    for (const record of records) {
      const keyParts: string[] = [];

      for (const dim of dimensions) {
        let value: string | number | boolean | undefined;

        switch (dim) {
          case 'type':
            value = record.type;
            break;
          case 'tenantId':
            value = record.tenantId || 'unknown';
            break;
          case 'userId':
            value = record.userId || 'unknown';
            break;
          case 'sessionId':
            value = record.sessionId || 'unknown';
            break;
          case 'date':
            value = formatDateKey(record.timestamp);
            break;
          case 'success':
            value = record.success ? 'success' : 'failure';
            break;
        }

        keyParts.push(String(value));
      }

      const key = keyParts.join('|');
      result[key] = (result[key] || 0) + 1;
    }

    return result;
  }

  getCount(type?: UsageType, userId?: string): number {
    const summary = this.getSummary({ type, userId });
    return summary.total;
  }

  getByUser(userId: string, limit?: number): UsageRecord[] {
    const records = this.query({ userId });
    return limit ? records.slice(0, limit) : records;
  }

  getBySession(sessionId: string): UsageRecord[] {
    return this.records
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getByTenant(tenantId: string, limit?: number): UsageRecord[] {
    const records = this.query({ tenantId });
    return limit ? records.slice(0, limit) : records;
  }

  getTotalTokens(request: UsageQueryRequest = {}): number {
    const records = this.query(request);
    return records.reduce((sum, r) => sum + (r.tokens || 0), 0);
  }

  getAverageDuration(request: UsageQueryRequest = {}): number {
    const records = this.query(request).filter(r => typeof r.duration === 'number');
    if (records.length === 0) return 0;

    const total = records.reduce((sum, r) => sum + (r.duration || 0), 0);
    return total / records.length;
  }

  clearOldRecords(beforeTimestamp: number): number {
    const oldLength = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= beforeTimestamp);
    return oldLength - this.records.length;
  }

  getAllRecords(): UsageRecord[] {
    return [...this.records].sort((a, b) => b.timestamp - a.timestamp);
  }

  async initialize(tenantId?: string): Promise<void> {
    if (!this.storage?.loadUsage) return;
    const loaded = await this.storage.loadUsage(tenantId);
    this.records = loaded;
  }

  private async save(): Promise<void> {
    if (!this.storage?.saveUsage) return;
    try {
      await this.storage.saveUsage(this.records);
    } catch (_e) {
      // persist failure is non-critical
    }
  }
}
