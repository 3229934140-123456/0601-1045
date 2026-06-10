import {
  AIPlatform,
  KnowledgeScope,
  Retriever,
  RetrieveRequest,
  RetrieveResult,
  LLM,
  LLMGenerateRequest,
  LLMResult,
  StorageAdapter,
  DocumentChunk,
  Session,
  UserFeedback,
  FAQItem,
  UsageRecord,
  Tenant,
  Category,
  Tag,
  CitationChunk,
} from '../src';

class MemoryStorageAdapter implements StorageAdapter {
  private store: {
    chunks: DocumentChunk[];
    sessions: Session[];
    feedbacks: UserFeedback[];
    faqs: FAQItem[];
    usage: UsageRecord[];
    tenants: Tenant[];
    categories: Category[];
    tags: Tag[];
  } = {
    chunks: [],
    sessions: [],
    feedbacks: [],
    faqs: [],
    usage: [],
    tenants: [],
    categories: [],
    tags: [],
  };

  async saveChunks(chunks: DocumentChunk[]): Promise<void> {
    this.store.chunks = chunks;
  }

  async loadChunks(): Promise<DocumentChunk[]> {
    return this.store.chunks;
  }

  async saveSessions(sessions: Session[]): Promise<void> {
    this.store.sessions = sessions;
  }

  async loadSessions(): Promise<Session[]> {
    return this.store.sessions;
  }

  async saveFeedbacks(feedbacks: UserFeedback[]): Promise<void> {
    this.store.feedbacks = feedbacks;
  }

  async loadFeedbacks(): Promise<UserFeedback[]> {
    return this.store.feedbacks;
  }

  async saveFAQs(faqs: FAQItem[]): Promise<void> {
    this.store.faqs = faqs;
  }

  async loadFAQs(): Promise<FAQItem[]> {
    return this.store.faqs;
  }

  async saveUsage(records: UsageRecord[]): Promise<void> {
    this.store.usage = records;
  }

  async loadUsage(): Promise<UsageRecord[]> {
    return this.store.usage;
  }

  async saveTenants(tenants: Tenant[]): Promise<void> {
    this.store.tenants = tenants;
  }

  async loadTenants(): Promise<Tenant[]> {
    return this.store.tenants;
  }

  async saveCategories(categories: Category[]): Promise<void> {
    this.store.categories = categories;
  }

  async loadCategories(): Promise<Category[]> {
    return this.store.categories;
  }

  async saveTags(tags: Tag[]): Promise<void> {
    this.store.tags = tags;
  }

  async loadTags(): Promise<Tag[]> {
    return this.store.tags;
  }
}

class CustomVectorRetriever implements Retriever {
  public name = 'CustomVectorRetriever';
  private data: Map<string, CitationChunk> = new Map();

  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.data.set(chunk.id, {
        id: chunk.id,
        content: chunk.content,
        categoryId: chunk.categoryId,
        tenantId: chunk.tenantId,
        tags: chunk.tags,
        relevance: 0,
        metadata: chunk.metadata,
      });
    }
  }

  async removeChunks(chunkIds: string[]): Promise<void> {
    for (const id of chunkIds) {
      this.data.delete(id);
    }
  }

  async clear(tenantId?: string): Promise<void> {
    if (tenantId) {
      const toRemove: string[] = [];
      this.data.forEach((chunk, id) => {
        if (chunk.tenantId === tenantId) toRemove.push(id);
      });
      toRemove.forEach(id => this.data.delete(id));
    } else {
      this.data.clear();
    }
  }

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    const startTime = Date.now();
    const results: CitationChunk[] = [];

    this.data.forEach(chunk => {
      if (request.scope.tenantId && chunk.tenantId !== request.scope.tenantId) return;
      if (request.scope.categoryIds && !request.scope.categoryIds.includes(chunk.categoryId)) return;

      const hasQuery = chunk.content.includes(request.query.slice(0, 2));
      if (hasQuery) {
        results.push({
          ...chunk,
          relevance: 0.7 + Math.random() * 0.3,
        });
      }
    });

    results.sort((a, b) => b.relevance - a.relevance);

    return {
      chunks: results.slice(0, request.topK),
      totalFound: results.length,
      retrievalTime: Date.now() - startTime,
      retrievalMethod: this.name,
      indexUsed: 'custom_vector_index',
    };
  }
}

