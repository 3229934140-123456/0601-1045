import {
  QuestionRewriteRequest,
  QuestionRewriteResult,
  QuestionRewriteType,
  SimilarQuestion,
  SimilarQuestionRequest,
  SimilarQuestionResult,
} from '../types';
import { generateId, normalizeText, textSimilarity } from '../utils';

interface QAPair {
  id: string;
  question: string;
  answer: string;
  category: string;
  normalizedQuestion: string;
  usageCount: number;
}

export class QuestionProcessor {
  private qaPairs: QAPair[] = [];
  private defaultThreshold: number = 0.75;

  addQA(question: string, answer: string, category: string = 'cat_default'): string {
    const pair: QAPair = {
      id: generateId('qa'),
      question,
      answer,
      category,
      normalizedQuestion: normalizeText(question),
      usageCount: 0,
    };
    this.qaPairs.push(pair);
    return pair.id;
  }

  batchAddQA(items: Array<{ question: string; answer: string; category?: string }>): string[] {
    return items.map(item => this.addQA(item.question, item.answer, item.category));
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
    const { question, topK = 5, threshold = this.defaultThreshold, categories } = request;
    const normalizedQuery = normalizeText(question);

    let candidates = this.qaPairs;
    if (categories && categories.length > 0) {
      candidates = candidates.filter(p => categories.includes(p.category));
    }

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
    }

    const similarQuestions: SimilarQuestion[] = topResults.map(item => ({
      questionId: item.pair.id,
      question: item.pair.question,
      answer: item.pair.answer,
      similarity: item.similarity,
    }));

    const bestMatch = similarQuestions[0];
    const hasMatch = bestMatch ? bestMatch.similarity >= threshold : false;

    return {
      hasMatch,
      bestMatch: hasMatch ? bestMatch : undefined,
      candidates: similarQuestions,
    };
  }

  getFAQ(category?: string, limit: number = 10): SimilarQuestion[] {
    let list = [...this.qaPairs];
    if (category) {
      list = list.filter(p => p.category === category);
    }
    list.sort((a, b) => b.usageCount - a.usageCount);
    return list.slice(0, limit).map(p => ({
      questionId: p.id,
      question: p.question,
      answer: p.answer,
      similarity: 1,
    }));
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
}
