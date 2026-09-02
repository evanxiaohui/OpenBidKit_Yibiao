# Remote Knowledge Multi-Query Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single long-text WeKnora searches with stage-aware short-query planning and deterministic cross-query fusion, without deploying a client-side embedding or rerank model.

**Architecture:** A new Main-process query planner uses the client's existing configured AI service to turn complete stage context into 1–5 short semantic queries, with deterministic stage fallbacks. `remoteKnowledgeService.searchMany()` runs each query through the existing WeKnora endpoint and applies chunk deduplication, RRF fusion, and minimum query coverage; the existing task session retains failure-decision and cancellation semantics.

**Tech Stack:** Electron Main CommonJS, Node.js built-in test runner, existing `aiService.collectJsonResponse`, existing WeKnora REST client, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-remote-knowledge-multi-query-retrieval-design.md`

## Global Constraints

- Work only in `client/`; run client commands from `client/` because the repository has no root `package.json`.
- Main-process files remain CommonJS `.cjs`; explicit text handling uses UTF-8 and must support Windows Chinese paths.
- Client does not load or package an embedding or rerank model. WeKnora owns single-query retrieval/reranking; the client owns deterministic cross-query fusion only.
- Do not modify WeKnora server configuration, retrieval thresholds, Renderer, preload, SQLite schema, Analytics, or remote-knowledge selection persistence.
- Never send a full raw project document as a WeKnora query and never restore the old 1800-character prefix behavior.
- Query-planning AI receives complete stage context; valid output is 1–5 unique queries, each at most 240 characters after normalization. Invalid AI output falls back instead of being truncated.
- Remote references remain untrusted supplementary material; tender/project facts and confirmed plans remain authoritative.
- Preserve `original-only`, zero-hit, task pause/resume, retry, endpoint fingerprint, and “停用远程并继续” behavior.
- Do not log full queries, project material, remote chunks, API keys, or local file paths.
- Every production behavior change follows red-green-refactor and receives a focused Node test before implementation.

---

### Task 1: Add the stage-aware remote query planner

**Files:**
- Create: `client/electron/services/remoteKnowledgeQueryPlanner.cjs`
- Create: `client/electron/services/remoteKnowledgeQueryPlanner.test.cjs`

**Interfaces:**
- Consumes: `aiService.collectJsonResponse({ messages, logTitle, progressLabel, failureMessage, normalizer, validator, max_retries, signal })`.
- Produces: `planRemoteKnowledgeQueries({ aiService, stage, context, signal }): Promise<{ queries: string[], source: 'ai' | 'fallback' }>`.
- Produces: `normalizePlannedQueries(value): string[]`, `buildFallbackQueries(stage, context): string[]`, and `buildQueryPlanningMessages(stage, context): Array<{ role, content }>` for focused tests.

- [ ] **Step 1: Write failing normalization and fallback tests**

Add tests with hand-derived expectations:

```js
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
```

- [ ] **Step 2: Run the planner tests and verify RED**

Run from `client/`:

```powershell
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs
```

Expected: FAIL because `remoteKnowledgeQueryPlanner.cjs` does not exist.

- [ ] **Step 3: Implement normalization and deterministic stage fallbacks**

Implement these constants and normalization rules:

```js
const MAX_QUERY_COUNT = 5;
const MAX_QUERY_LENGTH = 240;

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePlannedQueries(value) {
  const seen = new Set();
  const queries = [];
  for (const raw of Array.isArray(value?.queries) ? value.queries : []) {
    const query = normalizeQuery(raw);
    if (!query || query.length > MAX_QUERY_LENGTH || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length === MAX_QUERY_COUNT) break;
  }
  return queries;
}
```

Implement sentence scanning over every supplied context field. Assign each sentence to stage categories using explicit keyword sets; select the highest-information sentence per category, including sentences found at the end of the input. Wrap selected topics in stage-specific question templates and reject, rather than slice, any query over 240 characters. Use neutral templates such as `该类项目通常包含哪些专业实施阶段和成果要求？` only when no material-derived topic is usable.

- [ ] **Step 4: Run the planner tests and verify GREEN**

```powershell
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs
```

Expected: PASS for normalization, tail scanning, category coverage, and maximum-count assertions.

- [ ] **Step 5: Add failing AI-planning and cancellation tests**

```js
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
```

- [ ] **Step 6: Run the new tests and verify RED**

```powershell
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs
```

Expected: FAIL because AI planning and Prompt construction are not implemented.

- [ ] **Step 7: Implement the planning Prompt and AI fallback boundary**

Use a system message that states all of the following: produce JSON only; return 1–5 complete semantic questions; each query is one intent and at most 160 Chinese characters; do not copy paragraphs; do not invent project facts. Serialize the complete `context` in a user message with stage labels. Call `collectJsonResponse` as follows:

```js
const planned = await aiService.collectJsonResponse({
  messages: buildQueryPlanningMessages(stage, context),
  logTitle: `远程知识查询规划-${stage}`,
  progressLabel: '远程知识查询规划',
  failureMessage: '模型返回的远程知识查询规划无效',
  normalizer: (value) => ({ queries: normalizePlannedQueries(value) }),
  validator: (value) => Array.isArray(value?.queries) && value.queries.length > 0,
  max_retries: 1,
  signal,
});
```

If `signal.aborted`, rethrow the cancellation error. For other planning errors or empty normalized output, return deterministic fallback queries with `source: 'fallback'`.

- [ ] **Step 8: Run all planner tests and syntax validation**

```powershell
node --check electron\services\remoteKnowledgeQueryPlanner.cjs
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit Task 1**

