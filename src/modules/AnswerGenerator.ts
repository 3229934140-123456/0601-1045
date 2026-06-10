import {
  AnswerGenerateRequest,
  AnswerGenerateResult,
  AnswerStatus,
  CitationChunk,
} from '../types';
import { generateId, textSimilarity, keywordMatchScore, normalizeText } from '../utils';
import { DocumentManager } from './DocumentManager';
import { QuestionProcessor } from './QuestionProcessor';
import { SensitiveWordFilter } from './SensitiveWordFilter';

export class AnswerGenerator {
  private documentManager: DocumentManager;
  private questionProcessor: QuestionProcessor;
  private sensitiveFilter: SensitiveWordFilter;
  private noAnswerMessage: string;
  private blockedMessage: string;

  constructor(
    documentManager: DocumentManager,
    questionProcessor: QuestionProcessor,
    sensitiveFilter: SensitiveWordFilter,
    options?: {
      noAnswerMessage?: string;
      blockedMessage?: string;
    }
  ) {
    this.documentManager = documentManager;
    this.questionProcessor = questionProcessor;
    this.sensitiveFilter = sensitiveFilter;
    this.noAnswerMessage = options?.noAnswerMessage || '抱歉，根据现有知识库内容，暂时无法找到与您问题相关的答案。建议您尝试更换关键词，或查看其他分类的内容。';
    this.blockedMessage = options?.blockedMessage || '您的问题包含敏感内容，请修改后重新提问。';
  }

  async generate(request: AnswerGenerateRequest): Promise<AnswerGenerateResult> {
    const startTime = Date.now();
    const questionId = generateId('q');
    const sessionId = request.sessionId || generateId('sess');

    try {
      const sensitiveCheck = this.sensitiveFilter.check(request.question);
      if (sensitiveCheck.shouldBlock) {
        return {
          status: 'blocked',
          answer: this.blockedMessage,
          citations: [],
          questionId,
          sessionId,
          message: `检测到敏感词：${sensitiveCheck.matchedWords.join('、')}`,
          processingTime: Date.now() - startTime,
        };
      }

      const rewriteResult = this.questionProcessor.rewrite({
        question: request.question,
        type: 'expand',
      });

      const searchQueries = [request.question, rewriteResult.rewritten, ...rewriteResult.variants];
      const allCitations: Map<string, { chunk: any; score: number }> = new Map();

      for (const query of searchQueries) {
        const results = this.documentManager.searchChunks(
          query,
          request.categories,
          request.maxCitations || 10
        );
        for (const r of results) {
          const existing = allCitations.get(r.chunk.id);
          if (!existing || existing.score < r.score) {
            allCitations.set(r.chunk.id, r);
          }
        }
      }

      const sortedCitations = Array.from(allCitations.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, request.maxCitations || 5);

      const similarResult = this.questionProcessor.findSimilar({
        question: request.question,
        categories: request.categories,
        threshold: 0.8,
        topK: 3,
      });

      let answer = '';
      let finalCitations: CitationChunk[] = [];

      if (similarResult.hasMatch && similarResult.bestMatch) {
        answer = similarResult.bestMatch.answer;
        finalCitations = [];
      } else if (sortedCitations.length > 0 && sortedCitations[0].score >= 0.15) {
        const topChunks = sortedCitations.slice(0, 3);
        answer = this.composeAnswer(request.question, topChunks, request.answerStyle || 'standard');
        finalCitations = topChunks.map(item => ({
          id: item.chunk.id,
          content: item.chunk.content,
          category: item.chunk.category,
          relevance: item.score,
          metadata: item.chunk.metadata,
        }));
      } else {
        return {
          status: 'no_answer',
          answer: this.noAnswerMessage,
          citations: [],
          questionId,
          sessionId,
          relatedQuestions: this.suggestRelatedQuestions(request.question, request.categories),
          processingTime: Date.now() - startTime,
        };
      }

      const answerSensitiveCheck = this.sensitiveFilter.check(answer);
      if (answerSensitiveCheck.hasSensitive) {
        answer = answerSensitiveCheck.filteredText;
      }

      const relatedQuestions = similarResult.hasMatch
        ? similarResult.candidates.slice(1, 4).map(c => c.question)
        : this.suggestRelatedQuestions(request.question, request.categories);

      return {
        status: 'success',
        answer,
        citations: finalCitations,
        questionId,
        sessionId,
        relatedQuestions: relatedQuestions.length > 0 ? relatedQuestions : undefined,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'error',
        answer: '系统处理时发生错误，请稍后重试。',
        citations: [],
        questionId,
        sessionId,
        message: error instanceof Error ? error.message : '未知错误',
        processingTime: Date.now() - startTime,
      };
    }
  }

  private composeAnswer(
    question: string,
    sources: Array<{ chunk: any; score: number }>,
    style: 'brief' | 'detailed' | 'standard'
  ): string {
    if (sources.length === 0) {
      return '';
    }

    const questionNorm = normalizeText(question);
    const sentences: string[] = [];
    const usedSentences = new Set<string>();

    for (const source of sources) {
      const content = source.chunk.content;
      const rawSentences: string[] = content.split(/(?<=[。！？.!?；;])/).filter((s: string) => s.trim());

      const scoredSentences = rawSentences.map((s: string) => ({
        text: s.trim(),
        score: keywordMatchScore(s, question),
      }));

      scoredSentences.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      const topSentences = style === 'brief'
        ? scoredSentences.slice(0, 1)
        : style === 'detailed'
        ? scoredSentences.filter((s: { score: number }) => s.score > 0).slice(0, 5)
        : scoredSentences.filter((s: { score: number }) => s.score > 0).slice(0, 3);

      for (const ss of topSentences) {
        const key = ss.text.slice(0, 20);
        if (!usedSentences.has(key)) {
          usedSentences.add(key);
          sentences.push(ss.text);
        }
      }
    }

    let answer = sentences.join('');

    if (style === 'brief' && answer.length > 100) {
      answer = answer.slice(0, 100) + '...';
    }

    if (!answer.endsWith('。') && !answer.endsWith('！') && !answer.endsWith('？')) {
      answer += '。';
    }

    if (style === 'detailed' && sources.length > 0) {
      const categoryName = sources[0].chunk.category || '知识库';
      answer = `根据${categoryName}中的资料：\n${answer}`;
    } else if (style === 'standard') {
      answer = `根据知识库资料：${answer}`;
    }

    return answer;
  }

  private suggestRelatedQuestions(question: string, categories?: string[]): string[] {
    const similar = this.questionProcessor.findSimilar({
      question,
      topK: 5,
      threshold: 0.3,
      categories,
    });

    return similar.candidates.map(c => c.question).slice(0, 3);
  }

  setNoAnswerMessage(message: string): void {
    this.noAnswerMessage = message;
  }

  setBlockedMessage(message: string): void {
    this.blockedMessage = message;
  }
}
