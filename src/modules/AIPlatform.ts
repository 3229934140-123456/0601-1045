import { AIPlatformConfig, UsageType, RebuildResult } from '../types';
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
    this.document = new DocumentManager(config.storage, config.tenantId);
    this.question = new QuestionProcessor();
    this.usage = new UsageTracker(config.storage);
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
        retriever: config.retriever,
        llm: config.llm,
        enableStepTracing: config.enableStepTracing,
      }
    );

    if (config.similarityThreshold !== undefined) {
      this.question.setDefaultThreshold(config.similarityThreshold);
    }
  }

  async initialize(): Promise<void> {
    await this.document.initialize();
    await this.session.initialize(this.defaultTenantId, this.defaultUserId);
    await this.usage.initialize(this.defaultTenantId);

    const allFAQs = this.session.listFAQ();
    if (allFAQs.length > 0) {
      this.question.rebuildFromFAQs(allFAQs);
    }
  }

  setDefaultUserId(userId: string): void {
    this.defaultUserId = userId;
  }

  setDefaultTenantId(tenantId: string): void {
    this.defaultTenantId = tenantId;
  }

  private resolveUserId(sessionId?: string): string | undefined {
    if (sessionId) {
      const session = this.session.getSession(sessionId);
      if (session?.userId) return session.userId;
    }
    return this.defaultUserId;
  }

  private recordUsage(type: UsageType, extra: {
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
    tokens?: number;
    duration?: number;
    success?: boolean;
    errorMessage?: string;
  } = {}): void {
    const userId = extra.userId || this.resolveUserId(extra.sessionId);
    this.usage.record(type, {
      tenantId: extra.tenantId || this.defaultTenantId,
      userId,
      sessionId: extra.sessionId,
      metadata: extra.metadata,
      tokens: extra.tokens,
      duration: extra.duration,
      success: extra.success,
      errorMessage: extra.errorMessage,
    });
  }

  // ==================== 0. 租户 & 标签管理 ====================

  addTenant(name: string, description?: string): Tenant {
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
    let effectiveScope = request.scope;

    if (sessionId && this.session.hasSession(sessionId)) {
      const existingSession = this.session.getSession(sessionId);
      if (!effectiveScope && existingSession?.scope) {
        effectiveScope = existingSession.scope;
      }
      if (!tenantId && existingSession?.tenantId) {
        tenantId = existingSession.tenantId;
      }
    }

    if (!sessionId || !this.session.hasSession(sessionId)) {
      const session = this.session.createSession({
        tenantId,
        userId: this.defaultUserId,
        categoryId: effectiveScope?.categoryIds?.[0],
        scope: effectiveScope,
      });
      sessionId = session.id;
      request = { ...request, sessionId };
    }

    if (effectiveScope && !request.scope) {
      request = { ...request, scope: effectiveScope };
    }

    const originalQuestion = request.question;

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

    this.session.addMessage(sessionId, 'user', originalQuestion);

    const startTime = Date.now();
    const result = await this.answer.generate(request);
    const duration = Date.now() - startTime;

    const userMsg = this.session.getSession(sessionId)?.messages.find(
      m => m.role === 'user' && !m.questionId && m.timestamp >= startTime - 1
    );
    if (userMsg) {
      userMsg.questionId = result.questionId;
    }

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
    const result = this.session.submitFeedback(request);
    if (result) {
      const session = this.session.getSession(request.sessionId);
      this.recordUsage('feedback_submit', {
        tenantId: session?.tenantId,
        sessionId: request.sessionId,
        userId: session?.userId,
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

  addFAQ(question: string, answer: string, tenantIdOrCategory?: string, category?: string): FAQItem {
    return this.session.addFAQ(question, answer, tenantIdOrCategory, category);
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
    return this.usage.query(request);
  }

  getUsageSummary(request: UsageQueryRequest = {}): UsageSummary {
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
    const threshold = options.threshold ?? 3;
    const exports = this.session.exportLowScoreAnswers(threshold, {
      userId: options.userId,
      tenantId: options.tenantId,
      startDate: options.startDate,
      endDate: options.endDate,
    });

    for (const item of exports) {
      for (const cit of item.citationDetails) {
        cit.categoryName = this.document.getCategoryName(cit.categoryId);
        cit.tagNames = cit.tags.map(t => this.document.getTagName(t)).filter(Boolean) as string[];
      }
    }

    return exports;
  }

  getUsageCountByDimensions(
    dimensions: DimensionKey[],
    request: UsageQueryRequest = {}
  ): Record<string, number> {
    return this.usage.getCountByDimensions(dimensions, request);
  }

  exportUsageDetail(request: UsageQueryRequest = {}): UsageRecord[] {
    const effectiveRequest: UsageQueryRequest = { ...request };
    if (!effectiveRequest.tenantId && this.defaultTenantId) {
      effectiveRequest.tenantId = this.defaultTenantId;
    }
    return this.usage.exportUsageDetail(effectiveRequest);
  }

  async rebuildKnowledgeBase(scope?: {
    tenantId?: string;
    categoryIds?: string[];
    tagIds?: string[];
  }): Promise<RebuildResult> {
    const startTime = Date.now();
    const effectiveTenantId = scope?.tenantId || this.defaultTenantId;

    const allChunks = this.document.getAllChunks(effectiveTenantId);
    const totalChunks = allChunks.length;
    const totalDocuments = new Set(allChunks.map(c => c.metadata?.documentId || c.id)).size;

    let affectedChunks = allChunks;
    if (scope?.categoryIds && scope.categoryIds.length > 0) {
      affectedChunks = allChunks.filter(c => scope.categoryIds!.includes(c.categoryId));
    }
    if (scope?.tagIds && scope.tagIds.length > 0) {
      affectedChunks = affectedChunks.filter(c =>
        scope.tagIds!.some(tid => c.tags.includes(tid))
      );
    }

    const affectedDocuments = new Set(
      affectedChunks.map(c => c.metadata?.documentId || c.id)
    ).size;

    this.document.rebuildChunkIndex();

    let retrievalUpdated = false;
    try {
      if ((this.answer as any).retriever && (this.answer as any).retriever.addChunks) {
        await (this.answer as any).retriever.clear(effectiveTenantId);
        await (this.answer as any).retriever.addChunks(affectedChunks);
        retrievalUpdated = true;
      }
    } catch (_e) {
      // retrieval rebuild failure is non-critical
    }

    let faqUpdated = false;
    try {
      const faqs = this.session.listFAQ(undefined, effectiveTenantId);
      if (faqs.length > 0) {
        this.question.rebuildFromFAQs(faqs);
        faqUpdated = true;
      }
    } catch (_e) {
      // FAQ rebuild failure is non-critical
    }

    const duration = Date.now() - startTime;

    return {
      totalChunks,
      totalDocuments,
      affectedChunks: affectedChunks.length,
      affectedDocuments,
      retrievalUpdated,
      faqUpdated,
      duration,
    };
  }

  moveChunk(chunkId: string, newCategoryId: string, tenantId?: string): boolean {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return false;
    return this.document.moveChunk(chunkId, newCategoryId, effectiveTenantId);
  }

  updateChunkTags(chunkId: string, newTags: string[], tenantId?: string): boolean {
    const effectiveTenantId = tenantId || this.defaultTenantId;
    if (!effectiveTenantId) return false;
    return this.document.updateChunkTags(chunkId, newTags, effectiveTenantId);
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
