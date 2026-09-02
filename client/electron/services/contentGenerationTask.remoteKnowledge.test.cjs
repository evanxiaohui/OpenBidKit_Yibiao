const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeContentGenerationRuntime,
  namespaceRemoteKnowledgeItem,
  resolveRemoteKnowledgeContents,
  buildChapterContentMessages,
  shouldRetainContentGenerationRuntime,
  runContentGenerationTask,
} = require('./contentGenerationTask.cjs');

test('远程条目使用稳定命名空间并可从 runtime 快照恢复正文素材', () => {
  const item = namespaceRemoteKnowledgeItem({
    knowledgeBaseId: 'kb-1', knowledgeId: 'doc-2', chunkId: 'chunk-3',
    title: '验收规范', content: '应按规范组织验收', score: 0.8,
  });
  assert.equal(item.id, 'remote:kb-1:doc-2:chunk-3');
  const runtime = normalizeContentGenerationRuntime({
    remoteKnowledgeReferencesBySection: {
      section1: [item],
      section2: [{ ...item, id: 'remote:kb-1:doc-2:chunk-4', knowledgeId: 'doc-2', chunkId: 'chunk-4', content: '其他小节素材' }],
    },
  });
  assert.deepEqual(resolveRemoteKnowledgeContents([
    'remote:kb-1:doc-2:chunk-3',
    'remote:kb-1:doc-2:chunk-4',
  ], runtime, 'section1'), ['应按规范组织验收']);
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
  let queryPlanningCalls = 0;
  const aiService = {
    getConfig: () => ({ concurrency_limit: 1 }),
    collectJsonResponse: async () => {
      queryPlanningCalls += 1;
      throw new Error('重试不应重新编排');
    },
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
  assert.equal(queryPlanningCalls, 0);
  assert.match(chatMessages.at(-1).map((message) => message.content).join('\n'), /锁定远程质量控制片段/);
});

test('并发正文编排按小节规划多查询且仅使用当前小节的远程候选与锁定快照', async () => {
  const sectionIds = ['s1', 's2', 's3'];
  const remoteReferences = Object.fromEntries(sectionIds.map((sectionId, index) => [sectionId, {
    id: `remote:kb-1:doc-${sectionId}:chunk-${sectionId}`,
    knowledgeBaseId: 'kb-1',
    knowledgeId: `doc-${sectionId}`,
    chunkId: `chunk-${sectionId}`,
    title: `远程标题-${sectionId}`,
    content: `远程正文-${sectionId}`,
    score: 0.9 - index * 0.1,
  }]));
  const state = {
    workflowKind: 'technical-plan',
    referenceKnowledgeDocumentIds: ['local-doc'],
    outlineData: {
      project_overview: '智慧水务',
      outline: sectionIds.map((id) => ({ id, title: `章节-${id}`, description: `目标-${id}`, content_mode: 'ai-generate' })),
    },
    globalFacts: [{ title: '工期', content: '180 日历天' }],
    globalFactsTask: { status: 'success' },
    contentGenerationOptions: {
      enableConsistencyAudit: false, useAiImages: false, useMermaidImages: false, useHtmlImages: false,
      tableRequirement: 'none', maxAiImages: 0, maxMermaidImages: 0, maxHtmlImages: 0, htmlImageTypes: '',
    },
    contentGenerationSections: {},
    contentGenerationPlans: {},
  };
  const plannerPrompts = new Map();
  const generationPrompts = new Map();
  const remoteSearchRequests = [];
  let concurrentPlannerCount = 0;
  let releaseConcurrentPlanners;
  const concurrentPlannersReady = new Promise((resolve) => { releaseConcurrentPlanners = resolve; });
  const workspaceStore = {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlanWithoutReload: (patch) => Object.assign(state, patch),
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
  const getContentPlanningSectionId = (messages) => messages.map((message) => message.content).join('\n').match(/章节ID:\s*(s[1-3])/)?.[1];
  const aiService = {
    getConfig: () => ({ concurrency_limit: 2 }),
    collectJsonResponse: async ({ messages, logTitle, normalizer }) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (logTitle === '远程知识查询规划-content-planning') {
        const sectionId = sectionIds.find((id) => prompt.includes(`章节-${id}`));
        assert.ok(sectionId);
        return normalizer({
          queries: [`章节-${sectionId}实施方法？`, `章节-${sectionId}如何验收？`],
        });
      }
      const sectionId = getContentPlanningSectionId(messages);
      assert.ok(sectionId);
      plannerPrompts.set(sectionId, prompt);
      if (sectionId !== 's1') {
        concurrentPlannerCount += 1;
        if (concurrentPlannerCount === 2) releaseConcurrentPlanners();
        await concurrentPlannersReady;
      }
      return normalizer({
        writing_focus: `编写 ${sectionId}`,
        knowledge: { item_ids: [sectionId === 's3' ? remoteReferences.s2.id : remoteReferences[sectionId].id] },
        facts: { titles: [] },
        table: { needed: false, purpose: '' },
      });
    },
    chat: async ({ messages }) => {
      const prompt = messages.map((message) => message.content).join('\n');
      const sectionId = sectionIds.find((id) => prompt.includes(`章节-${id}`));
      assert.ok(sectionId);
      generationPrompts.set(sectionId, prompt);
      return `正文-${sectionId}`;
    },
  };
  const knowledgeBaseService = {
    readReferences: () => [{
      document: { id: 'local-doc', status: 'success' },
      items: [{ id: 'local-item', title: '本地标题', resume: '本地摘要', content: '本地正文' }],
    }],
  };
  const knowledgeSession = {
    searchRemote: async ({ queries }) => {
      const queryText = queries.join('\n');
      const sectionId = sectionIds.find((id) => queryText.includes(`章节-${id}`));
      remoteSearchRequests.push({ queries, sectionId });
      return sectionId ? [remoteReferences[sectionId]] : [];
    },
  };
  const taskControl = { signal: new AbortController().signal, isPauseRequested: () => false };

  await runContentGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService,
    knowledgeSession,
    updateTask: (patch) => ({ ...(state.contentGenerationTask || {}), ...patch }),
    checkpointTask,
    payload: {},
    taskControl,
    previousState: structuredClone(state),
  });

  assert.equal(remoteSearchRequests.length, sectionIds.length);
  for (const sectionId of sectionIds) {
    const request = remoteSearchRequests.find((candidate) => candidate.sectionId === sectionId);
    assert.deepEqual(request?.queries, [`章节-${sectionId}实施方法？`, `章节-${sectionId}如何验收？`]);
    const prompt = plannerPrompts.get(sectionId) || '';
    assert.match(prompt, /local-doc::local-item/);
    assert.match(prompt, new RegExp(remoteReferences[sectionId].id));
    for (const otherId of sectionIds.filter((id) => id !== sectionId)) {
      assert.doesNotMatch(prompt, new RegExp(remoteReferences[otherId].id));
    }
  }
  assert.deepEqual(state.contentGenerationPlans.s3.plan.knowledge.item_ids, []);
  assert.match(generationPrompts.get('s2') || '', /远程正文-s2/);
  assert.doesNotMatch(generationPrompts.get('s2') || '', /远程正文-s1|远程正文-s3/);
  assert.doesNotMatch(generationPrompts.get('s3') || '', /远程正文-s1|远程正文-s2|远程正文-s3/);
});