```powershell
git add client/electron/services/remoteKnowledgeQueryPlanner.cjs client/electron/services/remoteKnowledgeQueryPlanner.test.cjs
git commit -m "feat(technical-plan): 规划远程知识短查询"
```

---

### Task 2: Add multi-query WeKnora search and deterministic RRF fusion

**Files:**
- Modify: `client/electron/services/remoteKnowledgeService.cjs:8-181`
- Modify: `client/electron/services/remoteKnowledgeService.test.cjs`

**Interfaces:**
- Consumes: existing `search({ query, scopes, matchCount, signal })` and existing scope grouping.
- Produces: `searchMany({ queries, scopes, matchCount, signal }): Promise<RemoteKnowledgeResult[]>`.
- Preserves: `search()` as a single-query compatibility wrapper.

- [ ] **Step 1: Write failing multi-query request and empty-input tests**

```js
test('searchMany sends every short query through the same remote scopes', async () => {
  const calls = [];
  const service = createServiceWithFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ success: true, data: [] });
  });
  await service.searchMany({
    queries: ['实施流程是什么？', '质量验收如何组织？'],
    scopes: [{ knowledgeBaseId: 'kb-a', mode: 'all', documents: [] }],
    matchCount: 8,
  });
  assert.deepEqual(calls.map((body) => body.query), ['实施流程是什么？', '质量验收如何组织？']);
});

test('searchMany does not dispatch an HTTP request for empty queries', async () => {
  let calls = 0;
  const service = createServiceWithFetch(async () => { calls += 1; return jsonResponse({ data: [] }); });
  assert.deepEqual(await service.searchMany({ queries: [], scopes: [], matchCount: 8 }), []);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run focused service tests and verify RED**

```powershell
node --test electron\services\remoteKnowledgeService.test.cjs
```

Expected: FAIL because `searchMany` is not exposed.

- [ ] **Step 3: Implement query normalization and a single shared HTTP work pool**

Refactor existing single-query search into an internal operation that builds `{ queryIndex, groupIndex, query, group }` jobs. Execute jobs through the existing concurrency helper with one total `SEARCH_CONCURRENCY = 3` pool. Do not nest an unbounded query-level `Promise.all` around the scope-level pool.

The public wrappers are:

```js
async function searchMany({ queries, scopes, matchCount, signal } = {}) {
  const normalizedQueries = normalizeSearchQueries(queries);
  if (!normalizedQueries.length) return [];
  // run query × scope-group jobs, group results by queryIndex, then fuse
}

