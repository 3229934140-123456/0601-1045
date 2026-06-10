import {
  DocumentChunk,
  Category,
  DocumentUploadRequest,
  DocumentUploadResult,
} from '../types';
import { generateId, chunkText, normalizeText, keywordMatchScore } from '../utils';

export class DocumentManager {
  private chunks: Map<string, DocumentChunk> = new Map();
  private categories: Map<string, Category> = new Map();
  private chunkIndex: Map<string, string[]> = new Map();

  constructor() {
    this.initDefaultCategories();
  }

  private initDefaultCategories(): void {
    const defaultCategory: Category = {
      id: 'cat_default',
      name: '默认分类',
      description: '默认知识库分类',
      createdAt: Date.now(),
    };
    this.categories.set(defaultCategory.id, defaultCategory);
    this.chunkIndex.set(defaultCategory.id, []);
  }

  addCategory(name: string, parentId?: string, description?: string): Category {
    const category: Category = {
      id: generateId('cat'),
      name,
      parentId,
      description,
      createdAt: Date.now(),
    };
    this.categories.set(category.id, category);
    if (!this.chunkIndex.has(category.id)) {
      this.chunkIndex.set(category.id, []);
    }
    return category;
  }

  removeCategory(categoryId: string): boolean {
    if (!this.categories.has(categoryId) || categoryId === 'cat_default') {
      return false;
    }

    const chunkIds = this.chunkIndex.get(categoryId) || [];
    for (const id of chunkIds) {
      this.chunks.delete(id);
    }

    this.chunkIndex.delete(categoryId);
    this.categories.delete(categoryId);
    return true;
  }

  listCategories(): Category[] {
    return Array.from(this.categories.values());
  }

  getCategory(categoryId: string): Category | undefined {
    return this.categories.get(categoryId);
  }

  findCategoryByName(name: string): Category | undefined {
    for (const cat of this.categories.values()) {
      if (cat.name === name) {
        return cat;
      }
    }
    return undefined;
  }

  ensureCategory(name: string): Category {
    const existing = this.findCategoryByName(name);
    if (existing) {
      return existing;
    }
    return this.addCategory(name);
  }

  uploadDocument(request: DocumentUploadRequest): DocumentUploadResult {
    try {
      const { content, category, metadata, chunkSize = 500 } = request;

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          chunkIds: [],
          category,
          chunkCount: 0,
          message: '文档内容不能为空',
        };
      }

      const categoryObj = this.ensureCategory(category);
      const textChunks = chunkText(content, chunkSize, Math.floor(chunkSize * 0.1));

      const chunkIds: string[] = [];
      const categoryChunkIds = this.chunkIndex.get(categoryObj.id) || [];

      for (const textChunk of textChunks) {
        const chunk: DocumentChunk = {
          id: generateId('chunk'),
          content: textChunk,
          category: categoryObj.id,
          metadata,
          createdAt: Date.now(),
        };

        this.chunks.set(chunk.id, chunk);
        categoryChunkIds.push(chunk.id);
        chunkIds.push(chunk.id);
      }

      this.chunkIndex.set(categoryObj.id, categoryChunkIds);

      return {
        success: true,
        chunkIds,
        category: categoryObj.id,
        chunkCount: chunkIds.length,
      };
    } catch (error) {
      return {
        success: false,
        chunkIds: [],
        category: request.category,
        chunkCount: 0,
        message: error instanceof Error ? error.message : '文档上传失败',
      };
    }
  }

  removeChunk(chunkId: string): boolean {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return false;

    const categoryChunks = this.chunkIndex.get(chunk.category);
    if (categoryChunks) {
      const idx = categoryChunks.indexOf(chunkId);
      if (idx > -1) {
        categoryChunks.splice(idx, 1);
      }
    }

    return this.chunks.delete(chunkId);
  }

  getChunk(chunkId: string): DocumentChunk | undefined {
    return this.chunks.get(chunkId);
  }

  searchChunks(
    question: string,
    categories?: string[],
    limit: number = 10
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const categoryIds = this.resolveCategoryIds(categories);

    const results: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const catId of categoryIds) {
      const chunkIds = this.chunkIndex.get(catId) || [];
      for (const chunkId of chunkIds) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;

        const score = keywordMatchScore(chunk.content, question);
        if (score > 0) {
          results.push({ chunk, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  listChunks(categories?: string[], limit?: number): DocumentChunk[] {
    const categoryIds = this.resolveCategoryIds(categories);
    const chunks: DocumentChunk[] = [];

    for (const catId of categoryIds) {
      const chunkIds = this.chunkIndex.get(catId) || [];
      for (const chunkId of chunkIds) {
        const chunk = this.chunks.get(chunkId);
        if (chunk) {
          chunks.push(chunk);
          if (limit && chunks.length >= limit) {
            return chunks;
          }
        }
      }
    }

    return chunks;
  }

  getChunkCount(categories?: string[]): number {
    if (!categories || categories.length === 0) {
      return this.chunks.size;
    }

    const categoryIds = this.resolveCategoryIds(categories);
    let count = 0;
    for (const catId of categoryIds) {
      count += (this.chunkIndex.get(catId) || []).length;
    }
    return count;
  }

  clearCategory(categoryId: string): number {
    const chunkIds = this.chunkIndex.get(categoryId) || [];
    for (const id of chunkIds) {
      this.chunks.delete(id);
    }
    this.chunkIndex.set(categoryId, []);
    return chunkIds.length;
  }

  private resolveCategoryIds(categories?: string[]): string[] {
    if (!categories || categories.length === 0) {
      return Array.from(this.categories.keys());
    }

    const result: string[] = [];
    for (const cat of categories) {
      if (this.categories.has(cat)) {
        result.push(cat);
      } else {
        const found = this.findCategoryByName(cat);
        if (found) {
          result.push(found.id);
        }
      }
    }

    return result.length > 0 ? result : Array.from(this.categories.keys());
  }
}
