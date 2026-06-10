export interface Tenant {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  tenantId: string;
  parentId?: string;
  description?: string;
  sortOrder: number;
  createdAt: number;
}

export interface CategoryTree extends Category {
  children: CategoryTree[];
}

export interface Tag {
  id: string;
  name: string;
  tenantId: string;
  color?: string;
  createdAt: number;
}

export interface KnowledgeScope {
  tenantId?: string;
  categoryIds?: string[];
  tagIds?: string[];
  includeSubCategories?: boolean;
  strictMode: boolean;
}

export interface DocumentChunk {
  id: string;
  content: string;
  tenantId: string;
  categoryId: string;
  tags: string[];
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  embedding?: number[];
}

export interface DocumentUploadRequest {
  content: string;
  tenantId: string;
  categoryId: string;
  tags?: string[];
  metadata?: Record<string, any>;
  chunkSize?: number;
}

export interface DocumentUploadResult {
  success: boolean;
  chunkIds: string[];
  categoryId: string;
  tenantId: string;
  chunkCount: number;
  message?: string;
}

export type QuestionRewriteType = 'standard' | 'expand' | 'simplify';

export interface QuestionRewriteRequest {
  question: string;
  type?: QuestionRewriteType;
  context?: string;
}

export interface QuestionRewriteResult {
  original: string;
  rewritten: string;
  variants: string[];
  type: QuestionRewriteType;
}

export interface SimilarQuestion {
  question: string;
  answer: string;
  similarity: number;
  questionId: string;
  categoryId: string;
}

export interface SimilarQuestionRequest {
  question: string;
  topK?: number;
  threshold?: number;
  scope?: KnowledgeScope;
}

export interface SimilarQuestionResult {
  hasMatch: boolean;
  bestMatch?: SimilarQuestion;
  candidates: SimilarQuestion[];
  processingTime: number;
}

export interface CitationChunk {
  id: string;
  content: string;
  categoryId: string;
  tenantId: string;
  tags: string[];
  relevance: number;
  metadata?: Record<string, any>;
}

export type AnswerStatus = 'success' | 'no_answer' | 'blocked' | 'error' | 'scope_empty';

export interface RetrieveResult {
  chunks: CitationChunk[];
  totalFound: number;
  retrievalTime: number;
  retrievalMethod: string;
  indexUsed?: string;
}

export interface LLMResult {
  answer: string;
  llmTime: number;
  modelName: string;
  tokensInput: number;
  tokensOutput: number;
  rawResponse?: any;
}

export interface ProcessingStep {
  name: string;
  status: 'start' | 'end' | 'error';
  duration: number;
  detail?: Record<string, any>;
}

export interface AnswerGenerateRequest {
  question: string;
  scope?: KnowledgeScope;
  sessionId?: string;
  useHistory?: boolean;
  maxCitations?: number;
  answerStyle?: 'brief' | 'detailed' | 'standard';
  traceSteps?: boolean;
}