async function search({ query, scopes, matchCount, signal } = {}) {
  return searchMany({ queries: [query], scopes, matchCount, signal });
}
```

Each query keeps up to 8 candidates from the server response before final fusion. Preserve current WeKnora request bodies: `query`, `knowledge_base_ids`, optional `knowledge_ids`; do not add unsupported client-side threshold or `match_count` fields.

- [ ] **Step 4: Write failing RRF, coverage, deduplication, and compatibility tests**

Build query-specific fixtures where:

- query 1 ranks `chunk-a`, `chunk-shared`, `chunk-b`;
- query 2 ranks `chunk-c`, `chunk-shared`, `chunk-d`;
- final `matchCount` is 3.

Assert the final set contains the first unique result from both queries, contains `chunk-shared` because it accumulates two RRF contributions, and contains no duplicate IDs. Also keep the existing single-query test asserting score order `chunk-1`, `chunk-2` so the compatibility path cannot silently reorder one-query results.

```js
assert.deepEqual(new Set(results.map((item) => item.chunkId)), new Set(['chunk-a', 'chunk-c', 'chunk-shared']));
assert.equal(results.filter((item) => item.chunkId === 'chunk-shared').length, 1);
```

- [ ] **Step 5: Run focused service tests and verify RED**

```powershell
node --test electron\services\remoteKnowledgeService.test.cjs
```

Expected: new fusion assertions FAIL while existing one-query tests still identify the current behavior.

- [ ] **Step 6: Implement deterministic RRF and coverage selection**

Use `RRF_K = 60`. For every per-query list, sort by original score descending and stable encounter order, dedupe within the query, then accumulate:

```js
entry.rrfScore += 1 / (RRF_K + rank);
entry.queryIndexes.add(queryIndex);
entry.bestScore = Math.max(entry.bestScore, item.score);
entry.firstSeen = Math.min(entry.firstSeen, encounterIndex);
```

Select one highest-ranked unseen chunk from each non-empty query list in query order, then fill the remaining budget by descending `rrfScore`, descending query-hit count, descending `bestScore`, and ascending `firstSeen`. Return the original public result shape without RRF metadata.

- [ ] **Step 7: Run service tests, syntax check, and mutation checks**

```powershell
node --check electron\services\remoteKnowledgeService.cjs
node --test electron\services\remoteKnowledgeService.test.cjs
```

Expected: exit 0. Mentally verify tests fail for `RRF_K` accumulation removal, coverage-loop removal, wrong dedupe key, or accidental single-query order changes.

- [ ] **Step 8: Commit Task 2**

```powershell
git add client/electron/services/remoteKnowledgeService.cjs client/electron/services/remoteKnowledgeService.test.cjs
git commit -m "feat(technical-plan): 融合多查询远程知识结果"
```

---

### Task 3: Extend the task knowledge session to accept query arrays

**Files:**
- Modify: `client/electron/services/knowledgeReferenceService.cjs:59-120`
- Modify: `client/electron/services/knowledgeReferenceService.test.cjs`

**Interfaces:**
- Consumes: `remoteKnowledgeService.searchMany({ queries, scopes, matchCount, signal })` from Task 2.
- Produces: `session.searchRemote({ stage, queries, query, matchCount })`, with `query` retained only for compatibility.
- Preserves: task-level pending decision gate, endpoint fingerprint rejection, local-first `loadReferences()`, and `remoteDisabledForRun`.

- [ ] **Step 1: Write failing forwarding and compatibility tests**

```js
test('forwards query arrays to one searchMany operation', async () => {
  let received;
  const session = createSession({ remoteKnowledgeService: {
    searchMany: async (input) => { received = input; return []; },
  } });
  await session.searchRemote({ stage: 'outline', queries: ['流程？', '验收？'], matchCount: 8 });
  assert.deepEqual(received.queries, ['流程？', '验收？']);
  assert.equal(received.matchCount, 8);
});