class CustomLLM implements LLM {
  public name = 'CustomEnterpriseLLM';

  async generate(request: LLMGenerateRequest): Promise<LLMResult> {
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 50));

    const citationsText = request.citations
      .slice(0, 2)
      .map(c => c.content)
      .join(' ');

    const answer = `[企业LLM] 关于"${request.question}"的回答：根据资料${citationsText.slice(0, 50)}...`;

    return {
      answer,
      llmTime: Date.now() - startTime,
      modelName: 'enterprise-gpt-4',
      tokensInput: request.question.length + request.context.length,
      tokensOutput: answer.length,
      rawResponse: { model: 'enterprise-gpt-4', temperature: 0.7 },
    };
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('AI 企业知识库问答平台 - 增强版示例');
  console.log('='.repeat(80));

  const storage = new MemoryStorageAdapter();

  const platform = new AIPlatform({
    tenantId: 'tenant_acme',
    defaultUserId: 'user_admin',
    noAnswerMessage: '抱歉，知识库中暂无相关内容，请尝试其他关键词。',
    blockedMessage: '您的问题包含不适宜内容，请修改后重新提问。',
    scopeEmptyMessage: '抱歉，您指定的知识范围内暂无数据。',
    similarityThreshold: 0.75,
    enableStepTracing: true,
    storage,
    faqScoringWeights: {
      pinned: 0.4,
      directQuestion: 0.3,
      similarMatch: 0.2,
      usage: 0.05,
      recency: 0.05,
    },
  });

  // ==================== 1. 租户与栏目树设置 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[1] 多租户 & 栏目树 & 标签设置');
  console.log('='.repeat(80));

  const tenant1 = platform.addTenant('ACME集团总部', '集团总部知识库');
  const tenant2 = platform.addTenant('ACME子公司A', '子公司A独立知识库');

  console.log('已创建租户：');
  platform.listTenants().forEach((t: Tenant) => {
    console.log(`  - ${t.name} (${t.id})`);
  });

  const catRoot1 = platform.addCategory('制度规范', tenant1.id, undefined, '公司各项规章制度');
  const catHr = platform.addCategory('人事制度', tenant1.id, catRoot1?.id, '人事相关制度');
  const catFinance = platform.addCategory('财务制度', tenant1.id, catRoot1?.id, '财务相关制度');
  const catProduct = platform.addCategory('产品中心', tenant1.id, undefined, '产品介绍文档');
  const catRoot2 = platform.addCategory('子公司制度', tenant2.id, undefined, '子公司A专属制度');

  console.log('\n已创建栏目树（ACME集团总部）：');
  const tree = platform.document.getAllCategoryTree(tenant1.id);
  function printTree(nodes: Category[], indent = 0) {
    for (const node of nodes) {
      console.log('  '.repeat(indent) + `├── ${node.name} (${node.id})`);
      if ((node as any).children && (node as any).children.length > 0) {
        printTree((node as any).children, indent + 1);
      }
    }
  }
  printTree(tree);

  const tagImportant = platform.addTag('重要', tenant1.id, '#ff4444')!;
  const tagNew = platform.addTag('新发布', tenant1.id, '#44aa44')!;
  const tagHr = platform.addTag('人事相关', tenant1.id, '#4444ff')!;

  console.log('\n已创建标签：');
  platform.listTags(tenant1.id).forEach((t: Tag) => {
    console.log(`  - [${t.color}] ${t.name} (${t.id})`);
  });

  // ==================== 2. 多租户文档上传 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[2] 多租户文档上传（严格隔离）');
  console.log('='.repeat(80));

  const hrDoc = `员工考勤管理制度（ACME集团总部）：
1. 工作时间：周一至周五 9:00-18:00，午休 12:00-13:30。
2. 迟到：超过上班时间30分钟内视为迟到，扣发当日薪资的10%。
3. 年假：工作满1年可享受5天带薪年假，每满1年增加1天，最多15天。
4. 加班：工作日加班超过2小时起算，加班1小时可调休1小时或按1.5倍薪资计算。`;

  const financeDoc = `财务报销制度（ACME集团总部）：
1. 报销流程：经办人填写报销单 → 部门经理审批 → 财务审核 → 总经理审批 → 付款。
2. 招待费：单次招待费超过500元需提前申请，超标准部分不予报销。
3. 差旅费：住宿标准一线城市300元/天，二线城市250元/天，交通费实报实销。`;

  const productDoc = `SmartBot智能客服（ACME集团总部）：
产品名称：SmartBot AI 智能客服
核心功能：智能问答、多轮对话、情感识别、数据分析、多渠道接入
部署方式：支持公有云SaaS和私有化部署
定价：标准版999元/月，企业版定制报价`;

  const subsidiaryDoc = `子公司A专属考勤制度（ACME子公司A）：
1. 工作时间：弹性工作制，核心工作时间10:00-16:00
2. 年假：工作满1年享受10天带薪年假（优于集团标准）`;

  const hrResult = await platform.uploadDocument({
    content: hrDoc,
    tenantId: tenant1.id,
    categoryId: catHr!.id,
    tags: [tagImportant.id, tagHr.id],
    chunkSize: 300,
  });
  console.log(`总部人事制度上传：${hrResult.success}，分块数：${hrResult.chunkCount}`);

  const financeResult = await platform.uploadDocument({
    content: financeDoc,
    tenantId: tenant1.id,
    categoryId: catFinance!.id,
    tags: [tagImportant.id],
    chunkSize: 300,
  });
  console.log(`总部财务制度上传：${financeResult.success}，分块数：${financeResult.chunkCount}`);

  const productResult = await platform.uploadDocument({
    content: productDoc,
    tenantId: tenant1.id,
    categoryId: catProduct!.id,
    tags: [tagNew.id],
    chunkSize: 400,
  });
  console.log(`总部产品文档上传：${productResult.success}，分块数：${productResult.chunkCount}`);

  const subResult = await platform.uploadDocument({
    content: subsidiaryDoc,
    tenantId: tenant2.id,
    categoryId: catRoot2!.id,
    chunkSize: 200,
  });
  console.log(`子公司A制度上传：${subResult.success}，分块数：${subResult.chunkCount}`);

  console.log('\n各租户文档数量：');
  console.log(`  ACME集团总部：${platform.getChunkCount({ tenantId: tenant1.id, strictMode: true })} 块`);
  console.log(`  ACME子公司A：${platform.getChunkCount({ tenantId: tenant2.id, strictMode: true })} 块`);

  // ==================== 3. 严格知识范围控制 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[3] 严格知识范围控制（strictMode）');
  console.log('='.repeat(80));

  const scope1: KnowledgeScope = {
    tenantId: tenant1.id,
    categoryIds: [catHr!.id],
    strictMode: true,
    includeSubCategories: true,
  };

  const scope2: KnowledgeScope = {
    tenantId: tenant1.id,
    categoryIds: ['invalid_cat_id'],
    strictMode: true,
  };

  const scope3: KnowledgeScope = {
    tenantId: tenant2.id,
    strictMode: true,
  };

  async function askWithScope(question: string, scope: KnowledgeScope, label: string) {
    console.log(`\n--- ${label} ---`);
    console.log(`提问：${question}`);
    console.log(`范围：tenant=${scope.tenantId?.slice(0, 15)}, categories=${scope.categoryIds?.join(',') || '全部'}, strictMode=${scope.strictMode}`);

    const result = await platform.ask(question, { scope, traceSteps: true });
    console.log(`状态：${result.status}`);
    console.log(`回答：${result.answer.slice(0, 120)}...`);

    if (result.retrieval) {
      console.log(`检索：找到${result.retrieval.chunksFound}块，使用${result.retrieval.chunksUsed}块，耗时${result.retrieval.retrievalTime}ms，方式=${result.retrieval.method}`);
      if (result.retrieval.scopeEmpty) {
        console.log(`  范围为空：${result.message}`);
      }
    }

    if (result.citations.length > 0) {
      console.log(`引用（${result.citations.length}段）：`);
      result.citations.forEach((c, i) => {
        console.log(`  ${i + 1}. [相关度${c.relevance.toFixed(2)}] ${c.content.slice(0, 60)}...`);
      });
    }

    if (result.steps) {
      console.log(`处理步骤（${result.steps.length}步）：`);
      result.steps.forEach(step => {
        console.log(`  - ${step.name}: ${step.status}, ${step.duration}ms`);
      });
    }

    return result;
  }

  await askWithScope('年假有多少天？', scope1, '在人事制度范围内提问');
  await askWithScope('年假有多少天？', scope2, '使用无效分类提问（strictMode）');
  await askWithScope('子公司年假有多少天？', scope3, '在子公司A范围内提问');

  // ==================== 4. 可插拔检索器和LLM ====================
  console.log('\n' + '='.repeat(80));
  console.log('[4] 可插拔检索器 & LLM 接口');
  console.log('='.repeat(80));

  const customRetriever = new CustomVectorRetriever();
  const allChunks = platform.listChunks({ tenantId: tenant1.id, strictMode: false });
  await customRetriever.addChunks(allChunks);
  platform.answer.setRetriever(customRetriever);
  platform.answer.setLLM(new CustomLLM());

  console.log(`已切换为自定义向量检索器：${customRetriever.name}`);
  console.log('已切换为自定义大模型：CustomEnterpriseLLM');

  const resultCustom = await platform.ask('SmartBot有哪些功能？', {
    scope: { tenantId: tenant1.id, strictMode: true },
    traceSteps: true,
  });

  console.log('\n使用自定义组件后的回答：');
  console.log(`  答案：${resultCustom.answer}`);
  console.log(`  检索方式：${resultCustom.retrieval?.method}`);
  console.log(`  LLM模型：${resultCustom.llm?.model}`);
  console.log(`  总耗时：${resultCustom.processingTime}ms`);

  platform.answer.resetToDefaultRetriever();
  platform.answer.resetToDefaultLLM();
  console.log('\n已切回默认检索器（document_manager）和LLM');

  // ==================== 5. FAQ 综合排序 & 人工置顶 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[5] FAQ 综合排序（置顶 + 真实提问 + 相似命中）');
  console.log('='.repeat(80));

  const faq1 = platform.addFAQ('年假有多少天？', '工作满1年5天，每满1年加1天，最多15天。', tenant1.id, '人事制度');
  const faq2 = platform.addFAQ('加班工资怎么算？', '工作日加班按1.5倍薪资计算。', tenant1.id, '人事制度');
  const faq3 = platform.addFAQ('SmartBot支持哪些渠道？', '支持微信、网页、APP、小程序等多渠道接入。', tenant1.id, '产品中心');
  const faq4 = platform.addFAQ('报销流程是怎样的？', '经办人填写→部门经理审批→财务审核→总经理审批→付款。', tenant1.id, '财务制度');

  platform.session.setFAQPin(faq4.id, true, 0.9);
  console.log('已置顶FAQ："报销流程是怎样的？"（置顶权重0.9）');

  for (let i = 0; i < 5; i++) {
    platform.session.incrementFAQCounts(faq1.id, true, false);
  }
  console.log('已模拟"年假有多少天？"被直接提问5次');

  for (let i = 0; i < 3; i++) {
    platform.session.incrementFAQCounts(faq2.id, false, true);
  }
  console.log('已模拟"加班工资怎么算？"被相似匹配3次');

  const faqs = platform.recommendFAQ({ tenantId: tenant1.id, limit: 5 });
  console.log('\nFAQ综合排序结果（TOP 5）：');
  faqs.forEach((faq, i) => {
    const scores: string[] = [];
    if (faq.pinned) scores.push(`置顶${(faq.pinnedWeight * 100).toFixed(0)}%`);
    scores.push(`直接提问${faq.directQuestionCount}次`);
    scores.push(`相似命中${faq.similarMatchCount}次`);
    console.log(`  ${i + 1}. ${faq.pinned ? '[置顶] ' : ''}${faq.question}`);
    console.log(`     评分因素：${scores.join(' | ')}`);
  });

  // ==================== 6. 用户反馈 & 低分答案导出 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[6] 用户反馈（关联答案+引用）& 低分答案导出');
  console.log('='.repeat(80));

  const session1 = platform.createSession({ userId: 'user_001', tenantId: tenant1.id });
  const answer1 = await platform.ask('年假有多少天？', {
    sessionId: session1.id,
    scope: { tenantId: tenant1.id, categoryIds: [catHr!.id], strictMode: true },
  });
  const answer2 = await platform.ask('报销流程是什么？', {
    sessionId: session1.id,
  });
  const answer3 = await platform.ask('子公司有年假吗？', {
    sessionId: session1.id,
    scope: { tenantId: tenant2.id, strictMode: true },
  });

  platform.submitFeedback({
    sessionId: session1.id,
    questionId: answer1.questionId,
    answerId: answer1.questionId,
    rating: 5,
    helpful: true,
    comment: '回答准确清晰！',
    citationIds: answer1.citations.map(c => c.id),
  });
  console.log('已提交反馈1：评分5星（好评）');

  platform.submitFeedback({
    sessionId: session1.id,
    questionId: answer2.questionId,
    answerId: answer2.questionId,
    rating: 2,
    helpful: false,
    comment: '流程描述不够详细，缺少注意事项',
    citationIds: answer2.citations.map(c => c.id),
  });
  console.log('已提交反馈2：评分2星（差评）');

  platform.submitFeedback({
    sessionId: session1.id,
    questionId: answer3.questionId,
    answerId: answer3.questionId,
    rating: 1,
    helpful: false,
    comment: '答非所问，我问的是子公司的情况',
    citationIds: [],
  });
  console.log('已提交反馈3：评分1星（差评）');

  const lowScoreAnswers = platform.getLowScoreFeedbacks({
    tenantId: tenant1.id,
    userId: 'user_001',
    threshold: 3,
  });
  console.log('\n低分答案导出（评分<=3，按租户+用户筛选）：');
  lowScoreAnswers.forEach((item, i) => {
    console.log(`  ${i + 1}. 评分：${item.rating}星，有用：${item.helpful ? '是' : '否'}`);
    console.log(`     问题：${item.question}`);
    console.log(`     答案：${item.answer.slice(0, 80)}...`);
    if (item.comment) console.log(`     备注：${item.comment}`);
    console.log(`     引用：${item.citationDetails.length}段`);
    if (item.citationDetails.length > 0) {
      const firstCit = item.citationDetails[0];
      console.log(`       第1段引用：栏目=[${firstCit.categoryName || '-'}] 标签=[${firstCit.tagNames?.join(',') || '-'}] 相关度=${firstCit.relevance.toFixed(2)}`);
      console.log(`       原文片段：${firstCit.content.slice(0, 60)}...`);
    }
  });

  // ==================== 7. 多维用量查询 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[7] 多维用量查询（租户/用户/会话/接口类型）');
  console.log('='.repeat(80));

  const summary = platform.getUsageSummary();
  console.log(`\n总用量：${summary.total}次，成功：${summary.successCount}次`);
  console.log(`总tokens：${summary.totalTokens}，平均耗时：${summary.averageDuration.toFixed(0)}ms`);

  console.log('\n按接口类型统计：');
  for (const [type, count] of Object.entries(summary.byType)) {
    if (count > 0) {
      const typeNames: Record<string, string> = {
        document_upload: '文档上传',
        question_rewrite: '问题改写',
        similar_question: '相似问题',
        answer_generate: '答案生成',
        feedback_submit: '反馈提交',
        faq_recommend: 'FAQ推荐',
      };
      console.log(`  ${typeNames[type] || type}：${count}次`);
    }
  }

  console.log('\n按租户统计：');
  for (const [tid, count] of Object.entries(summary.byTenant)) {
    if (count > 0) {
      const tenant = platform.getTenant(tid);
      console.log(`  ${tenant?.name || tid}：${count}次`);
    }
  }

  const userUsage = platform.getUsageSummary({ userId: 'user_001' });
  console.log(`\n用户 user_001 的用量：${userUsage.total}次`);

  const adminUsage = platform.getUsageSummary({ userId: 'user_admin' });
  console.log(`用户 user_admin 的用量：${adminUsage.total}次`);

  const sessionUsage = platform.getUsageSummary({ sessionId: session1.id });
  console.log(`会话 ${session1.id.slice(0, 20)}... 的用量：${sessionUsage.total}次`);

  const byTypeAndUser = platform.getUsageCountByDimensions(
    ['type', 'userId'],
    { tenantId: tenant1.id }
  );
  console.log('\n按(接口类型+用户)维度聚合：');
  for (const [key, count] of Object.entries(byTypeAndUser).slice(0, 8)) {
    console.log(`  ${key}：${count}次`);
  }

  const usageDetail = platform.exportUsageDetail({
    tenantId: tenant1.id,
    type: 'answer_generate',
  });
  console.log(`\n租户${tenant1.name}的答案生成调用明细（${usageDetail.length}条）：`);
  usageDetail.slice(0, 3).forEach((record, i) => {
    console.log(`  ${i + 1}. 类型=${record.type} 用户=${record.userId || '-'} 会话=${record.sessionId?.slice(0, 12) || '-'}...`);
    console.log(`     耗时=${record.duration?.toFixed(0) || '-'}ms tokens=${record.tokens || 0} 成功=${record.success ? '是' : '否'}`);
    if (record.errorMessage) {
      console.log(`     失败原因：${record.errorMessage}`);
    }
  });

  // ==================== 8. 多轮对话追问（自动沿用会话scope） ====================
  console.log('\n' + '='.repeat(80));
  console.log('[8] 多轮对话追问（会话scope自动沿用）');
  console.log('='.repeat(80));

  const sessionChat = platform.createSession({
    userId: 'user_002',
    tenantId: tenant1.id,
    scope: { tenantId: tenant1.id, categoryIds: [catHr!.id], strictMode: true, includeSubCategories: true },
  });
  console.log(`新会话创建，scope限定：tenantId=${tenant1.id}, categories=${catHr?.name}, strictMode=true`);

  const q1 = await platform.ask('我工作满2年了', {
    sessionId: sessionChat.id,
    useHistory: true,
  });
  console.log(`Q1: 我工作满2年了 -> ${q1.status}`);
  console.log(`A1: ${q1.answer.slice(0, 100)}...`);
  console.log(`  引用：${q1.citations.length}段，来自范围=${q1.retrieval?.scopeDetails?.validCategories?.length || 0}个分类`);

  const q2 = await platform.ask('那年假有多少天？', {
    sessionId: sessionChat.id,
    useHistory: true,
  });
  console.log(`Q2: 那年假有多少天？ -> ${q2.status}`);
  console.log(`A2: ${q2.answer.slice(0, 100)}...`);
  console.log(`  引用：${q2.citations.length}段，检索方式=${q2.retrieval?.method}`);

  if (q2.citations.length > 0) {
    const allFromHr = q2.citations.every(c => c.categoryId === catHr!.id);
    console.log(`  引用全部来自人事制度分类：${allFromHr ? '是（scope沿用成功）' : '否'}`);
  }

  const history = platform.getSessionHistory({ sessionId: sessionChat.id });
  console.log(`\n会话历史（${history.length}条消息）：`);
  history.forEach(m => {
    console.log(`  [${m.role}] ${m.content.slice(0, 60)}...`);
  });

  // ==================== 9. 知识库重建能力 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[9] 知识库重建能力（上传/删除/移动/改标签后重建索引）');
  console.log('='.repeat(80));

  const rebuildBefore = await platform.rebuildKnowledgeBase({ tenantId: tenant1.id });
  console.log(`首次全量重建（${tenant1.name}）：`);
  console.log(`  总分块：${rebuildBefore.totalChunks}块，总文档：${rebuildBefore.totalDocuments}个`);
  console.log(`  影响分块：${rebuildBefore.affectedChunks}块，影响文档：${rebuildBefore.affectedDocuments}个`);
  console.log(`  检索器更新：${rebuildBefore.retrievalUpdated ? '是' : '否'}，FAQ更新：${rebuildBefore.faqUpdated ? '是' : '否'}`);
  console.log(`  重建耗时：${rebuildBefore.duration}ms`);

  const newDoc = await platform.uploadDocument({
    content: '企业愿景：成为全球领先的AI解决方案提供商。企业使命：用AI赋能每一个组织。',
    tenantId: tenant1.id,
    categoryId: catProduct!.id,
    tags: [tagImportant!.id],
  });
  console.log(`\n上传新文档（产品中心）：成功，分块数=${newDoc.chunkCount}`);

  const rebuildAfterAdd = await platform.rebuildKnowledgeBase({ tenantId: tenant1.id });
  console.log(`上传后重建：总分块=${rebuildAfterAdd.totalChunks}块（+${rebuildAfterAdd.totalChunks - rebuildBefore.totalChunks}）`);

  if (newDoc.chunkIds.length > 0) {
    const moved = platform.moveChunk(newDoc.chunkIds[0], catHr!.id, tenant1.id);
    console.log(`移动分块到人事制度分类：${moved ? '成功' : '失败'}`);

    const rebuildAfterMove = await platform.rebuildKnowledgeBase({
      tenantId: tenant1.id,
      categoryIds: [catHr!.id],
    });
    console.log(`按分类重建（人事制度）：影响分块=${rebuildAfterMove.affectedChunks}块`);
  }

  // ==================== 10. 存储适配器 - 数据持久化验证 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[10] 存储适配器 - 数据持久化验证');
  console.log('='.repeat(80));

  console.log('当前存储适配器中的数据量：');
  const savedTenants = await storage.loadTenants();
  const savedCategories = await storage.loadCategories();
  const savedTags = await storage.loadTags();
  const savedChunks = await storage.loadChunks();
  const savedSessions = await storage.loadSessions();
  const savedFeedbacks = await storage.loadFeedbacks();
  const savedFAQs = await storage.loadFAQs();
  const savedUsage = await storage.loadUsage();

  console.log(`  租户：${savedTenants.length}个`);
  console.log(`  栏目：${savedCategories.length}个`);
  console.log(`  标签：${savedTags.length}个`);
  console.log(`  文档分块：${savedChunks.length}块`);
  console.log(`  会话：${savedSessions.length}个`);
  console.log(`  反馈：${savedFeedbacks.length}条`);
  console.log(`  FAQ：${savedFAQs.length}条`);
  console.log(`  用量记录：${savedUsage.length}条`);

  // ==================== 11. 新实例恢复验证 ====================
  console.log('\n' + '='.repeat(80));
  console.log('[11] 新实例从存储适配器恢复数据');
  console.log('='.repeat(80));

  const platform2 = new AIPlatform({
    tenantId: 'tenant_acme',
    defaultUserId: 'user_admin',
    storage,
    enableStepTracing: true,
  });
  await platform2.initialize();

  const restoredTenants = platform2.listTenants();
  const restoredCategories = platform2.listCategories(tenant1.id);
  const restoredTags = platform2.listTags(tenant1.id);
  const restoredChunkCount = platform2.getChunkCount({ tenantId: tenant1.id, strictMode: true });
  const restoredSessions = platform2.listSessions('user_001');
  const restoredFeedbacks = platform2.getFeedbacks();
  const restoredUsageSummary = platform2.getUsageSummary();

  console.log(`恢复后租户数：${restoredTenants.length}个`);
  console.log(`恢复后栏目数（${tenant1.name}）：${restoredCategories.length}个`);
  console.log(`恢复后标签数（${tenant1.name}）：${restoredTags.length}个`);
  console.log(`恢复后文档分块数（${tenant1.name}）：${restoredChunkCount}块`);
  console.log(`恢复后会话数（user_001）：${restoredSessions.length}个`);
  console.log(`恢复后反馈数：${restoredFeedbacks.length}条`);
  console.log(`恢复后用量记录数：${restoredUsageSummary.total}条`);

  const dataIntact = restoredTenants.length === savedTenants.length
    && restoredCategories.length === savedCategories.filter(c => c.tenantId === tenant1.id).length
    && restoredTags.length === savedTags.filter(t => t.tenantId === tenant1.id).length
    && restoredChunkCount === savedChunks.filter(c => c.tenantId === tenant1.id).length
    && restoredFeedbacks.length === savedFeedbacks.length
    && restoredUsageSummary.total === savedUsage.length;

  console.log(`\n数据完整性检查：${dataIntact ? '通过（所有数据一致）' : '存在差异，请检查'}`);

  if (restoredChunkCount > 0) {
    console.log('\n[验证1] 使用恢复后的数据提问：');
    const restoredAnswer = await platform2.ask('年假有多少天？', {
      scope: { tenantId: tenant1.id, categoryIds: [catHr!.id], strictMode: true, includeSubCategories: true },
    });
    console.log(`  状态：${restoredAnswer.status}`);
    console.log(`  回答：${restoredAnswer.answer.slice(0, 100)}...`);
    console.log(`  引用：${restoredAnswer.citations.length}段`);
    console.log(`  检索方式：${restoredAnswer.retrieval?.method}`);
  }

  console.log('\n[验证2] 恢复后FAQ推荐：');
  const restoredFAQs = platform2.recommendFAQ({ tenantId: tenant1.id, limit: 3 });
  console.log(`  推荐FAQ数量：${restoredFAQs.length}条`);
  restoredFAQs.forEach((faq, i) => {
    console.log(`  ${i + 1}. ${faq.question}（使用${faq.usageCount}次）`);
  });

  console.log('\n[验证3] 恢复后相似问题查询：');
  const similarResult = platform2.findSimilarQuestions({
    question: '年假有多少天？',
    topK: 3,
    threshold: 0.5,
    scope: { tenantId: tenant1.id, strictMode: false },
  });
  console.log(`  候选相似问题数：${similarResult.candidates.length}个`);
  if (similarResult.candidates.length > 0) {
    console.log(`  最佳匹配：${similarResult.candidates[0].question}（相似度${similarResult.candidates[0].similarity.toFixed(2)}）`);
  }

  console.log('\n[验证4] 恢复后低分答案导出：');
  const restoredLowScore = platform2.getLowScoreFeedbacks({
    tenantId: tenant1.id,
    threshold: 3,
  });
  console.log(`  低分反馈数：${restoredLowScore.length}条`);
  if (restoredLowScore.length > 0) {
    const firstLow = restoredLowScore[0];
    console.log(`  第1条：评分=${firstLow.rating}星，问题="${firstLow.question.slice(0, 30)}..."`);
    console.log(`  引用详情：${firstLow.citationDetails.length}段`);
  }

  console.log('\n[验证5] 恢复后调用明细导出：');
  const restoredDetail = platform2.exportUsageDetail({
    tenantId: tenant1.id,
    type: 'answer_generate',
  });
  console.log(`  答案生成调用次数：${restoredDetail.length}次`);
  if (restoredDetail.length > 0) {
    const firstRec = restoredDetail[0];
    console.log(`  第1条：用户=${firstRec.userId}，成功=${firstRec.success}，耗时=${firstRec.duration}ms`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('所有增强功能演示完成！');
  console.log('='.repeat(80));
  console.log('\n功能清单：');
  console.log('  [1] 多租户隔离（tenantId）');
  console.log('  [2] 栏目树（parentId支持无限层级）');
  console.log('  [3] 标签系统（多标签过滤）');
  console.log('  [4] 严格范围控制（strictMode：范围为空直接返回无答案）');
  console.log('  [5] 上传即检索（文档上传后直接可查，无需手动同步）');
  console.log('  [6] 可插拔检索器（Retriever接口，默认用DocumentManager/可替换向量库）');
  console.log('  [7] 可插拔LLM（LLM接口，默认规则生成/可替换企业LLM）');
  console.log('  [8] 详细处理追踪（每步耗时、tokens、命中情况）');
  console.log('  [9] FAQ综合排序（置顶*0.4 + 直接提问*0.3 + 相似命中*0.2）');
  console.log('  [10] 用户反馈（关联answerId和citationIds）');
  console.log('  [11] 低分答案导出（含问题、答案、引用原文、栏目、标签、相关度）');
  console.log('  [12] 多维用量查询（租户/用户/会话/接口类型/日期）');
  console.log('  [13] 用量正确归因（会话userId自动关联，不乱记默认用户）');
  console.log('  [14] 会话scope沿用（追问时自动沿用创建时的知识范围）');
  console.log('  [15] 存储适配器（保存→新建实例→恢复完整验证）');
  console.log('  [16] 知识库重建（上传/删除/移动栏目/改标签后重建索引）');
  console.log('  [17] 调用明细导出（接口类型/用户/会话/耗时/tokens/成功失败/原因）');
  console.log('  [18] 存储恢复后FAQ/相似问答/低分反馈完整可用');
}

main().catch(console.error);
