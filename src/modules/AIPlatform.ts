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
  Tenant,
  Tag,
  KnowledgeScope,
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
  LowScoreAnswerExport,
} from '../types';
import { DimensionKey } from './UsageTracker';

export class AIPlatform {
  public document: DocumentManager;
  public question: QuestionProcessor;
  public answer: AnswerGenerator;
  public session: SessionManager;
  public usage: UsageTracker;
  public sensitive: SensitiveWordFilter;

  private config: AIPlatformConfig;
  private defaultUserId?: string;
  private defaultTenantId?: string;

  constructor(config: AIPlatformConfig = {}) {
    this.config = config;
    this.defaultTenantId = config.tenantId;
    this.defaultUserId = config.defaultUserId;

    this.sensitive = new SensitiveWordFilter(config.sensitiveWords);
    this.document = new DocumentManager();
    this.question = new QuestionProcessor();
    this.usage = new UsageTracker();
    this.session = new SessionManager(
      this.question,
      config
    );
    this.answer = new AnswerGenerator(
      this.document,
      this.question,
      this.sensitive,
      {
        noAnswerMessage: config.noAnswerMessage,
        blockedMessage: config.blockedMessage,
        scopeEmptyMessage: config.scopeEmptyMessage,
      }
    );

    if (config.similarityThreshold !== undefined) {
      this.question.setDefaultThreshold(config.similarityThreshold);
    }
  }

  setDefaultUserId(userId: string): void {
    this.defaultUserId = userId;
  }

  setDefaultTenantId(tenantId: string): void {
    this.defaultTenantId = tenantId;
  }

  private recordUsage(type: UsageType, extra: {
    tenantId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
    tokens?: number;
    duration?: number;
    success?: boolean;
  } = {}): void {
    this.usage.record(type, {
      tenantId: extra.tenantId || this.defaultTenantId,
      userId: this.defaultUserId,
      sessionId: extra.sessionId,
      metadata: extra.metadata,
      tokens: extra.tokens,
      duration: extra.duration,
      success: extra.success,
    });
  }

  // ==================== 0. 租户 & 标签管理 ====================

  addTenant(name: string, description?: string): Tenant | null {
    return this.document.addTenant(name, description);
  }

  listTenants(onlyActive: boolean = true): Tenant[] {
    return this.document.listTenants(onlyActive);
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.document.getTenant(tenantId);
  }

  removeTenant(tenantId: string): boolean {
    return this.document.removeTenant(tenantId);
  }

  addTag(name: string, tenantId?: string, color?: string): Tag | null {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return null;
    return this.document.addTag(name, effectiveTenantId, color);
  }

  listTags(tenantId?: string): Tag[] {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return [];
    return this.document.listTags(effectiveTenantId);
  }

  getTag(tagId: string, tenantId?: string): Tag | undefined {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return undefined;
    return this.document.getTag(tagId, effectiveTenantId);
  }

  removeTag(tagId: string, tenantId?: string): boolean {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return false;
    return this.document.removeTag(tagId, effectiveTenantId);
  }

  // ==================== 1. 文档整理 ====================

  addCategory(name: string, tenantId?: string, parentId?: string, description?: string): Category | null {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return null;
    return this.document.addCategory(name, effectiveTenantId, parentId, description);
  }

  removeCategory(categoryId: string, tenantId?: string): boolean {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return false;
    return this.document.removeCategory(categoryId, effectiveTenantId);
  }

  listCategories(tenantId?: string): Category[] {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return [];
    return this.document.listCategories(effectiveTenantId);
  }

  async uploadDocument(request: DocumentUploadRequest): Promise<DocumentUploadResult> {
    const result = await this.document.uploadDocument(request);
    this.recordUsage('document_upload', {
      tenantId: request.tenantId,
      metadata: { categoryId: request.categoryId, chunks: result.chunkCount },
      tokens: request.content.length,
      success: result.success,
    });
    return result;
  }

  removeChunk(chunkId: string, tenantId?: string): boolean {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return false;
    return this.document.removeChunk(chunkId, effectiveTenantId);
  }

  getChunk(chunkId: string, tenantId?: string): DocumentChunk | undefined {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return undefined;
    return this.document.getChunk(chunkId, effectiveTenantId);
  }

  listChunks(scope?: KnowledgeScope, limit?: number): DocumentChunk[] {
    const effectiveScope: KnowledgeScope = scope || {
      tenantId: this.defaultTenantId,
      strictMode: false,
    };
    return this.document.listChunks(effectiveScope, limit);
  }

