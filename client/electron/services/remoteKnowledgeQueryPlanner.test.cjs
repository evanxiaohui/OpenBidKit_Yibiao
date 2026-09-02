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

test('fallback chooses the highest-information sentence within a category', () => {
  const queries = buildFallbackQueries('global-facts', {
    source: '项目质量控制应符合相关要求。最终成果汇交包括成果数据库更新、检查验收和资料归档。',
  });
  assert.ok(queries.some((query) => /成果汇交|数据库更新/.test(query)));
});

test('fallback behavior is stage-aware for the same context', () => {
  const context = { source: '项目实施流程、技术标准、质量验收和人员培训均有明确要求。' };
  const outline = buildFallbackQueries('outline', context);
  const globalFacts = buildFallbackQueries('global-facts', context);
  const contentPlanning = buildFallbackQueries('content-planning', context);
  assert.notDeepEqual(outline, globalFacts);
  assert.notDeepEqual(globalFacts, contentPlanning);
  for (const queries of [outline, globalFacts, contentPlanning]) {
    assert.ok(queries.length >= 1 && queries.length <= 5);
    assert.ok(queries.every((query) => query.length <= 240));
  }
});

test('fallback derives a short project topic instead of copying a raw source sentence', () => {
  const source = '本项目为某市不动产登记成果数据库建设服务，需统筹实施、质量验收、资料归档和后续运维保障等工作。';
  const queries = buildFallbackQueries('outline', { projectOverview: source });
  assert.ok(queries.some((query) => /不动产登记|数据库建设/.test(query)));
  assert.ok(queries.every((query) => query.length < source.length));
  assert.ok(queries.every((query) => !query.includes(source)));
});

test('rejects raw paragraph-like AI output instead of truncating it', async () => {
  const rawParagraph = `本项目需要结合现场调研、数据整理、系统建设、质量检查、成果汇交和持续运维等多个环节，形成完整的实施方案并满足招标文件中的全部要求。${'补充说明'.repeat(12)}`;
  const result = await planRemoteKnowledgeQueries({
    aiService: { collectJsonResponse: async (input) => input.normalizer({ queries: [rawParagraph] }) },
    stage: 'outline',
    context: { projectOverview: '不动产登记数据库项目' },
  });
  assert.equal(result.source, 'fallback');
  assert.ok(result.queries.every((query) => !query.includes('本项目需要结合现场调研')));
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

test('rethrows queue-scope pause errors instead of falling back to remote retrieval', async () => {
  const error = new Error('AI 请求队列已暂停');
  error.code = 'AI_QUEUE_SCOPE_PAUSED';
  await assert.rejects(() => planRemoteKnowledgeQueries({
    aiService: { collectJsonResponse: async () => { throw error; } },
    stage: 'content-planning',
    context: { chapter: { title: '质量保证措施', description: '验收与整改安排' } },
    signal: new AbortController().signal,
  }), (actual) => actual === error);
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
