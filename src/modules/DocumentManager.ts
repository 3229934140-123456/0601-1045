import {
  DocumentChunk,
  Category,
  CategoryTree,
  Tag,
  Tenant,
  DocumentUploadRequest,
  DocumentUploadResult,
  KnowledgeScope,
  StorageAdapter,
} from '../types';
import { generateId, chunkText, normalizeText, keywordMatchScore } from '../utils';

export interface ScopeValidationResult {
  valid: boolean;
  validTenantId?: string;
  validCategoryIds: string[];
  invalidCategoryIds: string[];
  validTagIds: string[];
  invalidTagIds: string[];
  isEmpty: boolean;
  availableChunkCount: number;
  message?: string;
}

export class DocumentManager {
  private tenants: Map<string, Tenant> = new Map();
  private categories: Map<string, Category> = new Map();
  private tags: Map<string, Tag> = new Map();
  private chunks: Map<string, DocumentChunk> = new Map();
  private chunkIndex: Map<string, string[]> = new Map();
  private tagChunkIndex: Map<string, string[]> = new Map();
  private storage?: StorageAdapter;
  private defaultTenantId: string;

  constructor(storage?: StorageAdapter, defaultTenantId?: string) {
    this.storage = storage;
    this.defaultTenantId = defaultTenantId || 'tenant_default';
    this.initDefaultTenant();
  }

  private initDefaultTenant(): void {
    if (this.tenants.has(this.defaultTenantId)) return;

    const defaultTenant: Tenant = {
      id: this.defaultTenantId,
      name: '默认租户',
      description: '系统默认租户',
      createdAt: Date.now(),
      isActive: true,
    };
    this.tenants.set(defaultTenant.id, defaultTenant);
  }

  async initialize(): Promise<void> {
    if (!this.storage) return;

    if (this.storage.loadTenants) {
      const loadedTenants = await this.storage.loadTenants();
      for (const t of loadedTenants) {
        this.tenants.set(t.id, t);
      }
    }

    if (this.storage.loadCategories) {
      for (const tenantId of this.tenants.keys()) {
        const loadedCats = await this.storage.loadCategories(tenantId);
        for (const c of loadedCats) {
          this.categories.set(c.id, c);
          if (!this.chunkIndex.has(c.id)) {
            this.chunkIndex.set(c.id, []);
          }
        }
      }
    }

    if (this.storage.loadTags) {
      for (const tenantId of this.tenants.keys()) {
        const loadedTags = await this.storage.loadTags(tenantId);
        for (const t of loadedTags) {
          this.tags.set(t.id, t);
          if (!this.tagChunkIndex.has(t.id)) {
            this.tagChunkIndex.set(t.id, []);
          }
        }
      }
    }

    if (this.storage.loadChunks) {
      const loadedChunks = await this.storage.loadChunks();
      for (const chunk of loadedChunks) {
        this.chunks.set(chunk.id, chunk);

        const catChunks = this.chunkIndex.get(chunk.categoryId) || [];
        if (!catChunks.includes(chunk.id)) {
          catChunks.push(chunk.id);
          this.chunkIndex.set(chunk.categoryId, catChunks);
        }

        for (const tagId of chunk.tags) {
          const tagChunks = this.tagChunkIndex.get(tagId) || [];
          if (!tagChunks.includes(chunk.id)) {
            tagChunks.push(chunk.id);
            this.tagChunkIndex.set(tagId, tagChunks);
          }
        }
      }
    }

    this.initDefaultTenant();
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;

    try {
      if (this.storage.saveTenants) {
        await this.storage.saveTenants(Array.from(this.tenants.values()));
      }
      if (this.storage.saveCategories) {
        await this.storage.saveCategories(Array.from(this.categories.values()));
      }
      if (this.storage.saveTags) {
        await this.storage.saveTags(Array.from(this.tags.values()));
      }
      if (this.storage.saveChunks) {
        await this.storage.saveChunks(Array.from(this.chunks.values()));
      }
    } catch (_e) {
      // persist failure is non-critical
    }
  }

  addTenant(name: string, description?: string): Tenant {
    const tenant: Tenant = {
      id: generateId('tenant'),
      name,
      description,
      createdAt: Date.now(),
      isActive: true,
    };
    this.tenants.set(tenant.id, tenant);
    this.persist();
    return tenant;
  }

  removeTenant(tenantId: string): boolean {
    if (tenantId === this.defaultTenantId) return false;

    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    for (const cat of this.categories.values()) {
      if (cat.tenantId === tenantId) {
        this.removeCategory(cat.id, tenantId);
      }
    }

    for (const tag of this.tags.values()) {
      if (tag.tenantId === tenantId) {
        this.removeTag(tag.id, tenantId);
      }
    }

    tenant.isActive = false;
    this.tenants.delete(tenantId);
    this.persist();
    return true;
  }