  getChunkCount(scope?: KnowledgeScope): number {
    const effectiveScope: KnowledgeScope = scope || {
      tenantId: this.defaultTenantId,
      strictMode: false,
    };
    return this.document.getChunkCount(effectiveScope);
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
    let tenantId = request.scope?.tenantId || this.defaultTenantId;

    if (!sessionId || !this.session.hasSession(sessionId)) {
      const session = this.session.createSession({
        tenantId,
        userId: this.defaultUserId,
        categoryId: request.scope?.categoryIds?.[0],
        scope: request.scope,
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

    this.session.addMessage(sessionId, 'assistant', result.answer, result.citations, result.questionId, result.status);

    const session = this.session.getSession(sessionId);

    this.recordUsage('answer_generate', {
      tenantId: session?.tenantId,
      sessionId: result.sessionId,
      metadata: { status: result.status, citations: result.citations.length },
      tokens: result.llm ? result.llm.tokensInput + result.llm.tokensOutput : result.answer.length + request.question.length,
      duration,
      success: result.status === 'success',
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

  getCitations(question: string, scope?: KnowledgeScope, limit: number = 5): CitationChunk[] {
    const effectiveScope: KnowledgeScope = scope || {
      tenantId: this.defaultTenantId,
      strictMode: false,
    };
    const searchResults = this.document.searchChunks(question, effectiveScope, limit);
    return searchResults.map(item => ({
      id: item.chunk.id,
      content: item.chunk.content,
      categoryId: item.chunk.categoryId,
      tenantId: item.chunk.tenantId,
      tags: item.chunk.tags,
      relevance: item.score,
      metadata: item.chunk.metadata,
    }));
  }

  // ==================== 5. 会话管理 ====================

  createSession(request: SessionCreateRequest = {}): Session {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    if (!request.tenantId && this.defaultTenantId) {
      request = { ...request, tenantId: this.defaultTenantId };
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
    const result = this.session.submitFeedback(request, this.defaultUserId);
    if (result) {
      const session = this.session.getSession(request.sessionId);
      this.recordUsage('feedback_submit', {
        tenantId: session?.tenantId,
        sessionId: request.sessionId,
        metadata: { rating: request.rating, helpful: request.helpful },
        success: true,
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
    if (!request.tenantId && this.defaultTenantId) {
      request = { ...request, tenantId: this.defaultTenantId };
    }
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    const result = this.session.recommendFAQ(request);
    this.recordUsage('faq_recommend', {
      tenantId: request.tenantId,
      metadata: { count: result.length },
      success: true,
    });
    return result;
  }

  // ==================== 用量查询 ====================

  queryUsage(request: UsageQueryRequest = {}): UsageRecord[] {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    if (!request.tenantId && this.defaultTenantId) {
      request = { ...request, tenantId: this.defaultTenantId };
    }
    return this.usage.query(request);
  }

  getUsageSummary(request: UsageQueryRequest = {}): UsageSummary {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    if (!request.tenantId && this.defaultTenantId) {
      request = { ...request, tenantId: this.defaultTenantId };
    }
    return this.usage.getSummary(request);
  }

  getUsageCount(type?: UsageType, userId?: string): number {
    return this.usage.getCount(type, userId || this.defaultUserId);
  }

  getLowScoreFeedbacks(options: {
    tenantId?: string;
    userId?: string;
    startDate?: number;
    endDate?: number;
    threshold?: number;
  } = {}): LowScoreAnswerExport[] {
    const feedbacks = this.session.getFeedbacks(undefined, options.userId);
    const getSession = (sessionId: string) => this.session.getSession(sessionId);
    
    const finalOptions = {
      ...options,
      tenantId: options.tenantId || this.defaultTenantId,
      userId: options.userId || this.defaultUserId,
    };
    
    return this.usage.getLowScoreFeedbacks(feedbacks, getSession, finalOptions);
  }

  getUsageCountByDimensions(
    dimensions: DimensionKey[],
    request: UsageQueryRequest = {}
  ): Record<string, number> {
    if (!request.userId && this.defaultUserId) {
      request = { ...request, userId: this.defaultUserId };
    }
    if (!request.tenantId && this.defaultTenantId) {
      request = { ...request, tenantId: this.defaultTenantId };
    }
    return this.usage.getCountByDimensions(dimensions, request);
  }

  // ==================== 便捷集成 ====================

  async ask(
    question: string,
    options: {
      sessionId?: string;
      scope?: KnowledgeScope;
      useHistory?: boolean;
      answerStyle?: 'brief' | 'detailed' | 'standard';
      traceSteps?: boolean;
      maxCitations?: number;
    } = {}
  ): Promise<AnswerGenerateResult> {
    return this.generateAnswer({
      question,
      sessionId: options.sessionId,
      scope: options.scope,
      useHistory: options.useHistory,
      answerStyle: options.answerStyle,
      traceSteps: options.traceSteps,
      maxCitations: options.maxCitations || 5,
    });
  }
}

export default AIPlatform;