test('normalizes the legacy single query into a one-item query array', async () => {
  let received;
  const session = createSession({ remoteKnowledgeService: {
    searchMany: async (input) => { received = input; return []; },
  } });
  await session.searchRemote({ stage: 'outline', query: '项目' });
  assert.deepEqual(received.queries, ['项目']);
});
```

Update the task-session test doubles from `search` to `searchMany`. Keep single-query backward compatibility at the public `remoteKnowledgeService.search()` wrapper and test that wrapper in `remoteKnowledgeService.test.cjs`; the task session itself always calls `searchMany()`.

- [ ] **Step 2: Run focused session tests and verify RED**

```powershell
node --test electron\services\knowledgeReferenceService.test.cjs
```

Expected: FAIL because the session still forwards only `query` to `search()`.

- [ ] **Step 3: Implement query-array normalization at the session boundary**

Normalize `queries` first and fall back to `[query]`. Return `[]` immediately when there is no valid query. Within the existing retry/decision loop call `searchMany` once per attempt:

```js
const found = await remoteKnowledgeService.searchMany({
  queries: normalizedQueries,
  scopes: session.remoteScopes,
  matchCount: limit,
  signal: session.signal,
});
```

Keep the current post-service defensive dedupe and limit. Do not move the endpoint compatibility check or create one decision per query.

- [ ] **Step 4: Add regression coverage for decision and endpoint behavior**

Adapt the existing “blocks a second remote dispatch” and stale endpoint tests to `searchMany`. Assert a multi-query group produces one pending decision and no stale scope reaches the remote service.

- [ ] **Step 5: Run focused tests and syntax validation**

```powershell
node --check electron\services\knowledgeReferenceService.cjs
node --test electron\services\knowledgeReferenceService.test.cjs
```

Expected: exit 0.

- [ ] **Step 6: Commit Task 3**

```powershell
git add client/electron/services/knowledgeReferenceService.cjs client/electron/services/knowledgeReferenceService.test.cjs
git commit -m "feat(technical-plan): 传递远程知识查询组"
```

---

### Task 4: Integrate multi-query planning into outline generation

**Files:**
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs:527-532,697-749,1322`
- Modify: `client/electron/services/outlineGenerationTaskV2.test.cjs:4-12,76-94,184-205`

**Interfaces:**
- Consumes: `planRemoteKnowledgeQueries()` from Task 1.
- Consumes: `knowledgeSession.searchRemote({ stage: 'outline', queries, matchCount })` from Task 3.
- Removes: `buildOutlineRetrievalQuery()` public test contract.

- [ ] **Step 1: Replace the obsolete long-query unit test with a failing integration test**

Delete the assertion that the directory query exceeds 1800 characters. In the real task test, provide an `aiService.collectJsonResponse` stub keyed by `logTitle === '远程知识查询规划-outline'`, return three literal queries, and assert:

```js
assert.deepEqual(searches[0], {
  stage: 'outline',
  queries: ['土地延包实施流程有哪些？', '成果汇交如何验收？', '质量和进度如何控制？'],
  matchCount: 8,
});
```

Also assert the planning Prompt contains markers placed at the end of project overview, response requirements, and technical requirements.

- [ ] **Step 2: Run the outline tests and verify RED**

```powershell
node --test electron\services\outlineGenerationTaskV2.test.cjs
```

Expected: FAIL because the task still sends one `query` and never calls the planner.

- [ ] **Step 3: Implement outline planning before the remote search**

Import `planRemoteKnowledgeQueries`. Replace `buildOutlineRetrievalQuery()` with the planner call:

```js
const queryPlan = await planRemoteKnowledgeQueries({
  aiService,
  stage: 'outline',
  context: {
    projectOverview: storedPlan.projectOverview || '',
    responseRequirements: responseFileRequirements,
    technicalRequirements: storedPlan.techRequirements || '',
    outlineTarget: taskInstruction,
  },
  signal: taskControl?.signal,
});
const remoteItems = await knowledgeSession.searchRemote({
  stage: 'outline',
  queries: queryPlan.queries,
  matchCount: 8,
});
```

Run this only when remote knowledge is available and `originalOnly` is false. Keep `buildRemoteKnowledgeFile()` and the Agent workspace contract unchanged.

- [ ] **Step 4: Run outline tests and syntax validation**

```powershell
node --check electron\services\outlineGenerationTaskV2.cjs
node --test electron\services\outlineGenerationTaskV2.test.cjs
```

Expected: exit 0, including existing `original-only` behavior.

- [ ] **Step 5: Commit Task 4**

```powershell
git add client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs
git commit -m "feat(technical-plan): 按目录阶段规划远程查询"
```

---

### Task 5: Integrate multi-query planning into global facts

**Files:**
- Modify: `client/electron/services/globalFactsTaskV2.cjs:147-160,440-455,539-550`
- Modify: `client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs`

**Interfaces:**
- Consumes: `planRemoteKnowledgeQueries()` from Task 1.
- Consumes: `knowledgeSession.searchRemote({ stage: 'global-facts', queries, matchCount })` from Task 3.
- Preserves: `buildGlobalFactsRetrievalTopics()` as the complete-input deterministic fallback source.

