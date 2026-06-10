export interface DocumentChunk {
  id: string;
  content: string;
  category: string;
  metadata?: Record<string, any>;
  createdAt: number;
  embedding?: number[];
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  createdAt: number;
}

export interface DocumentUploadRequest {
  content: string;
  category: string;
  metadata?: Record<string, any>;
  chunkSize?: number;
}

export interface DocumentUploadResult {
  success: boolean;
  chunkIds: string[];
  category: string;
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
}

export interface SimilarQuestionRequest {
  question: string;
  topK?: number;
  threshold?: number;
  categories?: string[];
}

export interface SimilarQuestionResult {
  hasMatch: boolean;
  bestMatch?: SimilarQuestion;
  candidates: SimilarQuestion[];
}

export interface CitationChunk {
  id: string;
  content: string;
  category: string;
  relevance: number;
  metadata?: Record<string, any>;
}

export type AnswerStatus = 'success' | 'no_answer' | 'blocked' | 'error';

export interface AnswerGenerateRequest {
  question: string;
  categories?: string[];
  sessionId?: string;
  useHistory?: boolean;
  maxCitations?: number;
  answerStyle?: 'brief' | 'detailed' | 'standard';
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
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: CitationChunk[];
}

export interface Session {
  id: string;
  userId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
  category?: string;
}

export interface SessionCreateRequest {
  userId?: string;
  category?: string;
  metadata?: Record<string, any>;
}

export interface SessionHistoryRequest {
  sessionId: string;
  limit?: number;
}

export interface UserFeedback {
  id: string;
  sessionId: string;
  questionId: string;
  rating: number;
  comment?: string;
  helpful: boolean;
  createdAt: number;
}

export interface FeedbackSubmitRequest {
  sessionId: string;
  questionId: string;
  rating: number;
  comment?: string;
  helpful: boolean;
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  usageCount: number;
  lastUsedAt?: number;
}

export interface FAQRecommendRequest {
  category?: string;
  limit?: number;
  userId?: string;
}

export type UsageType =
  | 'document_upload'
  | 'question_rewrite'
  | 'similar_question'
  | 'answer_generate'
  | 'feedback_submit'
  | 'faq_recommend';

export interface UsageRecord {
  id: string;
  type: UsageType;
  userId?: string;
  sessionId?: string;
  timestamp: number;
  metadata?: Record<string, any>;
  tokens?: number;
  duration?: number;
}

export interface UsageQueryRequest {
  userId?: string;
  startDate?: number;
  endDate?: number;
  type?: UsageType;
}

export interface UsageSummary {
  total: number;
  byType: Record<UsageType, number>;
  byDate: Record<string, number>;
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

export interface AIPlatformConfig {
  sensitiveWords?: SensitiveWordConfig;
  noAnswerMessage?: string;
  blockedMessage?: string;
  similarityThreshold?: number;
  maxHistoryLength?: number;
  embeddingModel?: string;
  answerModel?: string;
}
