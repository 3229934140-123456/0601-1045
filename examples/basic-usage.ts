import { AIPlatform } from '../src';

async function main() {
  const platform = new AIPlatform({
    noAnswerMessage: '抱歉，知识库中暂无此问题的相关答案，请尝试其他问题。',
    blockedMessage: '您的问题包含不适当内容，请重新提问。',
    similarityThreshold: 0.7,
    maxHistoryLength: 30,
  });

  console.log('='.repeat(60));
  console.log('【1. 文档整理 - 创建分类与上传文档】');
  console.log('='.repeat(60));

  platform.addCategory('人事制度', undefined, '公司人事相关制度文档');
  platform.addCategory('产品介绍', undefined, '公司产品介绍文档');
  platform.addCategory('技术规范', undefined, '技术开发规范');

  const hrDoc = `员工考勤管理制度：
1. 工作时间：周一至周五 9:00-18:00，午休 12:00-13:30。
2. 迟到：超过上班时间30分钟内视为迟到，扣发当日薪资的10%。
3. 早退：提前下班30分钟内视为早退，扣发当日薪资的10%。
4. 旷工：未经批准缺席视为旷工，扣发当日薪资的300%。
5. 年假：工作满1年可享受5天带薪年假，每满1年增加1天，最多15天。
6. 请假：员工需提前通过OA系统提交请假申请，经直属上级审批后方可生效。
7. 加班：工作日加班超过2小时起算，加班1小时可调休1小时或按1.5倍薪资计算。`;

  const productDoc = `智能客服机器人产品介绍：
产品名称：SmartBot AI 智能客服
产品定位：为企业提供7x24小时智能化客户服务解决方案。
核心功能：
1. 智能问答：基于企业知识库自动回答客户常见问题，准确率达95%以上。
2. 多轮对话：支持上下文理解，可处理复杂的多轮交互场景。
3. 情感识别：自动识别客户情绪，负面情绪时自动转人工客服。
4. 数据分析：提供完整的对话数据分析报表，助力运营决策。
5. 多渠道接入：支持微信、网页、APP、小程序等多种渠道接入。
技术架构：采用大语言模型+向量检索的RAG架构，确保回答的准确性和时效性。
部署方式：支持公有云SaaS部署和私有化部署两种方式。
定价方案：标准版999元/月起，企业版提供定制化报价。`;

  const techDoc = `前端开发规范：
1. 代码风格：统一使用ESLint + Prettier进行代码规范化。
2. 命名规范：组件使用PascalCase，变量和函数使用camelCase，常量使用UPPER_SNAKE_CASE。
3. 组件设计：遵循单一职责原则，每个组件代码不超过500行。
4. 状态管理：全局状态使用Redux Toolkit，局部状态使用React Hooks。
5. 接口请求：统一封装在api目录下，使用axios作为HTTP客户端。
6. 错误处理：所有异步操作必须包含try-catch或.catch()错误处理。
7. 代码提交：使用commitlint规范commit message格式，格式为type(scope): subject。
8. 单元测试：核心业务逻辑代码覆盖率需达到80%以上。
9. 性能优化：首屏加载时间控制在2秒以内，接口响应时间不超过500ms。`;

  const hrResult = platform.uploadDocument({
    content: hrDoc,
    category: '人事制度',
    chunkSize: 300,
    metadata: { source: '员工手册', version: '2024.1' },
  });
  console.log('人事制度上传：', hrResult.success, '分块数：', hrResult.chunkCount);

  const productResult = platform.uploadDocument({
    content: productDoc,
    category: '产品介绍',
    chunkSize: 400,
    metadata: { source: '产品白皮书', version: '3.0' },
  });
  console.log('产品介绍上传：', productResult.success, '分块数：', productResult.chunkCount);

  const techResult = platform.uploadDocument({
    content: techDoc,
    category: '技术规范',
    chunkSize: 350,
  });
  console.log('技术规范上传：', techResult.success, '分块数：', techResult.chunkCount);

  console.log('\n总文档分块数：', platform.getChunkCount());
  console.log('分类列表：', platform.listCategories().map(c => c.name).join('、'));

  console.log('\n' + '='.repeat(60));
  console.log('【2. 问题改写】');
  console.log('='.repeat(60));

  const originalQ = '那个，我想问一下，如果迟到了会怎么样呀？';
  const rewriteResult = platform.rewriteQuestion({
    question: originalQ,
    type: 'expand',
  });
  console.log('原始问题：', rewriteResult.original);
  console.log('改写后：', rewriteResult.rewritten);
  console.log('变体问题：');
  rewriteResult.variants.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));

  console.log('\n' + '='.repeat(60));
  console.log('【3. 添加QA对 & 识别相近问题】');
  console.log('='.repeat(60));

  platform.addFAQ('年假有多少天？', '工作满1年可享受5天带薪年假，每满1年增加1天，最多15天。', '人事制度');
  platform.addFAQ('加班工资怎么算？', '工作日加班超过2小时起算，加班1小时可调休1小时或按1.5倍薪资计算。', '人事制度');
  platform.addFAQ('SmartBot有哪些核心功能？', 'SmartBot核心功能包括：智能问答、多轮对话、情感识别、数据分析、多渠道接入。', '产品介绍');

  const similarResult = platform.findSimilarQuestions({
    question: '我每年可以休息几天年假？',
    threshold: 0.6,
    topK: 3,
  });
  console.log('问题：我每年可以休息几天年假？');
  console.log('是否命中：', similarResult.hasMatch ? '是' : '否');
  if (similarResult.bestMatch) {
    console.log('最佳匹配：', similarResult.bestMatch.question);
    console.log('相似度：', (similarResult.bestMatch.similarity * 100).toFixed(1) + '%');
    console.log('答案：', similarResult.bestMatch.answer);
  }
  console.log('候选列表：');
  similarResult.candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. [${(c.similarity * 100).toFixed(1)}%] ${c.question}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('【4. 答案生成 + 引用返回】');
  console.log('='.repeat(60));

  const session = platform.createSession({ userId: 'user_001' });
  console.log('会话ID：', session.id);

  async function askAndPrint(q: string, categories?: string[]) {
    const result = await platform.ask(q, {
      sessionId: session.id,
      categories,
      answerStyle: 'standard',
    });
    console.log('\n问：', q);
    console.log('状态：', result.status);
    console.log('答：', result.answer);
    if (result.citations.length > 0) {
      console.log('引用段落（' + result.citations.length + '段）：');
      result.citations.forEach((c, i) => {
        const cat = platform.listCategories().find(x => x.id === c.category)?.name || c.category;
        console.log(`  [${i + 1}] [${cat}] [相关度${(c.relevance * 100).toFixed(0)}%] ${c.content.slice(0, 60)}...`);
      });
    }
    if (result.relatedQuestions && result.relatedQuestions.length > 0) {
      console.log('相关问题：', result.relatedQuestions.join(' | '));
    }
    return result;
  }

  await askAndPrint('公司的工作时间是什么时候？', ['人事制度']);
  await askAndPrint('SmartBot的定价方案是怎样的？', ['产品介绍']);
  const noAnswerRes = await askAndPrint('公司明年的战略规划是什么？');
  console.log('（无答案提示正确显示）');

  console.log('\n' + '='.repeat(60));
  console.log('【5. 敏感词拦截】');
  console.log('='.repeat(60));

  platform.addSensitiveWords(['内部机密', '禁止外传']);
  const sensitiveRes = await platform.ask('请告诉我公司内部机密的禁止外传信息', {
    sessionId: session.id,
  });
  console.log('含敏感词的问题：');
  console.log('状态：', sensitiveRes.status);
  console.log('返回：', sensitiveRes.answer);

  const checkRes = platform.checkSensitive('这是一个包含违禁词示例的测试');
  console.log('\n敏感词检测：');
  console.log('包含敏感词：', checkRes.hasSensitive ? '是' : '否');
  console.log('匹配到：', checkRes.matchedWords.join('、'));
  console.log('过滤后：', checkRes.filteredText);

  console.log('\n' + '='.repeat(60));
  console.log('【6. 追问上下文（多轮对话）】');
  console.log('='.repeat(60));

  const session2 = platform.createSession({ userId: 'user_002', category: '人事制度' });
  console.log('新会话ID：', session2.id);

  const r1 = await platform.ask('年假有多少天？', { sessionId: session2.id, useHistory: true });
  console.log('Q1：年假有多少天？ -> ', r1.status);

  const r2 = await platform.ask('那工作3年呢？', { sessionId: session2.id, useHistory: true });
  console.log('Q2（追问）：那工作3年呢？ -> ', r2.answer.slice(0, 80) + '...');

  const history = platform.getSessionHistory({ sessionId: session2.id });
  console.log('会话历史（' + history.length + '条）：');
  history.forEach(m => {
    console.log(`  [${m.role}] ${m.content.slice(0, 50)}...`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('【7. 用户反馈 & 答案评分】');
  console.log('='.repeat(60));

  const fb1 = platform.submitFeedback({
    sessionId: session.id,
    questionId: 'q_test_001',
    rating: 5,
    helpful: true,
    comment: '回答很准确，解决了我的问题！',
  });
  console.log('提交反馈1：评分5星');

  const fb2 = platform.submitFeedback({
    sessionId: session.id,
    questionId: 'q_test_002',
    rating: 3,
    helpful: false,
    comment: '答案不够详细，希望能补充更多细节。',
  });
  console.log('提交反馈2：评分3星');

  console.log('平均评分：', platform.getAverageRating(session.id).toFixed(1));
  console.log('反馈总数：', platform.getFeedbacks(session.id).length);

  console.log('\n' + '='.repeat(60));
  console.log('【8. 常见问题推荐】');
  console.log('='.repeat(60));

  for (let i = 0; i < 3; i++) {
    await platform.ask('SmartBot有哪些核心功能？');
  }

  const faqs = platform.recommendFAQ({ limit: 5 });
  console.log('推荐的常见问题（TOP 5）：');
  faqs.forEach((faq, i) => {
    const cat = platform.listCategories().find(c => c.id === faq.category)?.name || faq.category;
    console.log(`  ${i + 1}. [${cat}] ${faq.question} (使用${faq.usageCount}次)`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('【9. 调用用量查询】');
  console.log('='.repeat(60));

  const usage = platform.getUsageSummary();
  console.log('总调用次数：', usage.total);
  console.log('按类型统计：');
  for (const [type, count] of Object.entries(usage.byType)) {
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
  console.log('按日期统计：');
  for (const [date, count] of Object.entries(usage.byDate)) {
    console.log(`  ${date}：${count}次`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('【示例运行完成 ✓】');
  console.log('='.repeat(60));
}

main().catch(console.error);
