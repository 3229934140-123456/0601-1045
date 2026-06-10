import {
  QuestionRewriteRequest,
  QuestionRewriteResult,
  QuestionRewriteType,
  SimilarQuestion,
  SimilarQuestionRequest,
  SimilarQuestionResult,
  KnowledgeScope,
  FAQItem,
} from '../types';
import { generateId, normalizeText, textSimilarity } from '../utils';

interface QAPair {
  id: string;
  question: string;
  answer: string;
  category: string;
  categoryId: string;
  tenantId: string;
  tags: string[];
  normalizedQuestion: string;
  usageCount: number;
  directQuestionCount: number;
  similarMatchCount: number;
  pinned: boolean;
  pinnedWeight: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export class QuestionProcessor {
  private qaPairs: QAPair[] = [];
  private defaultThreshold: number = 0.75;
  private defaultWeights = {
    pinned: 0.4,
    directQuestion: 0.3,
    similarMatch: 0.2,
    usage: 0.05,
    recency: 0.05,
  };

  addQA(
    question: string,
    answer: string,
    category: string = 'cat_default',
    options?: {
      tenantId?: string;
      categoryId?: string;
      tags?: string[];
    }
  ): string {
    const now = Date.now();
    const pair: QAPair = {
      id: generateId('qa'),
      question,
      answer,
      category,
      categoryId: options?.categoryId || category,
      tenantId: options?.tenantId || 'default',
      tags: options?.tags || [],
      normalizedQuestion: normalizeText(question),
      usageCount: 0,
      directQuestionCount: 0,
      similarMatchCount: 0,
      pinned: false,
      pinnedWeight: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.qaPairs.push(pair);
    return pair.id;
  }

  batchAddQA(
    items: Array<{
      question: string;
      answer: string;
      category?: string;
      tenantId?: string;
      categoryId?: string;
      tags?: string[];
    }>
  ): string[] {
    return items.map(item =>
      this.addQA(item.question, item.answer, item.category, {
        tenantId: item.tenantId,
        categoryId: item.categoryId,
        tags: item.tags,
      })
    );
  }

  removeQA(qaId: string): boolean {
    const index = this.qaPairs.findIndex(p => p.id === qaId);
    if (index === -1) return false;
    this.qaPairs.splice(index, 1);
    return true;
  }

  listQA(category?: string): QAPair[] {
    if (!category) return this.qaPairs;
    return this.qaPairs.filter(p => p.category === category);
  }

  private filterByScope(pairs: QAPair[], scope?: KnowledgeScope): QAPair[] {
    if (!scope) return pairs;

    let filtered = [...pairs];

    if (scope.tenantId) {
      filtered = filtered.filter(p => p.tenantId === scope.tenantId);
    }

    if (scope.categoryIds && scope.categoryIds.length > 0) {
      filtered = filtered.filter(p =>
        scope.categoryIds!.includes(p.categoryId) ||
        scope.categoryIds!.includes(p.category)
      );
    }

    if (scope.tagIds && scope.tagIds.length > 0) {
      if (scope.strictMode) {
        filtered = filtered.filter(p =>
          scope.tagIds!.every(tagId => p.tags.includes(tagId))
        );
      } else {
        filtered = filtered.filter(p =>
          scope.tagIds!.some(tagId => p.tags.includes(tagId))
        );
      }
    }

    return filtered;
  }

  private calculateFAQScore(pair: QAPair): number {
    const now = Date.now();
    const recencyScore = pair.lastUsedAt
      ? Math.max(0, 1 - (now - pair.lastUsedAt) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    const score =
      pair.pinnedWeight * this.defaultWeights.pinned +
      pair.directQuestionCount * this.defaultWeights.directQuestion +
      pair.similarMatchCount * this.defaultWeights.similarMatch +
      pair.usageCount * this.defaultWeights.usage +
      recencyScore * this.defaultWeights.recency;

    return score;
  }

  rewrite(request: QuestionRewriteRequest): QuestionRewriteResult {
    const { question, type = 'standard', context } = request;
    const variants: string[] = [];
    let rewritten = question;

    switch (type) {
      case 'expand':
        rewritten = this.expandQuestion(question, context);
        variants.push(...this.generateExpandedVariants(question, context));
        break;

      case 'simplify':
        rewritten = this.simplifyQuestion(question);
        variants.push(...this.generateSimplifiedVariants(question));
        break;

      case 'standard':
      default:
        rewritten = this.standardRewrite(question, context);
        variants.push(...this.generateStandardVariants(question));
        break;
    }

    variants.push(...this.generateCommonVariants(question));
    const uniqueVariants = Array.from(new Set([rewritten, ...variants]))
      .filter(v => v && v !== question)
      .slice(0, 5);

    return {
      original: question,
      rewritten,
      variants: uniqueVariants,
      type,
    };
  }

  findSimilar(request: SimilarQuestionRequest): SimilarQuestionResult {
    const startTime = Date.now();
    const { question, topK = 5, threshold = this.defaultThreshold, scope } = request;
    const normalizedQuery = normalizeText(question);

    let candidates = this.filterByScope(this.qaPairs, scope);

    const results: Array<{ pair: QAPair; similarity: number }> = [];

    for (const pair of candidates) {
      const sim = textSimilarity(normalizedQuery, pair.normalizedQuestion);
      if (sim >= threshold * 0.5) {
        results.push({ pair, similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    const topResults = results.slice(0, topK);

    for (const item of topResults) {
      item.pair.usageCount++;
      item.pair.similarMatchCount++;
      item.pair.lastUsedAt = Date.now();
      item.pair.updatedAt = Date.now();
    }

    const similarQuestions: SimilarQuestion[] = topResults.map(item => ({
      questionId: item.pair.id,
      question: item.pair.question,
      answer: item.pair.answer,
      similarity: item.similarity,
      categoryId: item.pair.categoryId,
    }));

    const bestMatch = similarQuestions[0];
    const hasMatch = bestMatch ? bestMatch.similarity >= threshold : false;
    const processingTime = Date.now() - startTime;

    return {
      hasMatch,
      bestMatch: hasMatch ? bestMatch : undefined,
      candidates: similarQuestions,
      processingTime,
    };
  }

  getFAQ(scopeOrCategory?: KnowledgeScope | string, limit: number = 10): SimilarQuestion[] {
    let list = [...this.qaPairs];

    if (typeof scopeOrCategory === 'string') {
      list = list.filter(p => p.category === scopeOrCategory || p.categoryId === scopeOrCategory);
    } else if (scopeOrCategory) {
      list = this.filterByScope(list, scopeOrCategory);
    }

    list.sort((a, b) => this.calculateFAQScore(b) - this.calculateFAQScore(a));

    return list.slice(0, limit).map(p => ({
      questionId: p.id,
      question: p.question,
      answer: p.answer,
      similarity: 1,
      categoryId: p.categoryId,
    }));
  }

  getFAQItems(scope?: KnowledgeScope, limit: number = 10): FAQItem[] {
    let list = [...this.qaPairs];

    if (scope) {
      list = this.filterByScope(list, scope);
    }

    list.sort((a, b) => this.calculateFAQScore(b) - this.calculateFAQScore(a));

    return list.slice(0, limit).map(p => ({
      id: p.id,
      question: p.question,
      answer: p.answer,
      tenantId: p.tenantId,
      categoryId: p.categoryId,
      tags: p.tags,
      usageCount: p.usageCount,
      directQuestionCount: p.directQuestionCount,
      similarMatchCount: p.similarMatchCount,
      pinned: p.pinned,
      pinnedWeight: p.pinnedWeight,
      lastUsedAt: p.lastUsedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  incrementDirectQuestion(questionId: string): boolean {
    const pair = this.qaPairs.find(p => p.id === questionId);
    if (!pair) return false;
    pair.directQuestionCount++;
    pair.usageCount++;
    pair.lastUsedAt = Date.now();
    pair.updatedAt = Date.now();
    return true;
  }

  incrementSimilarMatch(questionId: string): boolean {
    const pair = this.qaPairs.find(p => p.id === questionId);
    if (!pair) return false;
    pair.similarMatchCount++;
    pair.usageCount++;
    pair.lastUsedAt = Date.now();
    pair.updatedAt = Date.now();
    return true;
  }

  setPinned(questionId: string, pinned: boolean, weight?: number): boolean {
    const pair = this.qaPairs.find(p => p.id === questionId);
    if (!pair) return false;
    pair.pinned = pinned;
    if (weight !== undefined) {
      pair.pinnedWeight = Math.max(0, Math.min(1, weight));
    } else if (pinned && pair.pinnedWeight === 0) {
      pair.pinnedWeight = 0.5;
    } else if (!pinned) {
      pair.pinnedWeight = 0;
    }
    pair.updatedAt = Date.now();
    return true;
  }

  private standardRewrite(question: string, context?: string): string {
    let result = question.trim();

    result = result.replace(/[？?]+$/, '');
    result = result.replace(/[，,]$/, '');
    result = result.replace(/^(请问|麻烦问一下|我想问一下|请教一下|想问下|请问一下)/, '');
    result = result.replace(/(呢|啊|呀|哦|吧)$/g, '');
    result = result.trim();

    if (context) {
      const shortContext = this.extractContextKeywords(context);
      if (!this.containsContext(result, shortContext)) {
        result = `${shortContext}，${result}`;
      }
    }

    if (!/[？?]$/.test(result) && !/[。.]$/.test(result)) {
      result = result + '？';
    }

    return result;
  }

  private expandQuestion(question: string, context?: string): string {
    let result = question.trim();

    if (context && context.length > 0) {
      const contextParts = context.split(/[，,。.\n]/).filter(p => p.trim());
      const relevantContext = contextParts.slice(0, 2).join('，');
      if (relevantContext && !result.includes(relevantContext.slice(0, 5))) {
        result = `关于${relevantContext}，${result}`;
      }
    }

    if (!/^(什么是|什么叫|怎么|如何|为什么|请问)/.test(result)) {
      result = `请问${result}`;
    }

    return result;
  }

  private simplifyQuestion(question: string): string {
    let result = question.trim();

    const fillers = ['请问', '我想请问一下', '麻烦问一下', '我想问一下', '我想咨询一下',
      '请教一下', '想了解一下', '可以告诉我', '能不能告诉我'];
    for (const filler of fillers) {
      result = result.replace(new RegExp(`^${filler}`), '');
    }

    const stopWords = ['呢', '啊', '呀', '哦', '吧', '哈', '嘛'];
    for (const word of stopWords) {
      result = result.replace(new RegExp(`${word}[？?]?$`), '');
    }

    result = result.replace(/[？?。.]/g, '');
    result = result.trim();

    return result;
  }

  private generateStandardVariants(question: string): string[] {
    const variants: string[] = [];
    const base = question.replace(/[？?]$/, '').trim();

    variants.push(`什么是${base}？`);
    variants.push(`${base}是什么意思？`);
    variants.push(`如何理解${base}？`);
    variants.push(`请问${base}？`);

    return variants;
  }

  private generateExpandedVariants(question: string, context?: string): string[] {
    const variants: string[] = [];
    const base = question.replace(/[？?]$/, '').trim();

    variants.push(`关于"${base}"，详细说明一下？`);
    variants.push(`${base}这个问题，请详细解释？`);
    if (context) {
      variants.push(`在${context.slice(0, 10)}的前提下，${base}？`);
    }

    return variants;
  }

  private generateSimplifiedVariants(question: string): string[] {
    const variants: string[] = [];
    const base = question.replace(/[？?。.，,]/g, '').trim();

    if (base.length > 4) {
      variants.push(base.slice(0, Math.ceil(base.length * 0.6)));
    }
    variants.push(base);

    return variants;
  }

  private generateCommonVariants(question: string): string[] {
    const variants: string[] = [];
    const normalized = normalizeText(question);

    const synonymMap: Array<[RegExp, string[]]> = [
      [/(如何|怎么|怎样)/g, ['如何', '怎么', '怎样']],
      [/(什么|啥)/g, ['什么', '啥']],
      [/(为什么|为何|为啥)/g, ['为什么', '为何', '为啥']],
      [/(可以|能够|能)/g, ['可以', '能够', '能']],
      [/(多少|几)/g, ['多少', '几']],
    ];

    for (const [pattern, synonyms] of synonymMap) {
      for (const syn of synonyms) {
        const variant = normalized.replace(pattern, syn);
        if (variant !== normalized && variant.length > 0) {
          variants.push(variant);
        }
      }
    }

    return variants.slice(0, 3);
  }

  private extractContextKeywords(context: string): string {
    const sentences = context.split(/[。！？.!?\n]/).filter(s => s.trim());
    if (sentences.length === 0) return context.slice(0, 20);

    const firstSentence = sentences[0].trim();
    return firstSentence.slice(0, 30);
  }

  private containsContext(question: string, context: string): boolean {
    const normQ = normalizeText(question);
    const normC = normalizeText(context).slice(0, 10);
    return normC.length > 0 && normQ.includes(normC);
  }

  setDefaultThreshold(threshold: number): void {
    this.defaultThreshold = Math.max(0.1, Math.min(1, threshold));
  }

  getQaCount(): number {
    return this.qaPairs.length;
  }

  getPairById(questionId: string): QAPair | undefined {
    return this.qaPairs.find(p => p.id === questionId);
  }
}
