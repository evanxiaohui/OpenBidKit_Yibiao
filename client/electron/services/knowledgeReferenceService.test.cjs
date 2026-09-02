const assert = require('node:assert/strict');
const test = require('node:test');

const { createKnowledgeReferenceService } = require('./knowledgeReferenceService.cjs');

function createSession(overrides = {}) {
  const { sessionInput = {}, ...serviceOverrides } = overrides;
  const local = {
    readReferences: () => [{ document: { id: 'local-doc', file_name: '本地规范' }, items: [
      { id: 'local-item', title: '本地条目', resume: '本地摘要', content: '本地内容' },
    ] }],
  };
  const remote = { searchMany: async () => [] };
  return createKnowledgeReferenceService({ knowledgeBaseService: local, remoteKnowledgeService: remote, ...serviceOverrides })
    .createTaskSession({
      taskId: 'task-1', workflow: 'technical-plan', localDocumentIds: ['local-doc'],
      remoteScopes: [{ knowledgeBaseId: 'kb-1', mode: 'all', documents: [] }],
      ...sessionInput,
    });
}

test('uses namespaced IDs and keeps local references before remote references', async () => {
  const session = createSession({ remoteKnowledgeService: { searchMany: async () => [
    { id: 'remote:kb-1:doc-1:chunk-high', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-high', title: '远程', content: '远程内容', score: 0.9 },
  ] } });
  const local = await session.loadLocalReferences();
  const remote = await session.searchRemote({ stage: 'outline', query: '项目', matchCount: 8 });
  assert.equal(local[0].id, 'local:local-doc:local-item');
  assert.deepEqual([...local, ...remote].map((item) => item.id), ['local:local-doc:local-item', 'remote:kb-1:doc-1:chunk-high']);
});

test('deduplicates remote chunks by source while preserving fused order', async () => {
  const session = createSession({ remoteKnowledgeService: { searchMany: async () => [
    { id: 'remote:kb-1:doc-1:chunk-a', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-a', title: 'A', content: 'low', score: 0.2 },
    { id: 'remote:kb-1:doc-1:chunk-a', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-a', title: 'A', content: 'high', score: 0.8 },
    { id: 'remote:kb-1:doc-1:chunk-b', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-b', title: 'B', content: 'mid', score: 0.5 },
  ] } });
  const result = await session.searchRemote({ stage: 'outline', query: '项目', matchCount: 8 });
  assert.deepEqual(result.map((item) => [item.id, item.score, item.content]), [
    ['remote:kb-1:doc-1:chunk-a', 0.8, 'high'],
    ['remote:kb-1:doc-1:chunk-b', 0.5, 'mid'],
  ]);
});

test('does not reorder fused remote results by raw score', async () => {
  const session = createSession({ remoteKnowledgeService: { searchMany: async () => [
    { id: 'remote:kb-1:doc-1:chunk-first', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-first', score: 0.2 },
    { id: 'remote:kb-1:doc-1:chunk-later', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-later', score: 0.9 },
  ] } });
  const result = await session.searchRemote({ stage: 'outline', query: '项目', matchCount: 8 });
  assert.deepEqual(result.map((item) => item.chunkId), ['chunk-first', 'chunk-later']);
});

test('keeps a multi-query group behind one pending task decision', async () => {
  let calls = 0;
  let decisionCalls = 0;
  let resolveDecision;
  const decision = { waitForDecision: () => {
    decisionCalls += 1;
    return new Promise((resolve) => { resolveDecision = resolve; });
  }, cancelTask() {} };
  const session = createSession({
    remoteKnowledgeDecisionService: decision,
    remoteKnowledgeService: { searchMany: async () => { calls += 1; throw new Error('down'); } },
  });
  const first = session.searchRemote({ stage: 'outline', queries: ['a', 'a-补充'] });
  await new Promise((resolve) => setImmediate(resolve));
  const second = session.searchRemote({ stage: 'global-facts', queries: ['b', 'b-补充'] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(decisionCalls, 1);
  resolveDecision('disable-and-continue');
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('forwards a query array through one remote searchMany operation with matchCount', async () => {
  const received = [];
  const session = createSession({ remoteKnowledgeService: { searchMany: async (request) => { received.push(request); return []; } } });
  assert.deepEqual(await session.searchRemote({ stage: 'outline', queries: ['实施流程', '质量验收'], matchCount: 3 }), []);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].queries, ['实施流程', '质量验收']);
  assert.equal(received[0].matchCount, 3);
});

test('uses the legacy query as a one-item searchMany query group', async () => {
  let received;
  const session = createSession({ remoteKnowledgeService: { searchMany: async (request) => { received = request; return []; } } });
  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.deepEqual(received.queries, ['项目']);
  assert.equal(received.matchCount, 8);
  session.disableRemote();
  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.equal(session.isRemoteDisabled(), true);
});

test('does not dispatch remote searchMany when no valid query is provided', async () => {
  let calls = 0;
  const session = createSession({ remoteKnowledgeService: { searchMany: async () => { calls += 1; return []; } } });
  assert.deepEqual(await session.searchRemote({ stage: 'outline', queries: ['  ', null] }), []);
  assert.equal(calls, 0);
});

test('does not dispatch remote searchMany when the task has no selected remote scopes', async () => {
  let calls = 0;
  const session = createSession({
    sessionInput: { remoteScopes: [] },
    remoteKnowledgeService: { searchMany: async () => { calls += 1; return []; } },
  });
  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.equal(calls, 0);
});

test('fails endpoint mismatch and falls back to local references', async () => {
  const session = createSession({
    remoteKnowledgeService: { searchMany: async () => { throw Object.assign(new Error('版本不受支持'), { category: 'incompatible' }); } },
    remoteKnowledgeDecisionService: { waitForDecision: async () => 'disable-and-continue', cancelTask() {} },
  });
  const result = await session.loadReferences({ stage: 'outline', query: '项目' });
  assert.equal(result.local[0].id, 'local:local-doc:local-item');
  assert.deepEqual(result.remote, []);
});

test('never sends stale scope resource IDs to the current remote endpoint', async () => {
  let searchManyCalls = 0;
  let decisionError;
  const session = createSession({
    remoteKnowledgeService: {
      getEndpointFingerprint: () => 'current-endpoint',
      searchMany: async () => { searchManyCalls += 1; return []; },
    },
    remoteKnowledgeDecisionService: {
      waitForDecision: async ({ error }) => { decisionError = error; return 'disable-and-continue'; },
      cancelTask() {},
    },
    sessionInput: {
      remoteScopes: [{ knowledgeBaseId: 'kb-1', mode: 'all', endpointFingerprint: 'old-endpoint', documents: [] }],
    },
  });

  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.equal(searchManyCalls, 0);
  assert.equal(decisionError?.category, 'endpoint-mismatch');
  assert.match(decisionError?.message || '', /重新选择/);
});
