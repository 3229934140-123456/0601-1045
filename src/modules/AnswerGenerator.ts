import {
  AnswerGenerateRequest,
  AnswerGenerateResult,
  AnswerStatus,
  CitationChunk,
  KnowledgeScope,
  Retriever,
  LLM,
  ProcessingStep,
  RetrieveResult,
  LLMResult,
} from '../types';
import { generateId, normalizeText } from '../utils';
import { DocumentManager, ScopeValidationResult } from './DocumentManager';
import { QuestionProcessor } from './QuestionProcessor';
import { SensitiveWordFilter } from './SensitiveWordFilter';
import { LocalKeywordRetriever } from './LocalKeywordRetriever';
import { RuleBasedLLM } from './RuleBasedLLM';

export class AnswerGenerator {
  private documentManager: DocumentManager;
  private questionProcessor: QuestionProcessor;
  private sensitiveFilter: SensitiveWordFilter;
  private retriever: Retriever;
  private llm: LLM;
  private noAnswerMessage: string;
  private blockedMessage: string;
  private scopeEmptyMessage: string;
  private enableStepTracing: boolean;

  constructor(
    documentManager: DocumentManager,
    questionProcessor: QuestionProcessor,
    sensitiveFilter: SensitiveWordFilter,
    options?: {
      noAnswerMessage?: string;
      blockedMessage?: string;
      scopeEmptyMessage?: string;
      retriever?: Retriever;
      llm?: LLM;
      enableStepTracing?: boolean;
    }
  ) {
    this.documentManager = documentManager;
    this.questionProcessor = questionProcessor;
    this.sensitiveFilter = sensitiveFilter;
    this.retriever = options?.retriever || new LocalKeywordRetriever();
    this.llm = options?.llm || new RuleBasedLLM();
    this.noAnswerMessage = options?.noAnswerMessage || '抱歉，根据现有知识库内容，暂时无法找到与您问题相关的答案。建议您尝试更换关键词，或查看其他分类的内容。';
    this.blockedMessage = options?.blockedMessage || '您的问题包含敏感内容，请修改后重新提问。';
    this.scopeEmptyMessage = options?.scopeEmptyMessage || '抱歉，您指定的知识范围内暂无相关内容。';
    this.enableStepTracing = options?.enableStepTracing || false;
  }

  setRetriever(retriever: Retriever): void {
    this.retriever = retriever;
  }

  setLLM(llm: LLM): void {
    this.llm = llm;
  }

  setEnableStepTracing(enable: boolean): void {
    this.enableStepTracing = enable;
  }

