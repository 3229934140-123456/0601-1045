import {
  Session,
  SessionCreateRequest,
  SessionHistoryRequest,
  Message,
  UserFeedback,
  FeedbackSubmitRequest,
  FAQItem,
  FAQRecommendRequest,
} from '../types';
import { generateId } from '../utils';
import { QuestionProcessor } from './QuestionProcessor';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private feedbacks: Map<string, UserFeedback[]> = new Map();
  private faqItems: Map<string, FAQItem> = new Map();
  private maxHistoryLength: number;
  private questionProcessor: QuestionProcessor;

  constructor(questionProcessor: QuestionProcessor, maxHistoryLength: number = 20) {
    this.questionProcessor = questionProcessor;
    this.maxHistoryLength = maxHistoryLength;
  }

  createSession(request: SessionCreateRequest = {}): Session {
    const session: Session = {
      id: generateId('sess'),
      userId: request.userId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: request.metadata,
      category: request.category,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  listSessions(userId?: string, limit?: number): Session[] {
    let sessions = Array.from(this.sessions.values());

    if (userId) {
      sessions = sessions.filter(s => s.userId === userId);
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    if (limit) {
      sessions = sessions.slice(0, limit);
    }

    return sessions;
  }

  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    citations?: Message['citations']
  ): Message | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const message: Message = {
      id: generateId('msg'),
      role,
      content,
      timestamp: Date.now(),
      citations,
    };

    session.messages.push(message);

    if (session.messages.length > this.maxHistoryLength) {
      const overflow = session.messages.length - this.maxHistoryLength;
      session.messages.splice(0, overflow);
    }

    session.updatedAt = Date.now();
    return message;
  }

  getHistory(request: SessionHistoryRequest): Message[] {
    const session = this.sessions.get(request.sessionId);
    if (!session) return [];

    let messages = [...session.messages];
    if (request.limit && request.limit > 0) {
      messages = messages.slice(-request.limit);
    }

    return messages;
  }

  getContextText(sessionId: string, maxChars: number = 2000): string {
    const session = this.sessions.get(sessionId);
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

  clearSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.messages = [];
    session.updatedAt = Date.now();
    return true;
  }

  deleteSession(sessionId: string): boolean {
    this.feedbacks.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  submitFeedback(request: FeedbackSubmitRequest): UserFeedback | null {
    const { sessionId, questionId, rating, comment, helpful } = request;

    if (!this.sessions.has(sessionId)) {
      return null;
    }

    const feedback: UserFeedback = {
      id: generateId('fb'),
      sessionId,
      questionId,
      rating: Math.max(1, Math.min(5, rating)),
      comment,
      helpful,
      createdAt: Date.now(),
    };

    if (!this.feedbacks.has(sessionId)) {
      this.feedbacks.set(sessionId, []);
    }
    this.feedbacks.get(sessionId)!.push(feedback);

    return feedback;
  }

  getFeedbacks(sessionId?: string): UserFeedback[] {
    if (sessionId) {
      return this.feedbacks.get(sessionId) || [];
    }

    const all: UserFeedback[] = [];
    for (const list of this.feedbacks.values()) {
      all.push(...list);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  getAverageRating(sessionId?: string): number {
    const feedbacks = this.getFeedbacks(sessionId);
    if (feedbacks.length === 0) return 0;

    const sum = feedbacks.reduce((acc, f) => acc + f.rating, 0);
    return sum / feedbacks.length;
  }

  addFAQ(question: string, answer: string, category: string = 'cat_default'): FAQItem {
    const faq: FAQItem = {
      id: generateId('faq'),
      question,
      answer,
      category,
      usageCount: 0,
    };

    this.faqItems.set(faq.id, faq);
    this.questionProcessor.addQA(question, answer, category);
    return faq;
  }

  removeFAQ(faqId: string): boolean {
    const faq = this.faqItems.get(faqId);
    if (!faq) return false;

    this.faqItems.delete(faqId);
    return true;
  }

  listFAQ(category?: string): FAQItem[] {
    let items = Array.from(this.faqItems.values());
    if (category) {
      items = items.filter(f => f.category === category);
    }
    return items.sort((a, b) => b.usageCount - a.usageCount);
  }

  recommendFAQ(request: FAQRecommendRequest = {}): FAQItem[] {
    const { category, limit = 10 } = request;

    let items = this.listFAQ(category);

    if (items.length < limit) {
      const fromQa = this.questionProcessor.getFAQ(category, limit - items.length);
      const existingIds = new Set(items.map(i => i.id));

      for (const qa of fromQa) {
        if (!existingIds.has(qa.questionId)) {
          items.push({
            id: qa.questionId,
            question: qa.question,
            answer: qa.answer,
            category: category || 'cat_default',
            usageCount: 0,
          });
        }
      }
    }

    items.sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    });

    for (const item of items.slice(0, limit)) {
      item.usageCount++;
      item.lastUsedAt = Date.now();
    }

    return items.slice(0, limit);
  }

  getSessionCount(userId?: string): number {
    if (!userId) {
      return this.sessions.size;
    }
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        count++;
      }
    }
    return count;
  }

  setMaxHistoryLength(length: number): void {
    this.maxHistoryLength = Math.max(1, length);
  }
}
