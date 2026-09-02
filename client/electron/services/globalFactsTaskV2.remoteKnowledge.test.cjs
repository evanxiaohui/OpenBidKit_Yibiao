const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGlobalFactsRetrievalTopics,
  buildRemoteKnowledgeFile,
  buildFileCatalog,
  buildGlobalFactGroupAllowlist,
  filterRemoteOnlyGlobalFacts,
  runGlobalFactsTaskV2,
} = require('./globalFactsTaskV2.cjs');

test('全局事实检索主题完整保留项目概述、招标解析和已确认目录', () => {
  const topics = buildGlobalFactsRetrievalTopics({
    projectOverview: '智慧水务平台建设',
    bidAnalysis: '工期 180 日历天，提供运维服务',
    outline: [{ id: '1', title: '平台总体设计', description: '总体架构与实施' }],
  });
  assert.ok(topics.length > 0);
  assert.ok(topics.every((topic) => !/远程正文|知识库新增话题/.test(topic)));
  assert.match(topics.join(' '), /智慧水务|工期|平台总体设计/);
});

test('全局事实远程检索查询保留超过旧上限的项目概述末尾', async () => {
  const searches = [];
  const projectOverview = `项目概述开头${'项目概述正文'.repeat(400)}项目概述末尾`;
  const state = {
    tenderFile: { fileName: '招标.md' },
    projectOverview,
    outlineData: { outline: [{ id: '1', title: '平台总体设计', description: '总体架构' }] },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    readTenderMarkdown: () => '本项目工期为 180 日历天。',
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-global-facts-full-query-test',
    stats: data?.globalFacts ? { globalFacts: data.globalFacts } : {},
    logs: [],
    ...patch,
  } });

  await runGlobalFactsTaskV2({
    agentService: {
      runTask: async () => ({ output_content: JSON.stringify({ groups: [{ id: 'schedule', title: '项目工期', content: '- 工期：180 日历天' }] }) }),
      updatePersistentTask() {},
    },
    workspaceStore,
    knowledgeBaseService: { readReferences: () => [] },
    knowledgeSession: { searchRemote: async (input) => { searches.push(input); return []; } },
    updateTask: (patch) => ({ task_id: 'task-global-facts-full-query-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal },
    payload: {},
  });

  assert.equal(searches.length, 1);
  assert.ok(searches[0].query.length > 1800);
  assert.match(searches[0].query, /项目概述末尾/);
});

test('全局事实远程参考文件只作为不可信补充材料', () => {
  const file = buildRemoteKnowledgeFile([
    { title: '远程规范', content: '远程内容', knowledgeBaseId: 'kb-secret', knowledgeId: 'doc-secret', chunkId: 'chunk-secret' },
  ]);
  assert.equal(file.path, '远程知识参考.md');
  assert.match(file.content, /仅是参考材料/);
  assert.match(file.content, /不得仅因参考材料新增全局事实大项/);
  assert.doesNotMatch(file.content, /kb-secret|doc-secret|chunk-secret/);
});

test('材料目录只列出真实本地知识条目并显式列出远程参考文件', () => {
  const catalog = buildFileCatalog({
    tenderPaths: ['招标文件/招标文件-01-招标.md'],
    isWorkingCopy: false,
    hasSectionHint: false,
    knowledgeCount: 0,
    hasRemoteKnowledge: true,
    hasOriginalPlan: false,
  });
  assert.doesNotMatch(catalog, /参考知识库\/条目-/);
  assert.match(catalog, /远程知识参考\.md/);
});

test('远程事实组必须能由本地材料标题词证明，remote-only 组被过滤', () => {
  const allowlist = buildGlobalFactGroupAllowlist({
    tenderFiles: [{ content: '本项目工期为 180 日历天。' }],
    projectOverview: '智慧水务平台建设',
    outline: [{ title: '平台总体设计' }],
  });
  const result = filterRemoteOnlyGlobalFacts({ groups: [
    { id: 'local', title: '项目工期', content: '- 工期：180 日历天' },
    { id: 'remote', title: '远程新增荣誉', content: '- 荣誉：未知' },
  ] }, allowlist, { remoteKnowledge: true });
  assert.deepEqual(result.groups.map((group) => group.id), ['local']);
  assert.throws(
    () => filterRemoteOnlyGlobalFacts({ groups: [{ id: 'remote', title: '远程新增荣誉', content: '未知' }] }, allowlist, { remoteKnowledge: true }),
    /无法由本地材料证明/,
  );
});

test('通用二字词命中不构成 provenance，本地知识条目标题可作为合法来源', () => {
  const allowlist = buildGlobalFactGroupAllowlist({
    tenderFiles: [{ content: '本项目平台建设方案。' }],
    knowledgeItems: [{ title: '履约团队配置', content: '项目经理和技术负责人配置。' }],
  });
  const result = filterRemoteOnlyGlobalFacts({ groups: [
    { id: 'local-knowledge', title: '履约团队配置', content: '- 按本地知识条目执行' },
    { id: 'remote', title: '平台资质要求', content: '- 远程新增要求' },
  ] }, allowlist, { remoteKnowledge: true });
  assert.deepEqual(result.groups.map((group) => group.id), ['local-knowledge']);
});

test('真实全局事实任务传递 stage、query、budget，并在远程 zero-hit 时保留本地材料', async () => {
  const searches = [];
  const runs = [];
  const state = {
    tenderFile: { fileName: '招标.md' },
    referenceKnowledgeDocumentIds: ['local-doc'],
    projectOverview: '智慧水务平台建设',
    outlineData: { outline: [{ id: '1', title: '平台总体设计', description: '总体架构' }] },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    readTenderMarkdown: () => '本项目工期为 180 日历天。',
  };
  const agentService = {
    runTask: async (input) => {
      runs.push(input);
      return { output_content: JSON.stringify({ groups: [{ id: 'schedule', title: '项目工期', content: '- 工期：180 日历天' }] }) };
    },
    updatePersistentTask() {},
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-global-facts-test',
    stats: data?.globalFacts ? { globalFacts: data.globalFacts } : {},
    logs: [],
    ...patch,
  } });
  await runGlobalFactsTaskV2({
    agentService,
    workspaceStore,
    knowledgeBaseService: {
      readReferences: () => [{ document: { id: 'local-doc' }, items: [{ id: 'item-1', title: '本地工期说明', content: '工期统一按 180 日历天执行。' }] }],
    },
    knowledgeSession: {
      searchRemote: async (input) => { searches.push(input); return []; },
    },
    updateTask: (patch) => ({ task_id: 'task-global-facts-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal },
    payload: {},
  });
  assert.equal(searches.length, 1);
  assert.equal(searches[0].stage, 'global-facts');
  assert.ok(searches[0].query.length > 0);
  assert.equal(searches[0].matchCount, 7);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].files.some((file) => file.path === '招标文件/招标文件-01-招标.md'));
  assert.ok(runs[0].files.some((file) => file.path === '项目概述.md'));
  assert.ok(runs[0].files.some((file) => file.path === '参考知识库/条目-1.md'));
  assert.equal(runs[0].files.some((file) => file.path === '远程知识参考.md'), false);
});