  listTenants(onlyActive: boolean = true): Tenant[] {
    const tenants = Array.from(this.tenants.values());
    return onlyActive ? tenants.filter(t => t.isActive) : tenants;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  addCategory(name: string, tenantId: string, parentId?: string, description?: string, sortOrder?: number): Category | null {
    if (!this.tenants.has(tenantId)) {
      return null;
    }

    if (parentId && !this.validateCategoryOwnership(parentId, tenantId)) {
      return null;
    }

    const category: Category = {
      id: generateId('cat'),
      name,
      tenantId,
      parentId,
      description,
      sortOrder: sortOrder || 0,
      createdAt: Date.now(),
    };

    this.categories.set(category.id, category);
    this.chunkIndex.set(category.id, []);
    this.persist();
    return category;
  }

  removeCategory(categoryId: string, tenantId: string): boolean {
    const category = this.categories.get(categoryId);
    if (!category || category.tenantId !== tenantId) return false;

    const childIds = this.getChildCategoryIds(categoryId);
    for (const childId of childIds) {
      this.clearCategory(childId);
      this.categories.delete(childId);
    }

    this.clearCategory(categoryId);
    this.chunkIndex.delete(categoryId);
    this.categories.delete(categoryId);
    this.persist();
    return true;
  }

  listCategories(tenantId: string, parentId?: string): Category[] {
    let categories = Array.from(this.categories.values()).filter(c => c.tenantId === tenantId);
    if (parentId !== undefined) {
      categories = categories.filter(c => c.parentId === parentId);
    }
    return categories.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getCategoryTree(tenantId: string, categoryId: string): CategoryTree | null {
    const category = this.categories.get(categoryId);
    if (!category || category.tenantId !== tenantId) return null;

    return this.buildCategoryTree(categoryId);
  }

  private buildCategoryTree(categoryId: string): CategoryTree {
    const category = this.categories.get(categoryId)!;
    const children = this.listCategories(category.tenantId, categoryId)
      .map(c => this.buildCategoryTree(c.id));

    return {
      ...category,
      children,
    };
  }

  getAllCategoryTree(tenantId: string): CategoryTree[] {
    const rootCats = this.listCategories(tenantId).filter(c => !c.parentId);
    return rootCats.map(c => this.buildCategoryTree(c.id));
  }

  private getChildCategoryIds(parentId: string): string[] {
    const childIds: string[] = [];
    const direct = Array.from(this.categories.values()).filter((c: Category) => c.parentId === parentId);
    for (const child of direct) {
      childIds.push(child.id);
      childIds.push(...this.getChildCategoryIds(child.id));
    }
    return childIds;
  }

  addTag(name: string, tenantId: string, color?: string): Tag | null {
    if (!this.tenants.has(tenantId)) return null;

    const tag: Tag = {
      id: generateId('tag'),
      name,
      tenantId,
      color,
      createdAt: Date.now(),
    };

    this.tags.set(tag.id, tag);
    this.tagChunkIndex.set(tag.id, []);
    this.persist();
    return tag;
  }

  removeTag(tagId: string, tenantId: string): boolean {
    const tag = this.tags.get(tagId);
    if (!tag || tag.tenantId !== tenantId) return false;

    const chunkIds = this.tagChunkIndex.get(tagId) || [];
    for (const chunkId of chunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunk.tags = chunk.tags.filter(t => t !== tagId);
        chunk.updatedAt = Date.now();
      }
    }

    this.tagChunkIndex.delete(tagId);
    this.tags.delete(tagId);
    this.persist();
    return true;
  }

  listTags(tenantId: string): Tag[] {
    return Array.from(this.tags.values()).filter(t => t.tenantId === tenantId);
  }

  getTag(tagId: string, tenantId: string): Tag | undefined {
    const tag = this.tags.get(tagId);
    if (tag && tag.tenantId === tenantId) return tag;
    return undefined;
  }

  async uploadDocument(request: DocumentUploadRequest): Promise<DocumentUploadResult> {
    try {
      const { content, tenantId, categoryId, tags = [], metadata, chunkSize = 500 } = request;

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          chunkIds: [],
          categoryId,
          tenantId,
          chunkCount: 0,
          message: '文档内容不能为空',
        };
      }

      if (!this.tenants.has(tenantId)) {
        return {
          success: false,
          chunkIds: [],
          categoryId,
          tenantId,
          chunkCount: 0,
          message: `租户 ${tenantId} 不存在`,
        };
      }

      if (!this.validateCategoryOwnership(categoryId, tenantId)) {
        return {
          success: false,
          chunkIds: [],
          categoryId,
          tenantId,
          chunkCount: 0,
          message: `分类 ${categoryId} 不存在或不属于该租户`,
        };
      }

      const validTags: string[] = [];
      for (const tagId of tags) {
        if (this.tags.has(tagId) && this.tags.get(tagId)!.tenantId === tenantId) {
          validTags.push(tagId);
        }
      }

      const textChunks = chunkText(content, chunkSize, Math.floor(chunkSize * 0.1));

      const chunkIds: string[] = [];
      const categoryChunkIds = this.chunkIndex.get(categoryId) || [];

      for (const textChunk of textChunks) {
        const now = Date.now();
        const chunk: DocumentChunk = {
          id: generateId('chunk'),
          content: textChunk,
          tenantId,
          categoryId,
          tags: validTags,
          metadata,
          createdAt: now,
          updatedAt: now,
        };

        this.chunks.set(chunk.id, chunk);
        categoryChunkIds.push(chunk.id);
        chunkIds.push(chunk.id);

        for (const tagId of validTags) {
          const tagChunks = this.tagChunkIndex.get(tagId) || [];
          if (!tagChunks.includes(chunk.id)) {
            tagChunks.push(chunk.id);
            this.tagChunkIndex.set(tagId, tagChunks);
          }
        }
      }

      this.chunkIndex.set(categoryId, categoryChunkIds);
      await this.persist();

      return {
        success: true,
        chunkIds,
        categoryId,
        tenantId,
        chunkCount: chunkIds.length,
      };
    } catch (error) {
      return {
        success: false,
        chunkIds: [],
        categoryId: request.categoryId,
        tenantId: request.tenantId,
        chunkCount: 0,
        message: error instanceof Error ? error.message : '文档上传失败',
      };
    }
  }

  validateScope(scope: KnowledgeScope): ScopeValidationResult {
    const result: ScopeValidationResult = {
      valid: true,
      validCategoryIds: [],
      invalidCategoryIds: [],
      validTagIds: [],
      invalidTagIds: [],
      isEmpty: false,
      availableChunkCount: 0,
    };

    const tenantId = scope.tenantId || this.defaultTenantId;
    result.validTenantId = tenantId;

    if (!this.tenants.has(tenantId) || !this.tenants.get(tenantId)!.isActive) {
      result.valid = false;
      result.isEmpty = true;
      result.message = `租户 ${tenantId} 不存在或已停用`;
      return result;
    }

    if (scope.categoryIds && scope.categoryIds.length > 0) {
      for (const catId of scope.categoryIds) {
        if (this.validateCategoryOwnership(catId, tenantId)) {
          result.validCategoryIds.push(catId);
          if (scope.includeSubCategories) {
            result.validCategoryIds.push(...this.getChildCategoryIds(catId));
          }
        } else {
          result.invalidCategoryIds.push(catId);
        }
      }

      result.validCategoryIds = Array.from(new Set(result.validCategoryIds));
    } else {
      result.validCategoryIds = this.listCategories(tenantId).map(c => c.id);
    }

    if (scope.tagIds && scope.tagIds.length > 0) {
      for (const tagId of scope.tagIds) {
        const tag = this.tags.get(tagId);
        if (tag && tag.tenantId === tenantId) {
          result.validTagIds.push(tagId);
        } else {
          result.invalidTagIds.push(tagId);
        }
      }
    }

    if (scope.strictMode && scope.categoryIds && scope.categoryIds.length > 0) {
      if (result.validCategoryIds.length === 0) {
        result.valid = false;
        result.isEmpty = true;
        result.message = `指定的分类范围无效：${result.invalidCategoryIds.join(', ')}`;
        return result;
      }
    }

    if (scope.strictMode && scope.tagIds && scope.tagIds.length > 0) {
      if (result.validTagIds.length === 0) {
        result.valid = false;
        result.isEmpty = true;
        result.message = `指定的标签范围无效：${result.invalidTagIds.join(', ')}`;
        return result;
      }
    }

    const candidateChunkIds = new Set<string>();

    for (const catId of result.validCategoryIds) {
      const catChunks = this.chunkIndex.get(catId) || [];
      for (const cid of catChunks) {
        candidateChunkIds.add(cid);
      }
    }

    if (result.validTagIds.length > 0) {
      const tagChunkIds = new Set<string>();
      for (const tagId of result.validTagIds) {
        const tChunks = this.tagChunkIndex.get(tagId) || [];
        for (const cid of tChunks) {
          tagChunkIds.add(cid);
        }
      }
      for (const cid of Array.from(candidateChunkIds)) {
        if (!tagChunkIds.has(cid)) {
          candidateChunkIds.delete(cid);
        }
      }
    }

    result.availableChunkCount = candidateChunkIds.size;

    if (result.availableChunkCount === 0 && scope.strictMode) {
      result.isEmpty = true;
      result.message = '指定的知识范围内没有可用的文档内容';
    }

    return result;
  }

  searchChunks(
    question: string,
    scope: KnowledgeScope,
    limit: number = 10
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const validation = this.validateScope(scope);

    if (validation.isEmpty && scope.strictMode) {
      return [];
    }

    const categoryIds = validation.validCategoryIds;
    const tagIds = validation.validTagIds;
    const tenantId = validation.validTenantId;

    const results: Array<{ chunk: DocumentChunk; score: number }> = [];
    const candidateChunks: Map<string, DocumentChunk> = new Map();

    for (const catId of categoryIds) {
      const chunkIds = this.chunkIndex.get(catId) || [];
      for (const chunkId of chunkIds) {
        const chunk = this.chunks.get(chunkId);
        if (chunk && chunk.tenantId === tenantId) {
          candidateChunks.set(chunkId, chunk);
        }
      }
    }

    if (tagIds.length > 0) {
      const tagChunkSet = new Set<string>();
      for (const tagId of tagIds) {
        const tChunks = this.tagChunkIndex.get(tagId) || [];
        for (const cid of tChunks) {
          tagChunkSet.add(cid);
        }
      }
      for (const cid of Array.from(candidateChunks.keys())) {
        if (!tagChunkSet.has(cid)) {
          candidateChunks.delete(cid);
        }
      }
    }

    for (const chunk of candidateChunks.values()) {
      const score = keywordMatchScore(chunk.content, question);
      if (score > 0) {
        results.push({ chunk, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  listChunks(scope: KnowledgeScope, limit?: number): DocumentChunk[] {
    const validation = this.validateScope(scope);
    if (validation.isEmpty && scope.strictMode) {
      return [];
    }

    const chunks: DocumentChunk[] = [];

    for (const catId of validation.validCategoryIds) {
      const chunkIds = this.chunkIndex.get(catId) || [];
      for (const chunkId of chunkIds) {
        const chunk = this.chunks.get(chunkId);
        if (chunk && chunk.tenantId === validation.validTenantId) {
          if (validation.validTagIds.length > 0) {
            const hasValidTag = validation.validTagIds.some(tid => chunk.tags.includes(tid));
            if (!hasValidTag) continue;
          }
          chunks.push(chunk);
          if (limit && chunks.length >= limit) {
            return chunks;
          }
        }
      }
    }

    return chunks;
  }

  removeChunk(chunkId: string, tenantId: string): boolean {
    const chunk = this.chunks.get(chunkId);
    if (!chunk || chunk.tenantId !== tenantId) return false;

    const categoryChunks = this.chunkIndex.get(chunk.categoryId);
    if (categoryChunks) {
      const idx = categoryChunks.indexOf(chunkId);
      if (idx > -1) {
        categoryChunks.splice(idx, 1);
      }
    }

    for (const tagId of chunk.tags) {
      const tagChunks = this.tagChunkIndex.get(tagId);
      if (tagChunks) {
        const idx = tagChunks.indexOf(chunkId);
        if (idx > -1) {
          tagChunks.splice(idx, 1);
        }
      }
    }

    this.chunks.delete(chunkId);
    this.persist();
    return true;
  }

  getChunk(chunkId: string, tenantId: string): DocumentChunk | undefined {
    const chunk = this.chunks.get(chunkId);
    if (chunk && chunk.tenantId === tenantId) return chunk;
    return undefined;
  }

  getChunkCount(scope: KnowledgeScope): number {
    const validation = this.validateScope(scope);
    if (validation.isEmpty && scope.strictMode) {
      return 0;
    }
    return validation.availableChunkCount;
  }

  clearCategory(categoryId: string): number {
    const chunkIds = this.chunkIndex.get(categoryId) || [];
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        for (const tagId of chunk.tags) {
          const tagChunks = this.tagChunkIndex.get(tagId);
          if (tagChunks) {
            const idx = tagChunks.indexOf(id);
            if (idx > -1) tagChunks.splice(idx, 1);
          }
        }
      }
      this.chunks.delete(id);
    }
    this.chunkIndex.set(categoryId, []);
    this.persist();
    return chunkIds.length;
  }

  clearTenant(tenantId: string): number {
    const categories = this.listCategories(tenantId);
    let removed = 0;
    for (const cat of categories) {
      removed += this.clearCategory(cat.id);
    }
    return removed;
  }

  private validateCategoryOwnership(categoryId: string, tenantId: string): boolean {
    const category = this.categories.get(categoryId);
    return !!category && category.tenantId === tenantId;
  }

  getDefaultTenantId(): string {
    return this.defaultTenantId;
  }

  setDefaultTenantId(tenantId: string): void {
    this.defaultTenantId = tenantId;
  }
}
