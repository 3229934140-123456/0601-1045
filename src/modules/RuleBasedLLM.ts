import {
  LLM,
  LLMGenerateRequest,
  LLMResult,
  CitationChunk,
} from '../types';
import { keywordMatchScore, normalizeText } from '../utils';

export class RuleBasedLLM implements LLM {
  public name = 'RuleBasedLLM';
  private modelName = 'rule-based-v1';

  async generate(request: LLMGenerateRequest): Promise<LLMResult> {
    const startTime = Date.now();
    const { question, citations, style = 'standard', history } = request;

    const contextText = this.buildContext(citations, style);
    const answer = this.composeAnswer(question, citations, style, history);

    const tokensInput = question.length + contextText.length + (history?.length || 0);
    const tokensOutput = answer.length;

    return {
      answer,
      llmTime: Date.now() - startTime,
      modelName: this.modelName,
      tokensInput,
      tokensOutput,
      rawResponse: {
        style,
        citationsUsed: citations.length,
        hasHistory: !!history,
      },
    };
  }

  private buildContext(citations: CitationChunk[], style: string): string {
    const parts: string[] = [];
    const maxChunks = style === 'detailed' ? Math.min(5, citations.length) : Math.min(3, citations.length);

    for (let i = 0; i < maxChunks; i++) {
      const cit = citations[i];
      parts.push(`[资料${i + 1}] ${cit.content}`);
    }

    return parts.join('\n\n');
  }

  private composeAnswer(
    question: string,
    citations: CitationChunk[],
    style: 'brief' | 'detailed' | 'standard',
    history?: string
  ): string {
    if (citations.length === 0) {
      return '';
    }

    const questionNorm = normalizeText(question);
    const sentences: string[] = [];
    const usedKeys = new Set<string>();

    const maxCitations = style === 'detailed' ? Math.min(5, citations.length)
                       : style === 'brief' ? 1
                       : Math.min(3, citations.length);

    for (let i = 0; i < maxCitations; i++) {
      const cit = citations[i];
      const rawSentences = cit.content.split(/(?<=[。！？.!?；;])/).filter(s => s.trim());

      const scoredSentences = rawSentences.map((s: string) => ({
        text: s.trim(),
        score: keywordMatchScore(s, question),
      }));

      scoredSentences.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      const takeCount = style === 'detailed' ? 3 : style === 'brief' ? 1 : 2;
      const topSentences = scoredSentences
        .filter((s: { score: number }) => s.score > 0)
        .slice(0, takeCount);

      for (const ss of topSentences) {
        const key = ss.text.slice(0, 20);
        if (!usedKeys.has(key)) {
          usedKeys.add(key);
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

    if (style === 'detailed') {
      const prefix = `根据检索到的${citations.length}段资料：\n`;
      answer = prefix + answer;
      if (history && history.length > 0) {
        answer = '（结合上下文）' + answer;
      }
    } else if (style === 'standard') {
      answer = '根据知识库资料：' + answer;
    }

    return answer;
  }
}
