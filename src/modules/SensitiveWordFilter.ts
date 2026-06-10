import { SensitiveWordConfig, SensitiveCheckResult } from '../types';

const DEFAULT_SENSITIVE_WORDS: string[] = [
  '违禁词示例',
  '违法内容',
  '暴力',
  '色情',
  '赌博',
  '毒品',
  '诈骗',
];

export class SensitiveWordFilter {
  private config: SensitiveWordConfig;
  private trie: Map<string, any> = new Map();

  constructor(config?: Partial<SensitiveWordConfig>) {
    this.config = {
      words: DEFAULT_SENSITIVE_WORDS,
      replacement: '***',
      enableBlock: true,
      customPatterns: [],
      ...config,
    };
    this.buildTrie();
  }

  private buildTrie(): void {
    this.trie.clear();
    for (const word of this.config.words) {
      if (!word) continue;
      let node = this.trie;
      for (const char of word) {
        if (!node.has(char)) {
          node.set(char, new Map());
        }
        node = node.get(char);
      }
      node.set('__end__', true);
    }
  }

  addWords(words: string[]): void {
    for (const word of words) {
      if (!this.config.words.includes(word)) {
        this.config.words.push(word);
      }
    }
    this.buildTrie();
  }

  removeWords(words: string[]): void {
    this.config.words = this.config.words.filter(w => !words.includes(w));
    this.buildTrie();
  }

  clearWords(): void {
    this.config.words = [];
    this.buildTrie();
  }

  setConfig(config: Partial<SensitiveWordConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.words) {
      this.buildTrie();
    }
  }

  getConfig(): SensitiveWordConfig {
    return { ...this.config };
  }

  check(text: string): SensitiveCheckResult {
    const matchedWords: string[] = [];
    let filteredText = text;

    for (const word of this.config.words) {
      if (word && text.includes(word)) {
        if (!matchedWords.includes(word)) {
          matchedWords.push(word);
        }
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filteredText = filteredText.replace(new RegExp(escapedWord, 'g'), this.config.replacement || '***');
      }
    }

    if (this.config.customPatterns) {
      for (const pattern of this.config.customPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          for (const m of matches) {
            if (!matchedWords.includes(m)) {
              matchedWords.push(m);
            }
          }
          filteredText = filteredText.replace(pattern, this.config.replacement || '***');
        }
      }
    }

    const hasSensitive = matchedWords.length > 0;
    const shouldBlock = hasSensitive && this.config.enableBlock === true;

    return {
      hasSensitive,
      matchedWords,
      filteredText,
      shouldBlock,
    };
  }

  checkWithTrie(text: string): SensitiveCheckResult {
    const matchedWords: string[] = [];
    let filteredText = text;

    let i = 0;
    while (i < text.length) {
      let node = this.trie;
      let j = i;
      let matched = '';
      let foundEnd = false;

      while (j < text.length && node.has(text[j])) {
        node = node.get(text[j]);
        matched += text[j];
        if (node.get('__end__')) {
          foundEnd = true;
          break;
        }
        j++;
      }

      if (foundEnd && matched.length > 0) {
        if (!matchedWords.includes(matched)) {
          matchedWords.push(matched);
        }
        filteredText = filteredText.substring(0, i) +
          (this.config.replacement || '***') +
          filteredText.substring(i + matched.length);
        i += matched.length;
      } else {
        i++;
      }
    }

    const hasSensitive = matchedWords.length > 0;
    const shouldBlock = hasSensitive && this.config.enableBlock === true;

    return {
      hasSensitive,
      matchedWords,
      filteredText,
      shouldBlock,
    };
  }
}
