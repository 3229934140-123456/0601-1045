import {
  Retriever,
  RetrieveRequest,
  RetrieveResult,
  DocumentChunk,
  CitationChunk,
  KnowledgeScope,
} from '../types';
import { keywordMatchScore } from '../utils';

export class LocalKeywordRetriever implements Retriever {
  public name = 'LocalKeywordRetriever';
  private chunks: Map<string, DocumentChunk> = new Map();
  private categoryIndex: Map<string, string[]> = new Map();
  private tagIndex: Map<string, string[]> = new Map();
  private categoryTree: Map<string, string[]> = new Map();

  addChunks(chunks: DocumentChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);

      if (!this.categoryIndex.has(chunk.categoryId)) {
        this.categoryIndex.set(chunk.categoryId, []);
      }
      const catChunks = this.categoryIndex.get(chunk.categoryId)!;
      if (!catChunks.includes(chunk.id)) {
        catChunks.push(chunk.id);
      }

      for (const tagId of chunk.tags) {
        if (!this.tagIndex.has(tagId)) {
          this.tagIndex.set(tagId, []);
        }
        const tagChunks = this.tagIndex.get(tagId)!;
        if (!tagChunks.includes(chunk.id)) {
          tagChunks.push(chunk.id);
        }
      }
    }
    return Promise.resolve();
  }

  removeChunks(chunkIds: string[]): Promise<void> {
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        const catChunks = this.categoryIndex.get(chunk.categoryId);
        if (catChunks) {
          const idx = catChunks.indexOf(id);
          if (idx > -1) catChunks.splice(idx, 1);
        }
        for (const tagId of chunk.tags) {
          const tagChunks = this.tagIndex.get(tagId);
          if (tagChunks) {
            const idx = tagChunks.indexOf(id);
            if (idx > -1) tagChunks.splice(idx, 1);
          }
        }
      }
      this.chunks.delete(id);
    }
    return Promise.resolve();
  }

  clear(tenantId?: string): Promise<void> {
    if (tenantId) {
      const idsToRemove: string[] = [];
      for (const chunk of this.chunks.values()) {
        if (chunk.tenantId === tenantId) {
          idsToRemove.push(chunk.id);
        }
      }
      this.removeChunks(idsToRemove);
    } else {
      this.chunks.clear();
      this.categoryIndex.clear();
      this.tagIndex.clear();
    }
    return Promise.resolve();
  }

  setCategoryTree(parentId: string, childIds: string[]): void {
    this.categoryTree.set(parentId, childIds);
  }

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    const startTime = Date.now();
    const { query, scope, topK } = request;

    const resolvedCategories = this.resolveScopeCategories(scope);

    const candidateChunks = this.getCandidateChunks(scope, resolvedCategories);

    const results: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const chunk of candidateChunks) {
      const score = keywordMatchScore(chunk.content, query);
      if (score > 0) {
        results.push({ chunk, score });
      }
    }

    results.sort((a, b) => b.score - a.score);

    const topResults = results.slice(0, topK);

    const citations: CitationChunk[] = topResults.map(item => ({
      id: item.chunk.id,
      content: item.chunk.content,
      categoryId: item.chunk.categoryId,
      tenantId: item.chunk.tenantId,
      tags: item.chunk.tags,
      relevance: item.score,
      metadata: item.chunk.metadata,
    }));

    return {
      chunks: citations,
      totalFound: results.length,
      retrievalTime: Date.now() - startTime,
      retrievalMethod: this.name,
    };
  }

  private resolveScopeCategories(scope: KnowledgeScope): string[] {
    if (!scope.categoryIds || scope.categoryIds.length === 0) {
      return Array.from(this.categoryIndex.keys());
    }

    const resolved: string[] = [...scope.categoryIds];

    if (scope.includeSubCategories) {
      for (const catId of scope.categoryIds) {
        const children = this.categoryTree.get(catId);
        if (children) {
          resolved.push(...children);
        }
      }
    }

    return Array.from(new Set(resolved));
  }

  private getCandidateChunks(scope: KnowledgeScope, categoryIds: string[]): DocumentChunk[] {
    const candidates: Map<string, DocumentChunk> = new Map();

    for (const catId of categoryIds) {
      const chunkIds = this.categoryIndex.get(catId) || [];
      for (const cid of chunkIds) {
        const chunk = this.chunks.get(cid);
        if (chunk && chunk.tenantId === scope.tenantId) {
          candidates.set(cid, chunk);
        }
      }
    }

    if (scope.tagIds && scope.tagIds.length > 0) {
      const tagChunkIds = new Set<string>();
      for (const tagId of scope.tagIds) {
        const tChunks = this.tagIndex.get(tagId) || [];
        for (const cid of tChunks) {
          tagChunkIds.add(cid);
        }
      }
      for (const cid of Array.from(candidates.keys())) {
        if (!tagChunkIds.has(cid)) {
          candidates.delete(cid);
        }
      }
    }

    return Array.from(candidates.values());
  }

  getAllChunks(): DocumentChunk[] {
    return Array.from(this.chunks.values());
  }
}
