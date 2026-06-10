import {
  UsageType,
  UsageRecord,
  UsageQueryRequest,
  UsageSummary,
} from '../types';
import { generateId, formatDateKey } from '../utils';

const ALL_USAGE_TYPES: UsageType[] = [
  'document_upload',
  'question_rewrite',
  'similar_question',
  'answer_generate',
  'feedback_submit',
  'faq_recommend',
];

export class UsageTracker {
  private records: UsageRecord[] = [];

  record(
    type: UsageType,
    options: {
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      tokens?: number;
      duration?: number;
    } = {}
  ): UsageRecord {
    const record: UsageRecord = {
      id: generateId('usage'),
      type,
      userId: options.userId,
      sessionId: options.sessionId,
      timestamp: Date.now(),
      metadata: options.metadata,
      tokens: options.tokens,
      duration: options.duration,
    };

    this.records.push(record);
    return record;
  }

  query(request: UsageQueryRequest = {}): UsageRecord[] {
    const { userId, startDate, endDate, type } = request;

    return this.records.filter(record => {
      if (userId && record.userId !== userId) {
        return false;
      }

      if (type && record.type !== type) {
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
    let earliest = Infinity;
    let latest = 0;

    for (const record of records) {
      byType[record.type] = (byType[record.type] || 0) + 1;

      const dateKey = formatDateKey(record.timestamp);
      byDate[dateKey] = (byDate[dateKey] || 0) + 1;

      if (record.timestamp < earliest) {
        earliest = record.timestamp;
      }
      if (record.timestamp > latest) {
        latest = record.timestamp;
      }
    }

    return {
      total: records.length,
      byType,
      byDate,
      startDate: request.startDate || (earliest === Infinity ? Date.now() : earliest),
      endDate: request.endDate || (latest === 0 ? Date.now() : latest),
    };
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
}
