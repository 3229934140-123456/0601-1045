import { AIPlatformConfig, UsageType } from '../types';
export * from '../types';

import { DocumentManager } from './DocumentManager';
import { QuestionProcessor } from './QuestionProcessor';
import { SensitiveWordFilter } from './SensitiveWordFilter';
import { AnswerGenerator } from './AnswerGenerator';
import { SessionManager } from './SessionManager';
import { UsageTracker } from './UsageTracker';

import {
  DocumentUploadRequest,
  DocumentUploadResult,
  DocumentChunk,
  Category,
  QuestionRewriteRequest,
  QuestionRewriteResult,
  SimilarQuestionRequest,
  SimilarQuestionResult,
  AnswerGenerateRequest,
  AnswerGenerateResult,
  CitationChunk,
  Session,
  SessionCreateRequest,
  SessionHistoryRequest,
  Message,
  UserFeedback,
  FeedbackSubmitRequest,
  FAQItem,
  FAQRecommendRequest,
  UsageQueryRequest,
  UsageSummary,
  UsageRecord,
  SensitiveCheckResult,
} from '../types';

export class AIPlatform {
  public document: DocumentManager;
  public question: QuestionProcessor;
  public answer: AnswerGenerator;
  public session: SessionManager;
  public usage: UsageTracker;
  public sensitive: SensitiveWordFilter;

  private config: AIPlatformConfig;
  private defaultUserId?: string;

  constructor(config: AIPlatformConfig = {}) {
    this.config = config;

    this.sensitive = new SensitiveWordFilter(config.sensitiveWords);
    this.document = new DocumentManager();
    this.question = new QuestionProcessor();
    this.usage = new UsageTracker();
    this.session = new SessionManager(
      this.question,
      config.maxHistoryLength || 20
    );
    this.answer = new AnswerGenerator(
      this.document,
      this.question,
      this.sensitive,
      {
        noAnswerMessage: config.noAnswerMessage,
        blockedMessage: config.blockedMessage,
      }
    );

    if (config.similarityThreshold !== undefined) {
      this.question.setDefaultThreshold(config.similarityThreshold);
    }
  }

  setDefaultUserId(userId: string): void {
    this.defaultUserId = userId;
  }

  private recordUsage(type: UsageType, extra: {
    sessionId?: string;
    metadata?: Record<string, any>;
    tokens?: number;
    duration?: number;
  } = {}): void {
    this.usage.record(type, {
      userId: this.defaultUserId,
      sessionId: extra.sessionId,
      metadata: extra.metadata,
      tokens: extra.tokens,
      duration: extra.duration,
    });
  }

  // ==================== 1. 文档整理 ====================

  addCategory(name: string, parentId?: string, description?: string): Category {
    return this.document.addCategory(name, parentId, description);
  }

  removeCategory(categoryId: string): boolean {
    return this.document.removeCategory(categoryId);
  }

  listCategories(): Category[] {
    return this.document.listCategories();
  }

  uploadDocument(request: DocumentUploadRequest): DocumentUploadResult {
    const result = this.document.uploadDocument(request);
    this.recordUsage('document_upload', {
      metadata: { category: request.category, chunks: result.chunkCount },
      tokens: request.content.length,
    });
    return result;
  }

  removeChunk(chunkId: string): boolean {
    return this.document.removeChunk(chunkId);
  }

  getChunk(chunkId: string): DocumentChunk | undefined {
    return this.document.getChunk(chunkId);
  }

  listChunks(categories?: string[], limit?: number): DocumentChunk[] {
    return this.document.listChunks(categories, limit);
  }

  getChunkCount(categories?: string[]): number {
    return this.document.getChunkCount(categories);
  }

  clearCategory(categoryId: string): number {
    return this.document.clearCategory(categoryId);
  }

  // ==================== 2. 问题改写 ====================

  rewriteQuestion(request: QuestionRewriteRequest): QuestionRewriteResult {
    const result = this.question.rewrite(request);
    this.recordUsage('question_rewrite', {
      metadata: { type: request.type || 'standard' },
    });
    return result;
  }

  findSimilarQuestions(request: SimilarQuestionRequest): SimilarQuestionResult {
    const result = this.question.findSimilar(request);
    this.recordUsage('similar_question', {
      metadata: { matches: result.candidates.length },
    });
    return result;
  }

  addQA(question: string, answer: string, category?: string): string {
    return this.question.addQA(question, answer, category);
  }

  batchAddQA(items: Array<{ question: string; answer: string; category?: string }>): string[] {
    return this.question.batchAddQA(items);
  }

  // ==================== 3. 答案生成 ====================

