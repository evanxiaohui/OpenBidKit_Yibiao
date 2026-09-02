const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFallbackQueries,
  normalizePlannedQueries,
  planRemoteKnowledgeQueries,
} = require('./remoteKnowledgeQueryPlanner.cjs');

test('normalizes, deduplicates, and limits AI-planned queries without truncating invalid long output', () => {
  const tooLong = `超长原文${'内容'.repeat(130)}`;
  assert.deepEqual(normalizePlannedQueries({ queries: [
    '  项目实施流程有哪些？  ',
    '项目实施流程有哪些？',
    tooLong,
    '质量验收如何组织？',
  ] }), ['项目实施流程有哪些？', '质量验收如何组织？']);
});

test('global-facts fallback scans the complete source and preserves a relevant tail topic', () => {
  const queries = buildFallbackQueries('global-facts', {
    projectOverview: `普通背景。${'一般说明。'.repeat(300)}最终验收采用成果汇交和数据库更新。`,
    bidAnalysis: '',
    outline: [],
  });
  assert.ok(queries.some((query) => /成果汇交|数据库更新/.test(query)));
  assert.ok(queries.length >= 1 && queries.length <= 5);
  assert.ok(queries.every((query) => query.length <= 240));
});

test('uses complete context for AI planning and returns validated short queries', async () => {
  let request;
  const tailMarker = '材料末尾专项主题：不动产登记成果汇交';
  const result = await planRemoteKnowledgeQueries({
    aiService: {
      collectJsonResponse: async (input) => {
        request = input;
        return input.normalizer({ queries: ['不动产登记成果如何汇交和验收？', '成果数据库如何更新？'] });
      },
    },
    stage: 'outline',
    context: { projectOverview: `项目正文${'说明'.repeat(1200)}${tailMarker}` },
    signal: new AbortController().signal,
  });
  assert.match(request.messages.map((item) => item.content).join('\n'), new RegExp(tailMarker));
  assert.equal(request.signal.aborted, false);
  assert.deepEqual(result, {
    queries: ['不动产登记成果如何汇交和验收？', '成果数据库如何更新？'],
    source: 'ai',
  });
});

test('falls back when AI planning fails or returns no valid query', async () => {
  const result = await planRemoteKnowledgeQueries({
    aiService: { collectJsonResponse: async () => { throw new Error('model unavailable'); } },
    stage: 'content-planning',
    context: { chapter: { title: '质量保证措施', description: '验收与整改安排' } },
  });
  assert.equal(result.source, 'fallback');
  assert.ok(result.queries.some((query) => /质量保证措施/.test(query)));
});

test('rethrows cancellation errors from AI planning', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => planRemoteKnowledgeQueries({
    aiService: { collectJsonResponse: async () => { throw new Error('aborted'); } },
    stage: 'outline',
    context: {},
    signal: controller.signal,
  }));
});