  async generate(request: AnswerGenerateRequest): Promise<AnswerGenerateResult> {
    const overallStartTime = Date.now();
    const questionId = generateId('q');
    const sessionId = request.sessionId || generateId('sess');
    const traceSteps = request.traceSteps ?? this.enableStepTracing;
    const steps: ProcessingStep[] = [];

    const stepStart = (name: string, detail?: Record<string, any>) => {
      if (traceSteps) {
        steps.push({ name, status: 'start', duration: 0, detail });
      }
      return { name, startTime: Date.now() };
    };

    const stepEnd = (stepInfo: { name: string; startTime: number }, detail?: Record<string, any>) => {
      if (traceSteps) {
        const existingStep = steps.find(s => s.name === stepInfo.name && s.status === 'start');
        if (existingStep) {
          existingStep.status = 'end';
          existingStep.duration = Date.now() - stepInfo.startTime;
          existingStep.detail = { ...existingStep.detail, ...detail };
        }
      }
    };

    const stepError = (stepInfo: { name: string; startTime: number }, detail?: Record<string, any>) => {
      if (traceSteps) {
        const existingStep = steps.find(s => s.name === stepInfo.name && s.status === 'start');
        if (existingStep) {
          existingStep.status = 'error';
          existingStep.duration = Date.now() - stepInfo.startTime;
          existingStep.detail = { ...existingStep.detail, ...detail };
        }
      }
    };

    try {
      const sensitiveStep = stepStart('sensitive_check', { question: request.question.slice(0, 50) });
      const sensitiveCheck = this.sensitiveFilter.check(request.question);
      if (sensitiveCheck.shouldBlock) {
        stepEnd(sensitiveStep, { blocked: true, matched: sensitiveCheck.matchedWords });
        return {
          status: 'blocked',
          answer: this.blockedMessage,
          citations: [],
          questionId,
          sessionId,
          message: `检测到敏感词：${sensitiveCheck.matchedWords.join('、')}`,
          processingTime: Date.now() - overallStartTime,
          steps: traceSteps ? steps : undefined,
        };
      }
      stepEnd(sensitiveStep, { blocked: false, matched: sensitiveCheck.matchedWords });

      const scopeStep = stepStart('scope_validation');
      const effectiveScope: KnowledgeScope = request.scope || {
        tenantId: this.documentManager.getDefaultTenantId(),
        strictMode: true,
        includeSubCategories: true,
      };

      const scopeValidation = this.documentManager.validateScope(effectiveScope);
      stepEnd(scopeStep, {
        tenantId: effectiveScope.tenantId,
        categoryIds: effectiveScope.categoryIds,
        validCategories: scopeValidation.validCategoryIds,
        invalidCategories: scopeValidation.invalidCategoryIds,
        isEmpty: scopeValidation.isEmpty,
        availableChunks: scopeValidation.availableChunkCount,
        strictMode: effectiveScope.strictMode,
      });

      if (scopeValidation.isEmpty && effectiveScope.strictMode) {
        return {
          status: 'scope_empty',
          answer: this.scopeEmptyMessage + (scopeValidation.message ? `（${scopeValidation.message}）` : ''),
          citations: [],
          questionId,
          sessionId,
          message: scopeValidation.message,
          processingTime: Date.now() - overallStartTime,
          retrieval: {
            chunksFound: 0,
            chunksUsed: 0,
            retrievalTime: 0,
            method: this.retriever.name,
            scopeEmpty: true,
            scopeDetails: {
              tenantId: effectiveScope.tenantId,
              categoryIds: effectiveScope.categoryIds,
              validCategories: scopeValidation.validCategoryIds,
              invalidCategories: scopeValidation.invalidCategoryIds,
            },
          },
          steps: traceSteps ? steps : undefined,
        };
      }

      const rewriteStep = stepStart('question_rewrite');
      const rewriteResult = this.questionProcessor.rewrite({
        question: request.question,
        type: 'expand',
      });
      stepEnd(rewriteStep, {
        original: request.question,
        rewritten: rewriteResult.rewritten,
        variantCount: rewriteResult.variants.length,
      });

      const similarStep = stepStart('similar_question_search');
      const similarResult = this.questionProcessor.findSimilar({
        question: request.question,
        scope: effectiveScope,
        threshold: 0.8,
        topK: 3,
      });
      stepEnd(similarStep, {
        hasMatch: similarResult.hasMatch,
        bestMatchSimilarity: similarResult.bestMatch?.similarity,
        candidateCount: similarResult.candidates.length,
      });

      if (similarResult.hasMatch && similarResult.bestMatch) {
        const answerStep = stepStart('answer_from_similar_qa', {
          questionId: similarResult.bestMatch.questionId,
          similarity: similarResult.bestMatch.similarity,
        });
        const answer = similarResult.bestMatch.answer;
        stepEnd(answerStep, { answerLength: answer.length });

        const relatedQuestions = similarResult.candidates.slice(1, 4).map(c => c.question);

        return {
          status: 'success',
          answer,
          citations: [],
          questionId,
          sessionId,
          relatedQuestions: relatedQuestions.length > 0 ? relatedQuestions : undefined,
          processingTime: Date.now() - overallStartTime,
          retrieval: {
            chunksFound: 0,
            chunksUsed: 0,
            retrievalTime: similarResult.processingTime,
            method: 'similar_qa_match',
            scopeDetails: {
              tenantId: effectiveScope.tenantId,
              categoryIds: effectiveScope.categoryIds,
              validCategories: scopeValidation.validCategoryIds,
              invalidCategories: scopeValidation.invalidCategoryIds,
            },
          },
          steps: traceSteps ? steps : undefined,
        };
      }

      const retrieveStep = stepStart('retrieval', {
        queries: [request.question, rewriteResult.rewritten].slice(0, 2),
        scope: effectiveScope,
        topK: request.maxCitations || 10,
      });

      const searchQueries = [request.question, rewriteResult.rewritten, ...rewriteResult.variants.slice(0, 2)];
      const allCitations: Map<string, { chunk: CitationChunk; score: number }> = new Map();
      let totalRetrievalTime = 0;

      for (const query of searchQueries) {
        const retrieveResult: RetrieveResult = await this.retriever.retrieve({
          query,
          scope: effectiveScope,
          topK: request.maxCitations || 10,
        });
        totalRetrievalTime += retrieveResult.retrievalTime;

        for (const cit of retrieveResult.chunks) {
          const existing = allCitations.get(cit.id);
          if (!existing || existing.score < cit.relevance) {
            allCitations.set(cit.id, { chunk: cit, score: cit.relevance });
          }
        }
      }

      const sortedCitations = Array.from(allCitations.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, request.maxCitations || 5);

      const finalCitations: CitationChunk[] = sortedCitations.map(item => item.chunk);

      stepEnd(retrieveStep, {
        totalFound: allCitations.size,
        usedCount: finalCitations.length,
        topScore: finalCitations[0]?.relevance || 0,
        retrievalTimeMs: totalRetrievalTime,
      });

      if (finalCitations.length === 0 || finalCitations[0].relevance < 0.15) {
        const relatedStep = stepStart('related_questions_suggestion');
        const relatedQuestions = this.suggestRelatedQuestions(request.question, effectiveScope);
        stepEnd(relatedStep, { count: relatedQuestions.length });

        return {
          status: 'no_answer',
          answer: this.noAnswerMessage,
          citations: [],
          questionId,
          sessionId,
          relatedQuestions: relatedQuestions.length > 0 ? relatedQuestions : undefined,
          processingTime: Date.now() - overallStartTime,
          retrieval: {
            chunksFound: allCitations.size,
            chunksUsed: 0,
            retrievalTime: totalRetrievalTime,
            method: this.retriever.name,
            scopeDetails: {
              tenantId: effectiveScope.tenantId,
              categoryIds: effectiveScope.categoryIds,
              validCategories: scopeValidation.validCategoryIds,
              invalidCategories: scopeValidation.invalidCategoryIds,
            },
          },
          steps: traceSteps ? steps : undefined,
        };
      }

      const llmStep = stepStart('llm_generate', {
        citationsCount: finalCitations.length,
        style: request.answerStyle || 'standard',
      });

      const llmResult: LLMResult = await this.llm.generate({
        question: request.question,
        context: finalCitations.map(c => c.content).join('\n\n'),
        citations: finalCitations,
        style: request.answerStyle || 'standard',
      });

      stepEnd(llmStep, {
        tokensInput: llmResult.tokensInput,
        tokensOutput: llmResult.tokensOutput,
        timeMs: llmResult.llmTime,
        model: llmResult.modelName,
        answerLength: llmResult.answer.length,
      });

      const answerSensitiveCheck = this.sensitiveFilter.check(llmResult.answer);
      let answer = llmResult.answer;
      if (answerSensitiveCheck.hasSensitive) {
        answer = answerSensitiveCheck.filteredText;
      }

      const relatedStep = stepStart('related_questions_suggestion');
      const relatedQuestions = similarResult.candidates
        .slice(0, 3)
        .map(c => c.question)
        .filter(q => q !== request.question);
      stepEnd(relatedStep, { count: relatedQuestions.length });

      return {
        status: 'success',
        answer,
        citations: finalCitations,
        questionId,
        sessionId,
        relatedQuestions: relatedQuestions.length > 0 ? relatedQuestions : undefined,
        processingTime: Date.now() - overallStartTime,
        retrieval: {
          chunksFound: allCitations.size,
          chunksUsed: finalCitations.length,
          retrievalTime: totalRetrievalTime,
          method: this.retriever.name,
          scopeDetails: {
            tenantId: effectiveScope.tenantId,
            categoryIds: effectiveScope.categoryIds,
            validCategories: scopeValidation.validCategoryIds,
            invalidCategories: scopeValidation.invalidCategoryIds,
          },
        },
        llm: {
          model: llmResult.modelName,
          timeMs: llmResult.llmTime,
          tokensInput: llmResult.tokensInput,
          tokensOutput: llmResult.tokensOutput,
        },
        steps: traceSteps ? steps : undefined,
      };
    } catch (error) {
      return {
        status: 'error',
        answer: '系统处理时发生错误，请稍后重试。',
        citations: [],
        questionId,
        sessionId,
        message: error instanceof Error ? error.message : '未知错误',
        processingTime: Date.now() - overallStartTime,
        steps: traceSteps ? steps : undefined,
      };
    }
  }

  private suggestRelatedQuestions(question: string, scope: KnowledgeScope): string[] {
    const similar = this.questionProcessor.findSimilar({
      question,
      topK: 5,
      threshold: 0.3,
      scope,
    });

    return similar.candidates.map(c => c.question).slice(0, 3);
  }

  setNoAnswerMessage(message: string): void {
    this.noAnswerMessage = message;
  }

  setBlockedMessage(message: string): void {
    this.blockedMessage = message;
  }

  setScopeEmptyMessage(message: string): void {
    this.scopeEmptyMessage = message;
  }
}