export interface AnswerGenerateResult {
  status: AnswerStatus;
  answer: string;
  citations: CitationChunk[];
  questionId: string;
  sessionId: string;
  relatedQuestions?: string[];
  message?: string;
  processingTime: number;
  retrieval?: {
    chunksFound: number;
    chunksUsed: number;
    retrievalTime: number;
    method: string;
    scopeEmpty?: boolean;
    scopeDetails?: {
      tenantId?: string;
      categoryIds?: string[];
      validCategories: string[];
      invalidCategories?: string[];
    };
  };
  llm?: {
    model: string;
    timeMs: number;
    tokensInput: number;
    tokensOutput: number;
  };
  steps?: ProcessingStep[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: CitationChunk[];
  questionId?: string;
  status?: AnswerStatus;
}

export interface Session {
  id: string;
  tenantId?: string;
  userId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
  categoryId?: string;
  scope?: KnowledgeScope;
}

export interface SessionCreateRequest {
  tenantId?: string;
  userId?: string;
  categoryId?: string;
  scope?: KnowledgeScope;
  metadata?: Record<string, any>;
}

export interface SessionHistoryRequest {
  sessionId: string;
  limit?: number;
}

export interface UserFeedback {
  id: string;
  tenantId?: string;
  sessionId: string;
  questionId: string;
  answerId?: string;
  userId?: string;
  rating: number;
  comment?: string;
  helpful: boolean;
  citations?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FeedbackSubmitRequest {
  sessionId: string;
  questionId: string;
  answerId?: string;
  rating: number;
  comment?: string;
  helpful: boolean;
  citationIds?: string[];
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  tenantId: string;
  categoryId: string;
  tags: string[];
  usageCount: number;
  directQuestionCount: number;
  similarMatchCount: number;
  pinned: boolean;
  pinnedWeight: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface FAQRecommendRequest {
  tenantId?: string;
  categoryId?: string;
  tags?: string[];
  limit?: number;
  userId?: string;
}

export type UsageType =
  | 'document_upload'
  | 'question_rewrite'
  | 'similar_question'
  | 'answer_generate'
  | 'feedback_submit'
  | 'faq_recommend'
  | 'retrieval'
  | 'llm_call';

export interface UsageRecord {
  id: string;
  type: UsageType;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  timestamp: number;
  metadata?: Record<string, any>;
  tokens?: number;
  duration?: number;
  success: boolean;
}

export interface UsageQueryRequest {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  startDate?: number;
  endDate?: number;
  type?: UsageType;
  success?: boolean;
}

export interface UsageSummary {
  total: number;
  successCount: number;
  byType: Record<UsageType, number>;
  byDate: Record<string, number>;
  byTenant: Record<string, number>;
  byUser: Record<string, number>;
  bySession: Record<string, number>;
  totalTokens: number;
  averageDuration: number;
  startDate: number;
  endDate: number;
}

export interface SensitiveWordConfig {
  words: string[];
  replacement?: string;
  enableBlock?: boolean;
  customPatterns?: RegExp[];
}

export interface SensitiveCheckResult {
  hasSensitive: boolean;
  matchedWords: string[];
  filteredText: string;
  shouldBlock: boolean;
}

export interface RetrieveRequest {
  query: string;
  scope: KnowledgeScope;
  topK: number;
  traceSteps?: boolean;
}

export interface Retriever {
  name: string;
  retrieve(request: RetrieveRequest): Promise<RetrieveResult>;
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  removeChunks(chunkIds: string[]): Promise<void>;
  clear(tenantId?: string): Promise<void>;
}

export interface LLMGenerateRequest {
  question: string;
  context: string;
  citations: CitationChunk[];
  style?: 'brief' | 'detailed' | 'standard';
  history?: string;
}

export interface LLM {
  name: string;
  generate(request: LLMGenerateRequest): Promise<LLMResult>;
}

export interface StorageAdapter {
  saveChunks?(chunks: DocumentChunk[]): Promise<void>;
  loadChunks?(tenantId?: string, categoryId?: string): Promise<DocumentChunk[]>;
  deleteChunks?(chunkIds: string[]): Promise<void>;

  saveSessions?(sessions: Session[]): Promise<void>;
  loadSessions?(tenantId?: string, userId?: string): Promise<Session[]>;
  deleteSessions?(sessionIds: string[]): Promise<void>;

  saveFeedbacks?(feedbacks: UserFeedback[]): Promise<void>;
  loadFeedbacks?(tenantId?: string, sessionId?: string): Promise<UserFeedback[]>;

  saveFAQs?(faqs: FAQItem[]): Promise<void>;
  loadFAQs?(tenantId?: string, categoryId?: string): Promise<FAQItem[]>;

  saveUsage?(records: UsageRecord[]): Promise<void>;
  loadUsage?(tenantId?: string, startDate?: number, endDate?: number): Promise<UsageRecord[]>;

  saveTenants?(tenants: Tenant[]): Promise<void>;
  loadTenants?(): Promise<Tenant[]>;

  saveCategories?(categories: Category[]): Promise<void>;
  loadCategories?(tenantId?: string): Promise<Category[]>;

  saveTags?(tags: Tag[]): Promise<void>;
  loadTags?(tenantId?: string): Promise<Tag[]>;
}

export interface AIPlatformConfig {
  tenantId?: string;
  defaultUserId?: string;
  sensitiveWords?: SensitiveWordConfig;
  noAnswerMessage?: string;
  blockedMessage?: string;
  scopeEmptyMessage?: string;
  similarityThreshold?: number;
  maxHistoryLength?: number;
  embeddingModel?: string;
  answerModel?: string;
  retriever?: Retriever;
  llm?: LLM;
  storage?: StorageAdapter;
  enableStepTracing?: boolean;
  faqScoringWeights?: {
    pinned: number;
    directQuestion: number;
    similarMatch: number;
    usage: number;
    recency: number;
  };
}

export interface LowScoreAnswerExport {
  feedbackId: string;
  questionId: string;
  sessionId: string;
  question: string;
  answer: string;
  rating: number;
  helpful: boolean;
  comment?: string;
  citations: string[];
  createdAt: string;
}
