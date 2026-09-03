const assert = require('node:assert/strict');
const test = require('node:test');

const { createRemoteKnowledgeClient } = require('./weKnoraClient.cjs');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createClient(fetchImpl, options = {}) {
  return createRemoteKnowledgeClient({
    config: { base_url: 'http://remote.example/api/v1', api_key: 'test-api-key' },
    fetchImpl,
    retryDelays: [0, 0],
    ...options,
  });
}

test('lists knowledge bases through the v0.7.2 endpoint', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ success: true, data: [{ id: 'kb-a', name: '施工规范' }] });
  });

  const knowledgeBases = await client.listKnowledgeBases();

  assert.deepEqual(knowledgeBases, [{ id: 'kb-a', name: '施工规范' }]);
  assert.equal(calls[0].url, 'http://remote.example/api/v1/knowledge-bases');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['X-API-Key'], 'test-api-key');
  assert.match(calls[0].init.headers['X-Request-ID'], /^[0-9a-f-]{36}$/i);
});

test('reads a document page with server pagination metadata', async () => {
  const client = createClient(async (url) => {
    assert.equal(url, 'http://remote.example/api/v1/knowledge-bases/kb-a/knowledge?page=2&page_size=25');
    return jsonResponse({
      success: true,
      data: [{ id: 'doc-1', knowledge_base_id: 'kb-a', title: '招标文件' }],
      total: 31,
      page: 2,
      page_size: 25,
    });
  });

  const page = await client.listKnowledge({ knowledgeBaseId: 'kb-a', page: 2, pageSize: 25 });

  assert.deepEqual(page, {
    items: [{ id: 'doc-1', knowledge_base_id: 'kb-a', title: '招标文件' }],
    total: 31,
    page: 2,
    pageSize: 25,
  });
});

test('posts a whole-library search to the cross-library endpoint without document IDs', async () => {
  const client = createClient(async (url, init) => {
    assert.equal(url, 'http://remote.example/api/v1/knowledge-search');
    assert.deepEqual(JSON.parse(init.body), {
      query: '施工组织设计',
      knowledge_base_ids: ['kb-a'],
    });
    return jsonResponse({ success: true, data: { results: [] } });
  });

  const results = await client.hybridSearch({
    query: '施工组织设计',
    knowledgeBaseIds: ['kb-a'],
    matchCount: 8,
  });

  assert.deepEqual(results, []);
});

test('posts a document-limited search to the cross-library endpoint with only the selected document IDs', async () => {
  const client = createClient(async (url, init) => {
    assert.equal(url, 'http://remote.example/api/v1/knowledge-search');
    assert.deepEqual(JSON.parse(init.body), {
      query: '施工组织设计',
      knowledge_base_ids: ['kb-b'],
      knowledge_ids: ['doc-1'],
    });
    return jsonResponse({ success: true, data: [] });
  });

  const results = await client.hybridSearch({
    query: '施工组织设计',
    knowledgeBaseIds: ['kb-b'],
    knowledgeIds: ['doc-1'],
    matchCount: 8,
  });

  assert.deepEqual(results, []);
});

test('returns zero search hits as an empty result set', async () => {
  const client = createClient(async () => jsonResponse({ success: true, data: [] }));

  assert.deepEqual(await client.hybridSearch({ query: '不存在', knowledgeBaseIds: ['kb-a'], matchCount: 8 }), []);
});

test('retries a timed out request exactly twice after the first attempt', async () => {
  let attempts = 0;
  const client = createClient((_url, init) => new Promise((_resolve, reject) => {
    attempts += 1;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }), { timeoutMs: 5 });

  await assert.rejects(client.listKnowledgeBases(), (error) => error.category === 'timeout');
  assert.equal(attempts, 3);
});

test('retries network failures exactly twice after the first attempt', async () => {
  let attempts = 0;
  const client = createClient(async () => {
    attempts += 1;
    throw new TypeError('connection reset');
  });

  await assert.rejects(client.listKnowledgeBases(), (error) => error.category === 'network');
  assert.equal(attempts, 3);
});

for (const status of [429, 500, 501, 599]) {
  test(`retries HTTP ${status} exactly twice after the first attempt`, async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;
      return jsonResponse({ success: false }, status);
    });

    await assert.rejects(client.listKnowledgeBases(), (error) => error.httpStatus === status);
    assert.equal(attempts, 3);
  });
}

test('keeps one request ID across retries and exposes it on the final error', async () => {
  const requestIds = [];
  const client = createClient(async (_url, init) => {
    requestIds.push(init.headers['X-Request-ID']);
    return jsonResponse({ success: false }, 503);
  });

  await assert.rejects(client.listKnowledgeBases(), (error) => {
    assert.equal(error.category, 'http');
    assert.equal(error.httpStatus, 503);
    assert.equal(error.requestId, requestIds[0]);
    return true;
  });
  assert.equal(requestIds.length, 3);
  assert.equal(new Set(requestIds).size, 1);
});

for (const status of [401, 403, 404]) {
  test(`does not retry HTTP ${status}`, async () => {
    let attempts = 0;
    const client = createClient(async () => {
      attempts += 1;
      return jsonResponse({ success: false }, status);
    });

    await assert.rejects(client.listKnowledgeBases(), (error) => error.httpStatus === status);
    assert.equal(attempts, 1);
  });
}

test('rejects an incompatible JSON response without exposing request data', async () => {
  const client = createClient(async () => jsonResponse({ success: true, data: { unexpected: true } }));

  await assert.rejects(client.listKnowledgeBases(), (error) => {
    assert.equal(error.category, 'incompatible');
    assert.doesNotMatch(error.message, /test-api-key/);
    return true;
  });
});

test('does not retry a caller cancellation', async () => {
  let attempts = 0;
  const controller = new AbortController();
  controller.abort();
  const client = createClient(async () => {
    attempts += 1;
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });

  await assert.rejects(client.listKnowledgeBases({ signal: controller.signal }), (error) => error.category === 'cancelled');
  assert.equal(attempts, 0);
});
