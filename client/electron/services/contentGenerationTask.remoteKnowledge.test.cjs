const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildContentPlanningRetrievalQuery,
  normalizeContentGenerationRuntime,
  namespaceRemoteKnowledgeItem,
  resolveRemoteKnowledgeContents,
  buildChapterContentMessages,
  shouldRetainContentGenerationRuntime,
  runContentGenerationTask,
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

test('存在失败或未完成章节时任务收尾保留正文 runtime 快照', () => {
  const leaves = [{ item: { id: 'done' } }, { item: { id: 'failed' } }];
  assert.equal(shouldRetainContentGenerationRuntime(leaves, {
    done: { status: 'success' }, failed: { status: 'error' },
  }), true);
  assert.equal(shouldRetainContentGenerationRuntime(leaves, {
    done: { status: 'success' }, failed: { status: 'ignored' },
  }), false);
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

test('失败章节重试保留锁定远程片段且不发起第二次检索', async () => {
  const remoteId = 'remote:kb-1:doc-1:chunk-1';
  const reference = {
    id: remoteId,
    knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-1',
    title: '质量规范', content: '锁定远程质量控制片段', score: 0.9,
  };
  let failFirstRetry = true;
  const searches = [];
  const chatMessages = [];
  const state = {
    outlineData: { project_overview: '智慧水务', outline: [{ id: 's1', title: '质量保证', description: '质量控制', content_mode: 'ai-generate' }] },
    globalFacts: [{ title: '工期', content: '180 日历天' }],
    globalFactsTask: { status: 'success' },
    contentGenerationOptions: {
      enableConsistencyAudit: false, useAiImages: false, useMermaidImages: false, useHtmlImages: false,
      tableRequirement: 'none', maxAiImages: 0, maxMermaidImages: 0, maxHtmlImages: 0, htmlImageTypes: '',
    },
    contentGenerationSections: { s1: { id: 's1', title: '质量保证', status: 'error', content: '', error: '首次失败' } },
    contentGenerationPlans: { s1: {
      plan_version: 4,
      plan: { writing_focus: '质量控制', knowledge: { item_ids: [remoteId] }, facts: { titles: ['工期'] }, table: { needed: false } },
      table_requirement: 'none',
    } },
    contentGenerationTask: { status: 'paused', stats: { content: { planning_completed: 1 } } },
    contentGenerationRuntime: { target_item_id: 's1', remoteKnowledgeReferencesBySection: { s1: [reference] } },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlanWithoutReload() {},
  };
  const checkpointTask = (taskPatch, workspacePatch = {}) => {
    Object.assign(state, workspacePatch);
    const item = workspacePatch.contentGenerationItem;
    if (item?.section) state.contentGenerationSections = { ...state.contentGenerationSections, [item.nodeId]: item.section };
    if (item?.storedPlan) state.contentGenerationPlans = { ...state.contentGenerationPlans, [item.nodeId]: item.storedPlan };
    if (item && Object.hasOwn(item, 'runtime')) state.contentGenerationRuntime = item.runtime;
    if (Object.hasOwn(workspacePatch, 'contentGenerationRuntime')) state.contentGenerationRuntime = workspacePatch.contentGenerationRuntime;
    state.contentGenerationTask = { ...(state.contentGenerationTask || {}), ...taskPatch };
    return { task: state.contentGenerationTask };
  };
  const aiService = {
    getConfig: () => ({ concurrency_limit: 1 }),
    collectJsonResponse: async () => { throw new Error('重试不应重新编排'); },
    chat: async ({ messages }) => {
      chatMessages.push(messages);
      if (failFirstRetry) {
        failFirstRetry = false;
        throw new Error('模拟正文生成失败');
      }
      return '质量控制正文。';
    },
  };
  const taskControl = { signal: new AbortController().signal, isPauseRequested: () => false };
  const sharedInput = {
    aiService, agentService: {}, workspaceStore, knowledgeBaseService: {},
    knowledgeSession: { searchRemote: async (request) => { searches.push(request); return []; } },
    updateTask: (patch) => ({ ...(state.contentGenerationTask || {}), ...patch }), checkpointTask,
    taskControl,
  };

  await runContentGenerationTask({ ...sharedInput, payload: { resume: true }, previousState: structuredClone(state) });
  assert.deepEqual(state.contentGenerationRuntime?.remoteKnowledgeReferencesBySection?.s1, [reference]);
  await runContentGenerationTask({ ...sharedInput, payload: { retryFailedSections: true } });

  assert.equal(searches.length, 0);
  assert.match(chatMessages.at(-1).map((message) => message.content).join('\n'), /锁定远程质量控制片段/);
});
