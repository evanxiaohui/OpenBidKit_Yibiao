const assert = require('node:assert/strict');
const test = require('node:test');

const { createKnowledgeReferenceService } = require('./knowledgeReferenceService.cjs');

function createSession(overrides = {}) {
  const local = {
    readReferences: () => [{ document: { id: 'local-doc', file_name: '本地规范' }, items: [
      { id: 'local-item', title: '本地条目', resume: '本地摘要', content: '本地内容' },
    ] }],
  };
  const remote = { search: async () => [] };
  return createKnowledgeReferenceService({ knowledgeBaseService: local, remoteKnowledgeService: remote, ...overrides })
    .createTaskSession({
      taskId: 'task-1', workflow: 'technical-plan', localDocumentIds: ['local-doc'],
      remoteScopes: [{ knowledgeBaseId: 'kb-1', mode: 'all', documents: [] }],
    });
}

test('uses namespaced IDs and keeps local references before remote references', async () => {
  const session = createSession({ remoteKnowledgeService: { search: async () => [
    { id: 'remote:kb-1:doc-1:chunk-high', origin: 'remote', knowledgeBaseId: 'kb-1', knowledgeId: 'doc-1', chunkId: 'chunk-high', title: '远程', content: '远程内容', score: 0.9 },
  ] } });
  const local = await session.loadLocalReferences();
  const remote = await session.searchRemote({ stage: 'outline', query: '项目', matchCount: 8 });
  assert.equal(local[0].id, 'local:local-doc:local-item');
  assert.deepEqual([...local, ...remote].map((item) => item.id), ['local:local-doc:local-item', 'remote:kb-1:doc-1:chunk-high']);
});

test('deduplicates remote chunks by source and preserves highest score ordering', async () => {
  const session = createSession({ remoteKnowledgeService: { search: async () => [
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

test('passes matchCount eight and returns local-only fallback when remote is disabled', async () => {
  let received;
  const session = createSession({ remoteKnowledgeService: { search: async (request) => { received = request; return []; } } });
  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.equal(received.matchCount, 8);
  session.disableRemote();
  assert.deepEqual(await session.searchRemote({ stage: 'outline', query: '项目' }), []);
  assert.equal(session.isRemoteDisabled(), true);
});

test('fails endpoint mismatch and falls back to local references', async () => {
  const session = createSession({ remoteKnowledgeService: { search: async () => { throw Object.assign(new Error('版本不受支持'), { category: 'incompatible' }); } } });
  const result = await session.loadReferences({ stage: 'outline', query: '项目' });
  assert.equal(result.local[0].id, 'local:local-doc:local-item');
  assert.deepEqual(result.remote, []);
});
