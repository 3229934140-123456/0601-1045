import {
  Session,
  SessionCreateRequest,
  SessionHistoryRequest,
  Message,
  UserFeedback,
  FeedbackSubmitRequest,
  FAQItem,
  FAQRecommendRequest,
  KnowledgeScope,
  StorageAdapter,
  LowScoreAnswerExport,
  AIPlatformConfig,
} from '../types';
import { generateId } from '../utils';
import { QuestionProcessor } from './QuestionProcessor';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private feedbacks: Map<string, UserFeedback[]> = new Map();
  private faqItems: Map<string, FAQItem> = new Map();
  private maxHistoryLength: number;
  private questionProcessor: QuestionProcessor;
  private storage?: StorageAdapter;
  private faqScoringWeights: {
    pinned: number;
    directQuestion: number;
    similarMatch: number;
    usage: number;
    recency: number;
  };

  constructor(
    questionProcessor: QuestionProcessor,
    optionsOrMaxHistory?: Partial<AIPlatformConfig> | number
  ) {
    this.questionProcessor = questionProcessor;

    if (typeof optionsOrMaxHistory === 'number') {
      this.maxHistoryLength = optionsOrMaxHistory;
      this.faqScoringWeights = {
        pinned: 0.4,
        directQuestion: 0.3,
        similarMatch: 0.2,
        usage: 0.05,
        recency: 0.05,
      };
    } else {
      this.maxHistoryLength = optionsOrMaxHistory?.maxHistoryLength || 20;
      this.storage = optionsOrMaxHistory?.storage;
      this.faqScoringWeights = optionsOrMaxHistory?.faqScoringWeights || {
        pinned: 0.4,
        directQuestion: 0.3,
        similarMatch: 0.2,
        usage: 0.05,
        recency: 0.05,
      };
    }
  }

  async initialize(tenantId?: string, userId?: string): Promise<void> {
    if (this.storage?.loadSessions) {
      const sessions = await this.storage.loadSessions(tenantId, userId);
      for (const session of sessions) {
        this.sessions.set(session.id, session);
      }
    }

    if (this.storage?.loadFeedbacks) {
      const feedbacks = await this.storage.loadFeedbacks(tenantId);
      for (const feedback of feedbacks) {
        if (!this.feedbacks.has(feedback.sessionId)) {
          this.feedbacks.set(feedback.sessionId, []);
        }
        this.feedbacks.get(feedback.sessionId)!.push(feedback);
      }
    }

    if (this.storage?.loadFAQs) {
      const faqs = await this.storage.loadFAQs(tenantId);
      for (const faq of faqs) {
        this.faqItems.set(faq.id, faq);
      }
    }
  }

  createSession(request: SessionCreateRequest & { category?: string } = {}): Session {
    const now = Date.now();
    const session: Session = {
      id: generateId('sess'),
      tenantId: request.tenantId,
      userId: request.userId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata: request.metadata,
      categoryId: request.categoryId || (request as any).category,
      scope: request.scope,
    };

    this.sessions.set(session.id, session);
    this.saveSessions();
    return session;
  }

  getSession(sessionId: string, userId?: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (userId && session.userId !== userId) return undefined;
    return session;
  }

  getSessionsByUser(userId: string, tenantId?: string): Session[] {
    let sessions = Array.from(this.sessions.values()).filter(
      s => s.userId === userId
    );
    if (tenantId) {
      sessions = sessions.filter(s => s.tenantId === tenantId);
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  hasSession(sessionId: string, userId?: string): boolean {
    return this.getSession(sessionId, userId) !== undefined;
  }

  listSessions(
    userId?: string,
    tenantIdOrLimit?: string | number,
    limit?: number
  ): Session[] {
    let sessions = Array.from(this.sessions.values());

    if (userId) {
      sessions = sessions.filter(s => s.userId === userId);
    }

    let actualLimit: number | undefined;
    if (typeof tenantIdOrLimit === 'number') {
      actualLimit = tenantIdOrLimit;
    } else if (typeof tenantIdOrLimit === 'string') {
      sessions = sessions.filter(s => s.tenantId === tenantIdOrLimit);
      actualLimit = limit;
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    if (actualLimit) {
      sessions = sessions.slice(0, actualLimit);
    }

    return sessions;
  }

  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    citations?: Message['citations'],
    questionId?: string,
    status?: Message['status']
  ): Message | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const message: Message = {
      id: generateId('msg'),
      role,
      content,
      timestamp: Date.now(),
      citations,
      questionId,
      status,
    };

    session.messages.push(message);

    if (session.messages.length > this.maxHistoryLength) {
      const overflow = session.messages.length - this.maxHistoryLength;
      session.messages.splice(0, overflow);
    }

    session.updatedAt = Date.now();
    this.saveSessions();
    return message;
  }

  getHistory(request: SessionHistoryRequest, userId?: string): Message[] {
    const session = this.getSession(request.sessionId, userId);
    if (!session) return [];

    let messages = [...session.messages];
    if (request.limit && request.limit > 0) {
      messages = messages.slice(-request.limit);
    }

    return messages;
  }

  getContextText(
    sessionId: string,
    maxChars: number = 2000,
    userId?: string
  ): string {
    const session = this.getSession(sessionId, userId);
    if (!session || session.messages.length === 0) return '';

    const parts: string[] = [];
    let totalChars = 0;

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      const prefix = msg.role === 'user' ? '用户问：' : '回答：';
      const text = prefix + msg.content;

      if (totalChars + text.length > maxChars && parts.length > 0) {
        break;
      }

      parts.unshift(text);
      totalChars += text.length;
    }

    return parts.join('\n');
  }

  getSessionScope(sessionId: string): KnowledgeScope | undefined {
    const session = this.sessions.get(sessionId);
    return session?.scope;
  }

  clearSession(sessionId: string, userId?: string): boolean {
    const session = this.getSession(sessionId, userId);
    if (!session) return false;

    session.messages = [];
    session.updatedAt = Date.now();
    this.saveSessions();
    return true;
  }

  deleteSession(sessionId: string, userId?: string): boolean {
    const session = this.getSession(sessionId, userId);
    if (!session) return false;

    this.feedbacks.delete(sessionId);
    const deleted = this.sessions.delete(sessionId);
    if (deleted && this.storage?.deleteSessions) {
      this.storage.deleteSessions([sessionId]);
    }
    return deleted;
  }

  submitFeedback(
    request: FeedbackSubmitRequest,
    userId?: string
  ): UserFeedback | null {
    const { sessionId, questionId, answerId, rating, comment, helpful, citationIds } = request;

    const session = this.getSession(sessionId, userId);
    if (!session) return null;

    const now = Date.now();
    const feedback: UserFeedback = {
      id: generateId('fb'),
      tenantId: session.tenantId,
      sessionId,
      questionId,
      answerId,
      userId: session.userId,
      rating: Math.max(1, Math.min(5, rating)),
      comment,
      helpful,
      citations: citationIds,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.feedbacks.has(sessionId)) {
      this.feedbacks.set(sessionId, []);
    }
    this.feedbacks.get(sessionId)!.push(feedback);
    this.saveFeedbacks();

    return feedback;
  }

  getFeedbacks(sessionId?: string, userId?: string): UserFeedback[] {
    if (sessionId) {
      const session = this.getSession(sessionId, userId);
      if (!session) return [];
      return this.feedbacks.get(sessionId) || [];
    }

    const all: UserFeedback[] = [];
    for (const list of this.feedbacks.values()) {
      for (const fb of list) {
        if (!userId || fb.userId === userId) {
          all.push(fb);
        }
      }
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  getAverageRating(sessionId?: string, userId?: string): number {
    const feedbacks = this.getFeedbacks(sessionId, userId);
    if (feedbacks.length === 0) return 0;

    const sum = feedbacks.reduce((acc, f) => acc + f.rating, 0);
    return sum / feedbacks.length;
  }

  exportLowScoreAnswers(
    maxRating: number = 3,
    options: {
      userId?: string;
      tenantId?: string;
      startDate?: number;
      endDate?: number;
    } = {}
  ): LowScoreAnswerExport[] {
    const { userId, tenantId, startDate, endDate } = options;

    const lowScoreFeedbacks = this.getFeedbacks(undefined, userId).filter(
      f => {
        if (f.rating > maxRating) return false;
        if (tenantId && f.tenantId !== tenantId) return false;
        if (startDate && f.createdAt < startDate) return false;
        if (endDate && f.createdAt > endDate) return false;
        return true;
      }
    );

    const result: LowScoreAnswerExport[] = [];

    for (const feedback of lowScoreFeedbacks) {
      const session = this.sessions.get(feedback.sessionId);
      if (!session) continue;

      let question = '';
      let answer = '';
      const citationIds: string[] = feedback.citations || [];
      let citationDetails: LowScoreAnswerExport['citationDetails'] = [];

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        if (msg.questionId === feedback.questionId) {
          if (msg.role === 'user') {
            question = msg.content;
            if (i + 1 < session.messages.length && session.messages[i + 1].questionId === feedback.questionId) {
              const assistantMsg = session.messages[i + 1];
              answer = assistantMsg.content;
              if (assistantMsg.citations) {
                citationDetails = assistantMsg.citations.map(c => ({
                  id: c.id,
                  content: c.content,
                  categoryId: c.categoryId,
                  tenantId: c.tenantId,
                  tags: c.tags,
                  relevance: c.relevance,
                }));
              }
            }
          } else if (msg.role === 'assistant') {
            answer = msg.content;
            if (msg.citations) {
              citationDetails = msg.citations.map(c => ({
                id: c.id,
                content: c.content,
                categoryId: c.categoryId,
                tenantId: c.tenantId,
                tags: c.tags,
                relevance: c.relevance,
              }));
            }
            if (i > 0 && session.messages[i - 1].questionId === feedback.questionId) {
              question = session.messages[i - 1].content;
            }
          }
          break;
        }
      }

      result.push({
        feedbackId: feedback.id,
        questionId: feedback.questionId,
        sessionId: feedback.sessionId,
        question,
        answer,
        rating: feedback.rating,
        helpful: feedback.helpful,
        comment: feedback.comment,
        citations: citationIds,
        citationDetails,
        createdAt: new Date(feedback.createdAt).toISOString(),
      });
    }

    return result;
  }

  addFAQ(
    question: string,
    answer: string,
    tenantIdOrCategory: string = 'default',
    categoryId: string = 'cat_default',
    tags: string[] = []
  ): FAQItem {
    let tenantId: string = 'default';
    let actualCategoryId: string = categoryId;

    if (arguments.length === 3) {
      actualCategoryId = tenantIdOrCategory;
      tenantId = 'default';
    } else {
      tenantId = tenantIdOrCategory;
    }

    const now = Date.now();
    const faq: FAQItem = {
      id: generateId('faq'),
      question,
      answer,
      tenantId,
      categoryId: actualCategoryId,
      tags,
      usageCount: 0,
      directQuestionCount: 0,
      similarMatchCount: 0,
      pinned: false,
      pinnedWeight: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.faqItems.set(faq.id, faq);
    this.questionProcessor.addQA(question, answer, actualCategoryId, {
      tenantId,
      categoryId: actualCategoryId,
      tags,
    });
    this.saveFAQs();
    return faq;
  }

  removeFAQ(faqId: string): boolean {
    const faq = this.faqItems.get(faqId);
    if (!faq) return false;

    this.faqItems.delete(faqId);
    this.questionProcessor.removeQA(faqId);
    this.saveFAQs();
    return true;
  }

  listFAQ(
    categoryId?: string,
    tenantId?: string
  ): FAQItem[] {
    let items = Array.from(this.faqItems.values());
    if (categoryId) {
      items = items.filter(f => f.categoryId === categoryId);
    }
    if (tenantId) {
      items = items.filter(f => f.tenantId === tenantId);
    }
    return items.sort((a, b) => b.usageCount - a.usageCount);
  }

  private calculateFAQScore(faq: FAQItem): number {
    const now = Date.now();
    const recencyScore = faq.lastUsedAt
      ? Math.max(0, 1 - (now - faq.lastUsedAt) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    const score =
      faq.pinnedWeight * this.faqScoringWeights.pinned +
      faq.directQuestionCount * this.faqScoringWeights.directQuestion +
      faq.similarMatchCount * this.faqScoringWeights.similarMatch +
      faq.usageCount * this.faqScoringWeights.usage +
      recencyScore * this.faqScoringWeights.recency;

    return score;
  }

  recommendFAQ(
    request: FAQRecommendRequest & { category?: string } = {}
  ): FAQItem[] {
    const {
      tenantId,
      categoryId,
      category,
      tags,
      limit = 10,
      userId,
    } = request as any;

    const actualCategoryId = categoryId || category;

    let items = Array.from(this.faqItems.values());

    if (tenantId) {
      items = items.filter(f => f.tenantId === tenantId);
    }
    if (actualCategoryId) {
      items = items.filter(f => f.categoryId === actualCategoryId);
    }
    if (tags && tags.length > 0) {
      items = items.filter(f =>
        tags.some((tag: string) => f.tags.includes(tag))
      );
    }

    if (items.length < limit) {
      const scope: KnowledgeScope | undefined = tenantId || actualCategoryId || tags
        ? {
            tenantId,
            categoryIds: actualCategoryId ? [actualCategoryId] : undefined,
            tagIds: tags,
            strictMode: false,
          }
        : undefined;

      const fromQa = this.questionProcessor.getFAQItems(scope, limit - items.length);
      const existingIds = new Set(items.map(i => i.id));

      for (const qa of fromQa) {
        if (!existingIds.has(qa.id)) {
          const newFaq: FAQItem = {
            id: qa.id,
            question: qa.question,
            answer: qa.answer,
            tenantId: qa.tenantId,
            categoryId: qa.categoryId,
            tags: qa.tags,
            usageCount: qa.usageCount,
            directQuestionCount: qa.directQuestionCount,
            similarMatchCount: qa.similarMatchCount,
            pinned: qa.pinned,
            pinnedWeight: qa.pinnedWeight,
            lastUsedAt: qa.lastUsedAt,
            createdAt: qa.createdAt,
            updatedAt: qa.updatedAt,
          };
          items.push(newFaq);
          this.faqItems.set(newFaq.id, newFaq);
        }
      }
    }

    items.sort((a, b) => this.calculateFAQScore(b) - this.calculateFAQScore(a));

    for (const item of items.slice(0, limit)) {
      item.usageCount++;
      item.lastUsedAt = Date.now();
      item.updatedAt = Date.now();
    }

    this.saveFAQs();
    return items.slice(0, limit);
  }

  incrementFAQCounts(
    faqId: string,
    directQuestion?: boolean,
    similarMatch?: boolean
  ): boolean {
    const faq = this.faqItems.get(faqId);
    if (!faq) {
      let success = false;
      if (directQuestion) {
        success = this.questionProcessor.incrementDirectQuestion(faqId);
      } else if (similarMatch) {
        success = this.questionProcessor.incrementSimilarMatch(faqId);
      }
      return success;
    }

    faq.usageCount++;
    if (directQuestion) {
      faq.directQuestionCount++;
      this.questionProcessor.incrementDirectQuestion(faqId);
    }
    if (similarMatch) {
      faq.similarMatchCount++;
      this.questionProcessor.incrementSimilarMatch(faqId);
    }
    faq.lastUsedAt = Date.now();
    faq.updatedAt = Date.now();
    this.saveFAQs();
    return true;
  }

  setFAQPin(
    faqId: string,
    pinned: boolean,
    weight?: number
  ): boolean {
    const faq = this.faqItems.get(faqId);
    if (!faq) {
      return this.questionProcessor.setPinned(faqId, pinned, weight);
    }

    faq.pinned = pinned;
    if (weight !== undefined) {
      faq.pinnedWeight = Math.max(0, Math.min(1, weight));
    } else if (pinned && faq.pinnedWeight === 0) {
      faq.pinnedWeight = 0.5;
    } else if (!pinned) {
      faq.pinnedWeight = 0;
    }
    faq.updatedAt = Date.now();

    this.questionProcessor.setPinned(faqId, pinned, weight);
    this.saveFAQs();
    return true;
  }

  getSessionCount(
    userId?: string,
    tenantId?: string
  ): number {
    if (!userId && !tenantId) {
      return this.sessions.size;
    }
    let count = 0;
    for (const session of this.sessions.values()) {
      if (userId && session.userId !== userId) continue;
      if (tenantId && session.tenantId !== tenantId) continue;
      count++;
    }
    return count;
  }

  setMaxHistoryLength(length: number): void {
    this.maxHistoryLength = Math.max(1, length);
  }

  private async saveSessions(): Promise<void> {
    if (this.storage?.saveSessions) {
      await this.storage.saveSessions(Array.from(this.sessions.values()));
    }
  }

  private async saveFeedbacks(): Promise<void> {
    if (this.storage?.saveFeedbacks) {
      const allFeedbacks: UserFeedback[] = [];
      for (const list of this.feedbacks.values()) {
        allFeedbacks.push(...list);
      }
      await this.storage.saveFeedbacks(allFeedbacks);
    }
  }

  private async saveFAQs(): Promise<void> {
    if (this.storage?.saveFAQs) {
      await this.storage.saveFAQs(Array.from(this.faqItems.values()));
    }
  }
}
