export function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

export function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  if (!text || text.length <= chunkSize) {
    return text ? [text] : [];
  }

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[。！？.!?\n])/).filter(s => s.trim());

  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      if (overlap > 0 && chunks.length > 0) {
        const prevChunk = chunks[chunks.length - 1];
        const overlapText = prevChunk.slice(-overlap);
        currentChunk = overlapText + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？、；：""''（）《》【】,.!?;:""'()<>[\]]/g, '')
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function textSimilarity(textA: string, textB: string): number {
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const editDistance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  const editSim = maxLen > 0 ? 1 - editDistance / maxLen : 0;

  const setA = new Set(normA.split(''));
  const setB = new Set(normB.split(''));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  const jaccardSim = union.size > 0 ? intersection.size / union.size : 0;

  const wordsA = extractKeywords(normA);
  const wordsB = extractKeywords(normB);
  let commonWords = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) commonWords++;
  }
  const totalWords = wordsA.size + wordsB.size - commonWords;
  const keywordSim = totalWords > 0 ? commonWords / totalWords : 0;

  return (editSim * 0.3 + jaccardSim * 0.3 + keywordSim * 0.4);
}

export function extractKeywords(text: string, minLength: number = 2): Set<string> {
  const keywords = new Set<string>();
  const normalized = normalizeText(text);

  if (normalized.length < minLength) return keywords;

  for (let len = minLength; len <= Math.min(4, normalized.length); len++) {
    for (let i = 0; i <= normalized.length - len; i++) {
      const word = normalized.slice(i, i + len);
      keywords.add(word);
    }
  }

  return keywords;
}

export function keywordMatchScore(text: string, question: string): number {
  const textKeywords = extractKeywords(text, 2);
  const questionKeywords = extractKeywords(question, 2);

  if (questionKeywords.size === 0) return 0;

  let matchCount = 0;
  for (const qk of questionKeywords) {
    for (const tk of textKeywords) {
      if (tk.includes(qk) || qk.includes(tk)) {
        matchCount++;
        break;
      }
    }
  }

  return matchCount / questionKeywords.size;
}

export function formatDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