  async generateAnswer(request: AnswerGenerateRequest): Promise<AnswerGenerateResult> {
    let sessionId = request.sessionId;
    if (!sessionId || !this.session.hasSession(sessionId)) {
      const session = this.session.createSession({
        userId: this.defaultUserId,
        category: request.categories?.[0],
      });
      sessionId = session.id;
      request = { ...request, sessionId };
    }

    if (request.useHistory !== false) {
      const contextText = this.session.getContextText(sessionId, 1500);
      if (contextText) {
        const rewritten = this.question.rewrite({
          question: request.question,
          type: 'expand',
          context: contextText,
        });
        request = { ...request, question: rewritten.rewritten };
      }
    }

    this.session.addMessage(sessionId, 'user', request.question);

    const startTime = Date.now();
    const result = await this.answer.generate(request);
    const duration = Date.now() - startTime;

    this.session.addMessage(sessionId, 'assistant', result.answer, result.citations);

    this.recordUsage('answer_generate', {
      sessionId: result.sessionId,
      metadata: { status: result.status, citations: result.citations.length },
      tokens: result.answer.length + request.question.length,
      duration,
    });

    return result;
  }

  checkSensitive(text: string): SensitiveCheckResult {
    return this.sensitive.check(text);
  }

  addSensitiveWords(words: string[]): void {
    this.sensitive.addWords(words);
  }

  // ==================== 4. 引用返回 ====================

  getCitations(question: string, categories?: string[], limit: number = 5): CitationChunk[] {
    const searchResults = this.document.searchChunks(question, categories, limit);
    return searchResults.map(item => ({
      id: item.chunk.id,
      content: item.chunk.content,
      category: item.chunk.category,
      relevance: item.score,
      metadata: item.chunk.metadata,
    }));
  }

  // ==================== 5. 会话管理 ====================

  createSession(request: SessionCreateRequest = {}): Session {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    return this.session.createSession(request);
  }

  getSession(sessionId: string): Session | undefined {
    return this.session.getSession(sessionId);
  }

  listSessions(userId?: string, limit?: number): Session[] {
    return this.session.listSessions(userId || this.defaultUserId, limit);
  }

  getSessionHistory(request: SessionHistoryRequest): Message[] {
    return this.session.getHistory(request);
  }

  getContext(sessionId: string, maxChars?: number): string {
    return this.session.getContextText(sessionId, maxChars);
  }

  clearSession(sessionId: string): boolean {
    return this.session.clearSession(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    return this.session.deleteSession(sessionId);
  }

  submitFeedback(request: FeedbackSubmitRequest): UserFeedback | null {
    const result = this.session.submitFeedback(request);
    if (result) {
      this.recordUsage('feedback_submit', {
        sessionId: request.sessionId,
        metadata: { rating: request.rating, helpful: request.helpful },
      });
    }
    return result;
  }

  getFeedbacks(sessionId?: string): UserFeedback[] {
    return this.session.getFeedbacks(sessionId);
  }

  getAverageRating(sessionId?: string): number {
    return this.session.getAverageRating(sessionId);
  }

  addFAQ(question: string, answer: string, category?: string): FAQItem {
    return this.session.addFAQ(question, answer, category);
  }

  removeFAQ(faqId: string): boolean {
    return this.session.removeFAQ(faqId);
  }

  listFAQ(category?: string): FAQItem[] {
    return this.session.listFAQ(category);
  }

  recommendFAQ(request: FAQRecommendRequest = {}): FAQItem[] {
    const result = this.session.recommendFAQ(request);
    this.recordUsage('faq_recommend', {
      metadata: { count: result.length },
    });
    return result;
  }

  // ==================== 用量查询 ====================

  queryUsage(request: UsageQueryRequest = {}): UsageRecord[] {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    return this.usage.query(request);
  }

  getUsageSummary(request: UsageQueryRequest = {}): UsageSummary {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    return this.usage.getSummary(request);
  }

  getUsageCount(type?: UsageType, userId?: string): number {
    return this.usage.getCount(type, userId || this.defaultUserId);
  }

  // ==================== 便捷集成 ====================

  async ask(
    question: string,
    options: {
      sessionId?: string;
      categories?: string[];
      useHistory?: boolean;
      answerStyle?: 'brief' | 'detailed' | 'standard';
    } = {}
  ): Promise<AnswerGenerateResult> {
    return this.generateAnswer({
      question,
      sessionId: options.sessionId,
      categories: options.categories,
      useHistory: options.useHistory,
      answerStyle: options.answerStyle,
      maxCitations: 5,
    });
  }
}

export default AIPlatform;
