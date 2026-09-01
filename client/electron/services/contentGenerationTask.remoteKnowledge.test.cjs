const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildContentPlanningRetrievalQuery,
  normalizeContentGenerationRuntime,
  namespaceRemoteKnowledgeItem,
  resolveRemoteKnowledgeContents,
  buildChapterContentMessages,
} = require('./contentGenerationTask.cjs');

test('正文编排远程检索查询包含章节目标、已确认事实和招标要求', () => {
  const query = buildContentPlanningRetrievalQuery({
    chapter: { title: '质量保证措施', description: '验收与整改安排' },
    projectOverview: '智慧水务平台建设',
    bidAnalysisFactsText: '工期 180 日历天',
    techRequirements: '要求提供质量管理体系和验收标准',
  });
  assert.match(query, /质量保证措施/);
  assert.match(query, /验收与整改安排/);
  assert.match(query, /工期 180/);
  assert.match(query, /验收标准/);
});

test('远程条目使用稳定命名空间并可从 runtime 快照恢复正文素材', () => {
  const item = namespaceRemoteKnowledgeItem({
    knowledgeBaseId: 'kb-1', knowledgeId: 'doc-2', chunkId: 'chunk-3',
    title: '验收规范', content: '应按规范组织验收', score: 0.8,
  });
  assert.equal(item.id, 'remote:kb-1:doc-2:chunk-3');
  const runtime = normalizeContentGenerationRuntime({
    remoteKnowledgeReferencesBySection: { section1: [item] },
  });
  assert.deepEqual(resolveRemoteKnowledgeContents(['remote:kb-1:doc-2:chunk-3'], runtime), ['应按规范组织验收']);
  assert.deepEqual(normalizeContentGenerationRuntime(undefined).remoteKnowledgeReferencesBySection, {});
});

test('无远程引用时正文素材解析为空但不阻断生成', () => {
  const runtime = normalizeContentGenerationRuntime({});
  assert.deepEqual(resolveRemoteKnowledgeContents([], runtime), []);
});

test('正文生成提示明确要求招标要求和事实优先且不泄露内部来源标识', () => {
  const messages = buildChapterContentMessages({
    chapter: { id: 's1', title: '质量保证', description: '验收' },
    contentPlan: { writing_focus: '验收', knowledge: { item_ids: [] }, facts: { titles: [] }, table: { needed: false } },
    wordControl: {},
    globalFactsMode: 'omit',
  });
  assert.match(messages[0].content, /当前招标要求、用户确认事实和原方案高于参考知识/);
  assert.match(messages[0].content, /不得输出 local: 或 remote:/);
});
