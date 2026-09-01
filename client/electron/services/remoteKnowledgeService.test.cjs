const assert = require('node:assert/strict');
const test = require('node:test');

const { createRemoteKnowledgeService } = require('./remoteKnowledgeService.cjs');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createServiceWithFetch(fetchImpl) {
  return createRemoteKnowledgeService({
    config: { base_url: 'http://remote.example/api/v1', api_key: 'test-api-key' },
    fetchImpl,
    retryDelays: [0, 0],
  });
}

test('maps remote knowledge bases and documents to generic remote knowledge models', async () => {
  const service = createServiceWithFetch(async (url) => {
    if (url.endsWith('/knowledge-bases')) {
      return jsonResponse({ success: true, data: [{ id: 'kb-a', name: '施工规范', description: '现行规范' }] });
    }
    return jsonResponse({
      success: true,
      data: [{ id: 'doc-1', knowledge_base_id: 'kb-a', title: '招标文件', parse_status: 'completed' }],
      total: 1,
      page: 1,
      page_size: 20,
    });
  });

  assert.deepEqual(await service.listKnowledgeBases(), [{
    id: 'kb-a',
    name: '施工规范',
    description: '现行规范',
  }]);
  assert.deepEqual(await service.listDocuments({ knowledgeBaseId: 'kb-a', page: 1, pageSize: 20 }), {
    items: [{
      id: 'doc-1',
      knowledgeBaseId: 'kb-a',
      title: '招标文件',
      parseStatus: 'completed',
    }],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

test('splits whole-library and document-limited scopes to preserve mixed semantics', async () => {
  const calls = [];
  const service = createServiceWithFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ data: { results: [] } });
  });
  await service.search({
    query: '施工组织设计',
    scopes: [
      { knowledgeBaseId: 'kb-a', mode: 'all', documents: [] },
      { knowledgeBaseId: 'kb-b', mode: 'documents', documents: [{ knowledgeId: 'doc-1', title: '规范' }] },
    ],
    matchCount: 8,
  });
  assert.equal(calls[0].url, 'http://remote.example/api/v1/knowledge-search');
  assert.equal(calls[1].url, 'http://remote.example/api/v1/knowledge-search');
  assert.deepEqual(calls[0].body.knowledge_base_ids, ['kb-a']);
  assert.equal(Object.hasOwn(calls[0].body, 'knowledge_ids'), false);
  assert.deepEqual(calls[1].body.knowledge_base_ids, ['kb-b']);
  assert.deepEqual(calls[1].body.knowledge_ids, ['doc-1']);
  assert.equal(calls[0].body.query, '施工组织设计');
  assert.equal(calls[1].body.query, '施工组织设计');
  assert.equal(Object.hasOwn(calls[0].body, 'query_text'), false);
  assert.equal(Object.hasOwn(calls[1].body, 'query_text'), false);
  assert.equal(Object.hasOwn(calls[0].body, 'match_count'), false);
  assert.equal(Object.hasOwn(calls[1].body, 'match_count'), false);
});

test('maps returned chunks to generic remote knowledge search results', async () => {
  const service = createServiceWithFetch(async () => jsonResponse({
    success: true,
    data: [{
      id: 'chunk-1',
      knowledge_base_id: 'kb-a',
      knowledge_id: 'doc-1',
      knowledge_title: '施工组织设计',
      content: '施工总体部署',
      score: '0.86',
    }],
  }));

  const results = await service.search({
    query: '施工组织设计',
    scopes: [{ knowledgeBaseId: 'kb-a', mode: 'all', documents: [] }],
    matchCount: 8,
  });

  assert.deepEqual(results, [{
    id: 'remote:kb-a:doc-1:chunk-1',
    origin: 'remote',
    knowledgeBaseId: 'kb-a',
    knowledgeId: 'doc-1',
    chunkId: 'chunk-1',
    title: '施工组织设计',
    content: '施工总体部署',
    score: 0.86,
  }]);
});

test('returns no generic results when every scope has zero hits', async () => {
  const service = createServiceWithFetch(async () => jsonResponse({ success: true, data: { results: [] } }));

  assert.deepEqual(await service.search({
    query: '不存在',
    scopes: [{ knowledgeBaseId: 'kb-a', mode: 'all', documents: [] }],
    matchCount: 8,
  }), []);
});

test('caps merged generic remote knowledge results to the requested match count', async () => {
  const service = createServiceWithFetch(async () => jsonResponse({
    success: true,
    data: [
      { id: 'chunk-1', knowledge_base_id: 'kb-a', knowledge_id: 'doc-1', content: '一', score: 0.9 },
      { id: 'chunk-2', knowledge_base_id: 'kb-a', knowledge_id: 'doc-1', content: '二', score: 0.8 },
      { id: 'chunk-3', knowledge_base_id: 'kb-a', knowledge_id: 'doc-1', content: '三', score: 0.7 },
    ],
  }));

  const results = await service.search({
    query: '施工组织设计',
    scopes: [{ knowledgeBaseId: 'kb-a', mode: 'all', documents: [] }],
    matchCount: 2,
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.chunkId), ['chunk-1', 'chunk-2']);
});

test('testConnection rejects a server without the v0.7.2 knowledge-base shape', async () => {
  const service = createServiceWithFetch(async () => jsonResponse({ success: true, data: [{ id: 'kb-a' }] }));

  await assert.rejects(service.testConnection(), (error) => {
    assert.equal(error.category, 'incompatible');
    assert.equal(error.message, '远程知识服务版本不受支持，请升级到 v0.7.2 或以上');
    return true;
  });
});

test('testConnection reports a valid v0.7.2 knowledge-base list', async () => {
  const service = createServiceWithFetch(async () => jsonResponse({ success: true, data: [{ id: 'kb-a', name: '施工规范' }] }));

  assert.deepEqual(await service.testConnection(), {
    knowledgeBaseCount: 1,
  });
});