- [ ] **Step 1: Replace the obsolete full-query test with failing multi-query assertions**

Remove `assert.ok(searches[0].query.length > 1800)`. Stub the planning AI to return queries covering scope, schedule, and acceptance; assert `searches[0].queries` equals those values and no `query` property is present. Assert the planning Prompt contains a relevant marker at the end of the project overview.

Update the existing “stage、query、budget” test name to “stage、queries、budget”; keep its local-material and zero-hit assertions.

- [ ] **Step 2: Run global-facts tests and verify RED**

```powershell
node --test electron\services\globalFactsTaskV2.remoteKnowledge.test.cjs
```

Expected: FAIL because production still joins all topics with `；`.

- [ ] **Step 3: Implement global-facts query planning**

Import the planner and call it with:

```js
const queryPlan = await planRemoteKnowledgeQueries({
  aiService,
  stage: 'global-facts',
  context: {
    projectOverview: storedPlan.projectOverview || '',
    bidAnalysis: formatBidAnalysisFactsForPrompt(storedPlan),
    outline: outlineData.outline || [],
    fallbackTopics: retrievalTopics,
  },
  signal: taskControl?.signal,
});
```

Add `aiService` to the existing `runGlobalFactsTaskV2` parameter destructuring; `taskService` already supplies its queue-scoped AI service to every runner, so no task-service interface change is needed. Pass `queryPlan.queries` to `searchRemote`. Keep the existing `remaining = Math.max(0, 8 - knowledgeItems.length)` local-first budget, provenance allowlist, and remote-only fact filtering.

- [ ] **Step 4: Run global-facts tests and syntax validation**

```powershell
node --check electron\services\globalFactsTaskV2.cjs
node --test electron\services\globalFactsTaskV2.remoteKnowledge.test.cjs
```

Expected: exit 0.

- [ ] **Step 5: Commit Task 5**

```powershell
git add client/electron/services/globalFactsTaskV2.cjs client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs
git commit -m "feat(technical-plan): 按事实阶段规划远程查询"
```

---

### Task 6: Integrate per-section multi-query planning into content planning

**Files:**
- Modify: `client/electron/services/contentGenerationTask.cjs:2582-2592,3963-3984,6878`
- Modify: `client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs`

**Interfaces:**
- Consumes: `planRemoteKnowledgeQueries()` from Task 1.
- Consumes: `knowledgeSession.searchRemote({ stage: 'content-planning', queries, matchCount })` from Task 3.
- Preserves: `remoteKnowledgeReferencesBySection`, retry snapshot reuse, and per-section allowlists.
- Removes: `buildContentPlanningRetrievalQuery()` public test contract.

- [ ] **Step 1: Replace the single-query unit test with a failing per-section query-plan test**

Delete the `buildContentPlanningRetrievalQuery()` import and its concatenated-text test. In the concurrent content-planning test, make `aiService.collectJsonResponse` distinguish query planning by `logTitle`:

```js
if (logTitle === '远程知识查询规划-content-planning') {
  const sectionId = sectionIds.find((id) => prompt.includes(`章节-${id}`));
  return normalizer({ queries: [`章节-${sectionId}实施方法？`, `章节-${sectionId}如何验收？`] });
}
```

Change the knowledge-session stub to inspect `queries.join('\n')` and record each request. Assert each section receives only its own two queries and keeps only its own remote candidates.

- [ ] **Step 2: Run content remote-knowledge tests and verify RED**

```powershell
node --test electron\services\contentGenerationTask.remoteKnowledge.test.cjs
```

Expected: FAIL because the production task still constructs one long query.

- [ ] **Step 3: Implement per-section query planning**

Import the planner. In `retrieveRemoteKnowledgeForPlanning(context)`, build the complete stage context and plan before calling the session:

```js
const queryPlan = await planRemoteKnowledgeQueries({
  aiService,
  stage: 'content-planning',
  context: {
    chapter: context.item,
    projectOverview,
    bidAnalysisFactsText,
    globalFactTitlesText,
    technicalRequirements: techRequirements,
  },
  signal: taskControl?.signal,
});
const found = await knowledgeSession.searchRemote({
  stage: 'content-planning',
  queries: queryPlan.queries,
  matchCount: 8,
});
```

Preserve pause-like error propagation. Do not catch a canceled planning request as an ordinary remote zero-hit. Keep the existing section snapshot write before downstream content generation.

- [ ] **Step 4: Verify retry and concurrency regressions**

```powershell
node --check electron\services\contentGenerationTask.cjs
node --test electron\services\contentGenerationTask.remoteKnowledge.test.cjs
```

Expected: exit 0. The “失败章节重试保留锁定远程片段且不发起第二次检索” test must still assert zero new searches and zero new query-planning calls during snapshot reuse.

- [ ] **Step 5: Commit Task 6**

```powershell
git add client/electron/services/contentGenerationTask.cjs client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs
git commit -m "feat(technical-plan): 按正文小节规划远程查询"
```

---

### Task 7: Run focused regression, build verification, and final diff review

**Files:**
- Verify: all files changed in Tasks 1–6
- Update only if evidence requires: `docs/superpowers/specs/2026-09-02-remote-knowledge-multi-query-retrieval-design.md`

**Interfaces:**
- Consumes: completed multi-query implementation.
- Produces: fresh syntax, targeted-test, build, and diff evidence.

- [ ] **Step 1: Run CommonJS syntax checks**

From `client/`:

```powershell
node --check electron\services\remoteKnowledgeQueryPlanner.cjs
node --check electron\services\remoteKnowledgeService.cjs
node --check electron\services\knowledgeReferenceService.cjs
node --check electron\services\outlineGenerationTaskV2.cjs
node --check electron\services\globalFactsTaskV2.cjs
node --check electron\services\contentGenerationTask.cjs
```

Expected: every command exits 0 with no syntax error.

- [ ] **Step 2: Run the complete focused remote-knowledge regression set**

```powershell
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs electron\services\remoteKnowledgeService.test.cjs electron\services\knowledgeReferenceService.test.cjs electron\services\outlineGenerationTaskV2.test.cjs electron\services\globalFactsTaskV2.remoteKnowledge.test.cjs electron\services\contentGenerationTask.remoteKnowledge.test.cjs
```

Expected: all tests pass with zero failures, cancellations, or skipped tests.

- [ ] **Step 3: Run the client build**

```powershell
npm run build
```

Expected: `tsc --noEmit && vite build` exits 0. Existing Vite chunk-size warnings are acceptable; new errors or warnings from changed code are not.

- [ ] **Step 4: Review the final diff against the spec**

From the repository worktree root:

```powershell
git diff --check
git diff dea341d^ -- client/electron/services docs/superpowers/specs/2026-09-02-remote-knowledge-multi-query-retrieval-design.md docs/superpowers/plans/2026-09-02-remote-knowledge-multi-query-retrieval.md
git status --short
```

Confirm from the diff that:

- no production path sends full raw project material as one query;
- no `slice(0, 1800)` or “query length must exceed 1800” assertion remains;
- no client-side rerank model or dependency was introduced;
- query planning receives complete stage context;
- RRF, coverage, dedupe, decision, cancellation, and per-section snapshots are tested;
- unrelated worktree changes are absent.

- [ ] **Step 5: Commit any verification-only corrections**

If verification exposed a real defect, reproduce it with a failing focused test, fix minimally, rerun Steps 1–4, then commit only the correction files:

```powershell
git add client/electron/services/remoteKnowledgeQueryPlanner.cjs client/electron/services/remoteKnowledgeQueryPlanner.test.cjs client/electron/services/remoteKnowledgeService.cjs client/electron/services/remoteKnowledgeService.test.cjs client/electron/services/knowledgeReferenceService.cjs client/electron/services/knowledgeReferenceService.test.cjs client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs client/electron/services/globalFactsTaskV2.cjs client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs client/electron/services/contentGenerationTask.cjs client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs
git commit -m "fix(technical-plan): 修正多查询检索回归"
```

If no correction was needed, do not create an empty commit.

- [ ] **Step 6: Record the external quality-acceptance boundary in the handoff**

Report automated test counts, build exit status, changed commits, and the isolated worktree path. State explicitly that Recall@8, scoring-requirement coverage, irrelevant-result ratio, and latency comparisons across A/B/C require a live WeKnora dataset and remain external acceptance evidence; do not claim those quality metrics from unit tests alone.
