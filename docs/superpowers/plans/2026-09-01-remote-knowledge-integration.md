# Remote Knowledge Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变本地知识库页面与可研流程的前提下，为技术方案和已有方案扩写接入一个可配置、只读的远程知识服务，并在目录、全局事实、正文规划与正文生成阶段提供可恢复的动态检索能力。

**Architecture:** Electron Main 新增通用 `remoteKnowledgeService`、WeKnora v0.7.2+ HTTP 适配器、统一 `knowledgeReferenceService` 和任务级失败决策闸门；Renderer 仅负责设置、范围选择和全局决策弹窗。远程选择保存在技术方案 SQLite 工作区，任务启动时形成不可变快照，正文运行态保存实际采用的远程片段。

**Tech Stack:** Electron CommonJS、React 18 + TypeScript、Radix UI、better-sqlite3、Node/Electron 原生 `fetch`、Node `node:test`、Vite、electron-builder。

**Spec:** `docs/superpowers/specs/2026-09-01-remote-knowledge-integration-design.md`

## Global Constraints

- 业务界面、业务类型、SQLite 表和 IPC 使用“远程知识”命名；只有 Main 内部适配器和设置说明可以出现 WeKnora。
- 现有 `KnowledgeBasePage`、本地知识库 IPC/Store、可研报告、Analytics Worker/Dashboard 不改业务行为。
- Renderer 不执行远程 HTTP；检索正文不经过 Renderer，也不写普通日志、Toast 或 Analytics。
- `base_url` 默认提交为 `http://192.168.231.16:8080/api/v1`；共享 Key 只进入 Git 忽略的 `client/build-secrets/default-remote-knowledge.json`。
- 不新增 HTTP 依赖。Main 使用 Electron 自带 Node 的 `fetch`，所有 `.cjs` 保持 CommonJS。
- 每个任务只暂存本任务列出的文件；工作区已有的 `client/src/App.tsx`、`client/src/components/Sidebar.tsx`、`client/src/styles/layout-app-shell.css`、`client/scripts/app-notice-smoke.cjs` 和 `.superpowers/` 不得提交、覆盖或清理。
- 开始实现前确认分支仍为 `kb`；若已变化，停止并向用户报告，不自行切换分支。

## Interface Map

### Shared business types

```ts
export type RemoteKnowledgeScopeMode = 'all' | 'documents';

export interface RemoteKnowledgeDocumentSelection {
  knowledgeId: string;
  title: string;
}

export interface RemoteKnowledgeScope {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  mode: RemoteKnowledgeScopeMode;
  documents: RemoteKnowledgeDocumentSelection[];
  endpointFingerprint: string;
}

export interface RemoteKnowledgeBase {
  id: string;
  name: string;
  description?: string;
  documentCount?: number;
}

export interface RemoteKnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  status?: string;
}

export interface RemoteKnowledgeDecision {
  decisionId: string;
  taskId: string;
  workflow: 'technical-plan' | 'existing-plan-expansion';
  stage: 'outline' | 'global-facts' | 'content-planning' | 'content-generation';
  category: string;
  summary: string;
  httpStatus?: number;
  requestId?: string;
  occurredAt: string;
}
```

### Main service contracts

```js
createWeKnoraClient({ fetchImpl, timeoutMs, retryDelays })
  .request({ config, method, path, body, signal })

createRemoteKnowledgeService({ configStore, client })
  .getConnectionConfig()
  .getEndpointFingerprint()
  .testConnection(configOverride)
  .listKnowledgeBases()
  .listDocuments({ knowledgeBaseId, page, pageSize })
  .search({ query, scopes, matchCount, signal })

createRemoteKnowledgeDecisionService({ emitDecision })
  .waitForDecision({ taskId, workflow, stage, error, signal })
  .getPendingDecision()
  .resolveDecision({ decisionId, action })
  .cancelTask(taskId, reason)

createKnowledgeReferenceService({ knowledgeBaseService, remoteKnowledgeService })
  .createTaskSession({ taskId, workflow, localDocumentIds, remoteScopes, taskControl })
```

The task session exposes stage-specific local and remote loading while retaining one task-scoped remote decision gate:

```js
session.searchRemote({ stage, query, matchCount })
session.loadLocalReferences(documentIds)
session.isRemoteDisabled()
session.dispose()
```

### Data flow

```text
OutlineEditPage
  -> technical-plan:save-outline-config
  -> technicalPlanStore transaction
  -> local IDs + remote scopes

taskService
  -> immutable knowledge selection snapshot
  -> knowledgeReferenceService task session
  -> local knowledgeBaseService
  -> remoteKnowledgeService
  -> WeKnora v0.7.2+ REST

remote final failure
  -> remoteKnowledgeDecisionService pending gate
  -> remote-knowledge:decision event
  -> RemoteKnowledgeDecisionDialogProvider
  -> retry | disable-and-continue
```

---

### Task 1: Add packaged defaults and runtime configuration

**Files:**

- Create: `client/electron/resources/default-remote-knowledge.json`
- Create: `client/build-secrets/default-remote-knowledge.example.json`
- Create: `client/scripts/prepare-remote-knowledge-default.cjs`
- Create: `client/scripts/prepare-remote-knowledge-default.test.cjs`
- Create: `client/electron/services/remoteKnowledgeConfig.cjs`
- Create: `client/electron/services/remoteKnowledgeConfig.test.cjs`
- Modify: `.gitignore`
- Modify: `client/package.json`
- Modify: `client/electron/services/configStore.cjs`
- Modify: `client/src/shared/types/config.ts`
- Modify: `client/src/features/settings/types.ts`

- [ ] **Step 1: Write failing tests for URL normalization, default loading, fingerprinting and build-secret merging**

```js
test('normalizes the endpoint and excludes the key from its fingerprint', () => {
  const first = normalizeRemoteKnowledgeConfig({
    base_url: 'http://192.168.231.16:8080/api/v1/',
    api_key: 'first-key',
  });
  const second = normalizeRemoteKnowledgeConfig({
    base_url: 'http://192.168.231.16:8080/api/v1',
    api_key: 'second-key',
  });
  assert.equal(first.base_url, 'http://192.168.231.16:8080/api/v1');
  assert.equal(getEndpointFingerprint(first.base_url), getEndpointFingerprint(second.base_url));
});

test('rejects packaging without a non-empty local API key', () => {
  assert.throws(
    () => mergePackagedDefault(
      { base_url: 'http://192.168.231.16:8080/api/v1', api_key: '' },
      { base_url: '', api_key: '' },
    ),
    /build-secrets\/default-remote-knowledge\.json/,
  );
});
```

- [ ] **Step 2: Run the tests and confirm they fail because the modules do not exist**

Run: `cd client; node --test electron/services/remoteKnowledgeConfig.test.cjs scripts/prepare-remote-knowledge-default.test.cjs`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the committed default and ignored private build input**

`client/electron/resources/default-remote-knowledge.json`:

```json
{
  "base_url": "http://192.168.231.16:8080/api/v1",
  "api_key": ""
}
```

`client/build-secrets/default-remote-knowledge.example.json`:

```json
{
  "base_url": "",
  "api_key": ""
}
```

Add only these ignore rules:

```gitignore
client/build-secrets/default-remote-knowledge.json
client/build/generated/default-remote-knowledge.json
```

- [ ] **Step 4: Implement deterministic config normalization and packaged-default resolution**

```js
function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('远程知识服务地址必须以 http:// 或 https:// 开头');
  return text;
}

function getEndpointFingerprint(baseUrl) {
  return crypto.createHash('sha256').update(normalizeBaseUrl(baseUrl)).digest('hex');
}

function normalizeRemoteKnowledgeConfig(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : loadBundledRemoteKnowledgeDefault();
  return {
    base_url: normalizeBaseUrl(source.base_url || defaults.base_url),
    api_key: typeof source.api_key === 'string' ? source.api_key.trim() : String(defaults.api_key || '').trim(),
  };
}
```

In packaged mode read `path.join(process.resourcesPath, 'default-remote-knowledge.json')`; in development read the committed resource beside the service. Extend `defaultConfig`, `normalizeConfig()` and `ClientConfig` with:

```ts
export interface RemoteKnowledgeConnectionConfig {
  base_url: string;
  api_key: string;
}

export interface ClientConfig extends AiConfig {
  remote_knowledge: RemoteKnowledgeConnectionConfig;
}
```

Merge `remote_knowledge` explicitly in `configStore.save()` so partial saves cannot erase either field. Expose a `configStore.getRemoteKnowledgeDefault()` method for “恢复默认”.

- [ ] **Step 5: Add the packaging preparation script without printing the key**

```js
function mergePackagedDefault(committedDefault, privateDefault) {
  const baseUrl = normalizeBaseUrl(privateDefault.base_url || committedDefault.base_url);
  const apiKey = String(privateDefault.api_key || '').trim();
  if (!apiKey) {
    throw new Error('缺少 client/build-secrets/default-remote-knowledge.json 中的非空 api_key');
  }
  return { base_url: baseUrl, api_key: apiKey };
}
```

Update each `dist`, `dist:win`, and `dist:mac` script to run the new preparation script before `electron-builder`. Add the generated JSON to both Windows and macOS `extraResources` with target `default-remote-knowledge.json`. Keep `npm run build` independent from the private file.

- [ ] **Step 6: Run focused tests and static checks**

Run: `cd client; node --test electron/services/remoteKnowledgeConfig.test.cjs scripts/prepare-remote-knowledge-default.test.cjs; node --check electron/services/remoteKnowledgeConfig.cjs; node --check scripts/prepare-remote-knowledge-default.cjs; npm run build`

Expected: all tests PASS, syntax checks exit 0, build exits 0.

- [ ] **Step 7: Commit Task 1**

```powershell
git add .gitignore client/package.json client/electron/resources/default-remote-knowledge.json client/build-secrets/default-remote-knowledge.example.json client/scripts/prepare-remote-knowledge-default.cjs client/scripts/prepare-remote-knowledge-default.test.cjs client/electron/services/remoteKnowledgeConfig.cjs client/electron/services/remoteKnowledgeConfig.test.cjs client/electron/services/configStore.cjs client/src/shared/types/config.ts client/src/features/settings/types.ts
git commit -m "feat: add remote knowledge defaults"
```

---

### Task 2: Implement the WeKnora adapter and generic remote service

**Files:**

- Create: `client/electron/services/weKnoraClient.cjs`
- Create: `client/electron/services/weKnoraClient.test.cjs`
- Create: `client/electron/services/remoteKnowledgeService.cjs`
- Create: `client/electron/services/remoteKnowledgeService.test.cjs`

- [ ] **Step 1: Write failing contract tests for list, pagination, search and error mapping**

Cover these cases with an injected `fetchImpl`: valid KB list, document page, whole-KB search, document-limited search, zero hits, timeout, network error, 429, 500, 401, 403, 404 and incompatible JSON.

```js
test('splits whole-library and document-limited scopes to preserve mixed semantics', async () => {
  const calls = [];
  const service = createServiceWithFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body));
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
  assert.deepEqual(calls[0].knowledge_base_ids, ['kb-a']);
  assert.equal(Object.hasOwn(calls[0], 'knowledge_ids'), false);
  assert.deepEqual(calls[1].knowledge_base_ids, ['kb-b']);
  assert.deepEqual(calls[1].knowledge_ids, ['doc-1']);
  assert.equal(calls[0].match_count, 8);
  assert.equal(calls[1].match_count, 8);
});
```

- [ ] **Step 2: Run tests and confirm module-not-found failure**

Run: `cd client; node --test electron/services/weKnoraClient.test.cjs electron/services/remoteKnowledgeService.test.cjs`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement request IDs, timeout, cancellation and bounded retry**

```js
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function request({ config, method, path: requestPath, body, signal }) {
  const requestId = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestOnce({ config, method, requestPath, body, signal, requestId });
    } catch (error) {
      const retryable = error.category === 'network'
        || error.category === 'timeout'
        || RETRYABLE_STATUS.has(error.httpStatus);
      if (!retryable || attempt === 2) throw error;
      await wait(retryDelays[attempt], signal);
    }
  }
  throw new Error('远程知识请求未返回结果');
}
```

`requestOnce` must merge the task signal with a timeout signal, set `X-API-Key`, `Content-Type: application/json` and `X-Request-ID`, and never include headers or the request body in thrown messages.

- [ ] **Step 4: Map provider responses to generic models**

```js
function mapSearchResult(item) {
  return {
    id: `remote:${item.knowledge_base_id}:${item.knowledge_id}:${item.id}`,
    origin: 'remote',
    knowledgeBaseId: String(item.knowledge_base_id),
    knowledgeId: String(item.knowledge_id),
    chunkId: String(item.id),
    title: String(item.knowledge_title || item.title || '远程知识'),
    content: String(item.content || item.chunk_content || ''),
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
  };
}
```

`search()` must issue one request for all `mode: 'all'` scopes without `knowledge_ids`, then one request per `mode: 'documents'` knowledge base with its own `knowledge_ids`; this avoids a document filter accidentally narrowing a simultaneously selected whole library. Run those calls with a small internal concurrency limit and merge their results. `testConnection()` must call the KB list and validate the fields required by v0.7.2+. If the shape is incompatible, throw category `incompatible` with message `远程知识服务版本不受支持，请升级到 v0.7.2 或以上`.

- [ ] **Step 5: Run tests and checks**

Run: `cd client; node --test electron/services/weKnoraClient.test.cjs electron/services/remoteKnowledgeService.test.cjs; node --check electron/services/weKnoraClient.cjs; node --check electron/services/remoteKnowledgeService.cjs`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit Task 2**

```powershell
git add client/electron/services/weKnoraClient.cjs client/electron/services/weKnoraClient.test.cjs client/electron/services/remoteKnowledgeService.cjs client/electron/services/remoteKnowledgeService.test.cjs
git commit -m "feat: add remote knowledge client"
```

---

### Task 3: Persist remote scopes in the technical-plan workspace

**Files:**

- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/technicalPlanRemoteKnowledgeStore.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts`

- [ ] **Step 1: Write failing migration, normalization, save/load and cleanup tests**

The test creates a temporary SQLite database at v23, runs migrations, creates a technical-plan store, and asserts:

```js
assert.equal(database.schemaVersion, 24);
assert.deepEqual(store.loadTechnicalPlan().remoteKnowledgeScopes, [
  {
    knowledgeBaseId: 'kb-1',
    knowledgeBaseName: '施工规范',
    mode: 'documents',
    endpointFingerprint: 'fingerprint-a',
    documents: [{ knowledgeId: 'doc-1', title: '质量验收规范' }],
  },
]);
```

Also verify whole-KB mode deletes child document rows, duplicate IDs are normalized, restart reloads the same order, and every existing workspace reset/clear path removes both new tables.

- [ ] **Step 2: Run the test and confirm it fails at schema version 23**

Run: `cd client; node --test electron/services/technicalPlanRemoteKnowledgeStore.test.cjs`

Expected: FAIL because schema v24 and store methods do not exist.

- [ ] **Step 3: Add migration v24 and schema-health repair**

```sql
CREATE TABLE IF NOT EXISTS technical_plan_remote_knowledge_scopes (
  knowledge_base_id TEXT PRIMARY KEY,
  knowledge_base_name TEXT NOT NULL,
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all', 'documents')),
  endpoint_fingerprint TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS technical_plan_remote_knowledge_documents (
  knowledge_base_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  knowledge_title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (knowledge_base_id, knowledge_id),
  FOREIGN KEY (knowledge_base_id)
    REFERENCES technical_plan_remote_knowledge_scopes(knowledge_base_id)
    ON DELETE CASCADE
);
```

Set `schemaVersion = 24`, add a v24 migration and a `schemaHealthTableGroups` entry, and mirror the SQL in `sql/workspace_schema.sql`.

- [ ] **Step 4: Save local and remote selections atomically**

```js
function saveOutlineConfig({ referenceKnowledgeDocumentIds, remoteKnowledgeScopes, outlineMode, outlineExpansionMode, wordControlOptions } = {}) {
  const transaction = db.transaction(() => {
    replaceReferenceDocumentIds(referenceKnowledgeDocumentIds);
    replaceRemoteKnowledgeScopes(remoteKnowledgeScopes);
    updateTechnicalPlan({
      outlineMode: isValidOutlineMode(outlineMode) ? outlineMode : 'aligned',
      outlineExpansionMode: isValidOutlineExpansionMode(outlineExpansionMode) ? outlineExpansionMode : 'ai-complement',
      outlineWordControlOptions: normalizeOutlineWordControlOptions(wordControlOptions),
    });
  });
  transaction();
}
```

Include `remoteKnowledgeScopes` in the store default state and `loadTechnicalPlan()`. Extend every location that deletes `technical_plan_reference_docs` to delete child rows first, then scope rows, within the same existing transaction.

- [ ] **Step 5: Run persistence validation**

Run: `cd client; node --test electron/services/technicalPlanRemoteKnowledgeStore.test.cjs; node --check electron/services/sqliteDatabase.cjs; node --check electron/services/technicalPlanStore.cjs; npm run smoke:electron-native; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit Task 3**

```powershell
git add client/electron/services/sqliteDatabase.cjs sql/workspace_schema.sql client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanRemoteKnowledgeStore.test.cjs client/src/features/technical-plan/types.ts client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts
git commit -m "feat: persist remote knowledge scopes"
```

---

### Task 4: Expose metadata IPC and build the settings tab

**Files:**

- Create: `client/electron/ipc/remoteKnowledgeIpc.cjs`
- Create: `client/electron/ipc/remoteKnowledgeIpc.test.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/configIpc.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/settings/pages/SettingsPage.tsx`
- Modify: `client/src/styles/feature-settings.css`

- [ ] **Step 1: Write a failing IPC registration test**

Use an injected fake `ipcMain` and service. Assert exact channels and that list/search metadata is delegated without exposing a generic request method:

```js
assert.deepEqual(registered.sort(), [
  'remote-knowledge:list-documents',
  'remote-knowledge:list-knowledge-bases',
  'remote-knowledge:test-connection',
]);
assert.equal(Object.hasOwn(preloadShape.remoteKnowledge, 'request'), false);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd client; node --test electron/ipc/remoteKnowledgeIpc.test.cjs`

Expected: FAIL because the IPC module does not exist.

- [ ] **Step 3: Register service and IPC at the correct lifecycle boundary**

Create `remoteKnowledgeService` once beside `configStore` in `registerIpcHandlers`, register metadata IPC immediately, and later pass the same instance into workspace services and `taskService`.

```js
remoteKnowledge: {
  testConnection: (config) => ipcRenderer.invoke('remote-knowledge:test-connection', config),
  listKnowledgeBases: () => ipcRenderer.invoke('remote-knowledge:list-knowledge-bases'),
  listDocuments: (input) => ipcRenderer.invoke('remote-knowledge:list-documents', input),
}
```

Add `config:get-remote-knowledge-default` to `configIpc.cjs`; it returns only `{ base_url, api_key }` because the user explicitly needs to restore and edit both packaged defaults.

- [ ] **Step 4: Add the “远程知识” settings tab**

Add `remote-knowledge` to `SettingsTab`, render URL and password inputs, and add three actions:

- `测试连接` validates the current draft at the user-input boundary, then calls `window.yibiao.remoteKnowledge.testConnection(draft.remoteKnowledge)` without saving it first.
- `保存配置` uses the existing full `ClientConfig` save flow.
- `恢复默认` loads `config.getRemoteKnowledgeDefault()` into the draft and requires the existing `AppDialog` confirmation before saving.

The explanatory copy is:

```text
当前接入协议为 WeKnora v0.7.2 或以上版本。API Key 的知识库权限由远程服务管理端控制。
```

Never include the key in Toast text, logs or error details.

- [ ] **Step 5: Run checks**

Run: `cd client; node --test electron/ipc/remoteKnowledgeIpc.test.cjs; node --check electron/ipc/remoteKnowledgeIpc.cjs; node --check electron/ipc/index.cjs; node --check electron/ipc/configIpc.cjs; node --check electron/preload.cjs; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit Task 4**

```powershell
git add client/electron/ipc/remoteKnowledgeIpc.cjs client/electron/ipc/remoteKnowledgeIpc.test.cjs client/electron/ipc/index.cjs client/electron/ipc/configIpc.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/features/settings/pages/SettingsPage.tsx client/src/styles/feature-settings.css
git commit -m "feat: add remote knowledge settings"
```

---

### Task 5: Add remote selection to the technical-plan generation dialog

**Files:**

- Create: `client/src/features/technical-plan/components/RemoteKnowledgePicker.tsx`
- Create: `client/src/features/technical-plan/remoteKnowledgeSelection.ts`
- Create: `client/src/features/technical-plan/remoteKnowledgeSelection.test.ts`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Write failing pure-state tests for mutually exclusive selection modes**

```js
test('whole-library selection clears document selections for the same library', () => {
  const next = selectWholeKnowledgeBase([
    scope('kb-1', 'documents', ['doc-1']),
    scope('kb-2', 'documents', ['doc-2']),
  ], remoteBase('kb-1'));
  assert.deepEqual(next[0].mode, 'all');
  assert.deepEqual(next[0].documents, []);
  assert.deepEqual(next[1].documents.map((item) => item.knowledgeId), ['doc-2']);
});
```

Also test switching from whole-KB to documents, pagination not changing selection, mixed scopes, clearing all remote selections, and fingerprint mismatch marking scopes stale.

- [ ] **Step 2: Run the test and confirm module-not-found failure**

Run: `cd client; node --test src/features/technical-plan/remoteKnowledgeSelection.test.ts`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the generic selection reducer**

```ts
export function isRemoteScopeStale(scope: RemoteKnowledgeScope, currentFingerprint: string): boolean {
  return scope.endpointFingerprint !== currentFingerprint;
}

export function selectWholeKnowledgeBase(
  scopes: RemoteKnowledgeScope[],
  knowledgeBase: RemoteKnowledgeBase,
  endpointFingerprint: string,
): RemoteKnowledgeScope[] {
  const next = scopes.filter((scope) => scope.knowledgeBaseId !== knowledgeBase.id);
  return [...next, {
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBaseName: knowledgeBase.name,
    mode: 'all',
    documents: [],
    endpointFingerprint,
  }];
}
```

- [ ] **Step 4: Build the picker without modifying the knowledge-base page**

In the existing reference section add source tabs `本地知识` and `远程知识`. Keep `本次已选` as one list with `本地` / `远程` badges. The remote tab lazily loads KBs and paged documents; a failed remote list shows an inline retry while the local tab remains usable.

The selection count summary must distinguish units:

```ts
const remoteWholeCount = remoteScopes.filter((scope) => scope.mode === 'all').length;
const remoteDocumentCount = remoteScopes.reduce(
  (total, scope) => total + (scope.mode === 'documents' ? scope.documents.length : 0),
  0,
);
```

Pass `remoteKnowledgeScopes` through `TechnicalPlanHome`, `OutlineEditPageProps`, `onOutlineConfigChange` and `technicalPlan.saveOutlineConfig`. The persisted store remains authoritative; `taskService` snapshots that store state when a task starts. Do not add any remote UI to `KnowledgeBasePage`.

- [ ] **Step 5: Run state tests and build**

Run: `cd client; node --test src/features/technical-plan/remoteKnowledgeSelection.test.ts; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 6: Manually validate selection behavior**

Run: `cd client; npm run dev`

Verify technical plan and existing-plan expansion both show `本地知识 / 远程知识`; whole-KB and specific-document modes are mutually exclusive; stale scopes cannot be saved as active; remote failure does not disable the local tab; the knowledge-base page has no remote content.

- [ ] **Step 7: Commit Task 5**

```powershell
git add client/src/features/technical-plan/components/RemoteKnowledgePicker.tsx client/src/features/technical-plan/remoteKnowledgeSelection.ts client/src/features/technical-plan/remoteKnowledgeSelection.test.ts client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/types.ts client/src/shared/types/ipc.ts client/src/styles/feature-technical-plan.css
git commit -m "feat: add remote knowledge selector"
```

---

### Task 6: Build the unified reference service and task-scoped decision gate

**Files:**

- Create: `client/electron/services/remoteKnowledgeDecisionService.cjs`
- Create: `client/electron/services/remoteKnowledgeDecisionService.test.cjs`
- Create: `client/electron/services/knowledgeReferenceService.cjs`
- Create: `client/electron/services/knowledgeReferenceService.test.cjs`

- [ ] **Step 1: Write failing decision-gate tests**

Test one pending decision per task, coalesced concurrent failures, retry replaying each waiter, disable releasing all waiters, abort rejecting waiters, zero hits continuing without a decision, and disable affecting only the current task.

```js
test('coalesces concurrent failures and releases all callers on disable', async () => {
  const service = createRemoteKnowledgeDecisionService({ emitDecision: (value) => emitted.push(value) });
  const first = service.waitForDecision(request('task-1', 'outline'));
  const second = service.waitForDecision(request('task-1', 'global-facts'));
  assert.equal(emitted.length, 1);
  service.resolveDecision({ decisionId: emitted[0].decisionId, action: 'disable-and-continue' });
  assert.equal(await first, 'disable-and-continue');
  assert.equal(await second, 'disable-and-continue');
});
```

- [ ] **Step 2: Write failing unified-reference tests**

Assert namespaced IDs, deduplication by remote chunk, score ordering, `matchCount = 8`, endpoint mismatch failure, local-only fallback, and source priority budgeting.

```js
assert.deepEqual(result.map((item) => item.id), [
  'local:local-doc:local-item',
  'remote:kb-1:doc-1:chunk-high',
]);
```

- [ ] **Step 3: Run tests and confirm module-not-found failure**

Run: `cd client; node --test electron/services/remoteKnowledgeDecisionService.test.cjs electron/services/knowledgeReferenceService.test.cjs`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement the task-scoped gate**

```js
async function searchRemoteWithDecision(session, request) {
  if (session.remoteDisabledForRun) return [];
  while (!session.remoteDisabledForRun) {
    try {
      return await remoteKnowledgeService.search({ ...request, scopes: session.remoteScopes });
    } catch (error) {
      const action = await decisionService.waitForDecision({
        taskId: session.taskId,
        workflow: session.workflow,
        stage: request.stage,
        error,
        signal: session.signal,
      });
      if (action === 'disable-and-continue') {
        session.remoteDisabledForRun = true;
        return [];
      }
    }
  }
  return [];
}
```

On `retry`, the loop replays only the caller's failed request. The gate blocks new remote calls for the same task until resolved. `dispose()` and `cancelTask()` reject all pending promises and remove pending state.

- [ ] **Step 5: Implement unified source IDs and bounded merge**

Keep local references before remote references when reducing to the remaining knowledge budget. Deduplicate remote references by `knowledgeBaseId + knowledgeId + chunkId`, preserve the highest score, and never expose internal IDs in generated prose instructions.

- [ ] **Step 6: Run tests and static checks**

Run: `cd client; node --test electron/services/remoteKnowledgeDecisionService.test.cjs electron/services/knowledgeReferenceService.test.cjs; node --check electron/services/remoteKnowledgeDecisionService.cjs; node --check electron/services/knowledgeReferenceService.cjs`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 6**

```powershell
git add client/electron/services/remoteKnowledgeDecisionService.cjs client/electron/services/remoteKnowledgeDecisionService.test.cjs client/electron/services/knowledgeReferenceService.cjs client/electron/services/knowledgeReferenceService.test.cjs
git commit -m "feat: add unified knowledge references"
```

---

### Task 7: Wire task lifecycle, decision IPC and the global dialog

**Files:**

- Modify: `client/electron/services/taskService.cjs`
- Create: `client/electron/services/taskService.remoteKnowledge.test.cjs`
- Modify: `client/electron/ipc/remoteKnowledgeIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Create: `client/src/shared/ui/RemoteKnowledgeDecisionDialogProvider.tsx`
- Modify: `client/src/shared/ui/index.ts`
- Modify: `client/src/app/providers/AppProviders.tsx`
- Create: `client/src/shared/navigation/appNavigation.ts`
- Modify carefully, preserving and not staging the existing `UpdateNotifier` hunk: `client/src/App.tsx`
- Modify: `client/src/features/settings/pages/SettingsPage.tsx`
- Modify: `client/src/styles/shared-dialog.css`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`

- [ ] **Step 1: Write failing task-lifecycle tests**

Assert task creation receives an immutable scope snapshot, current-task disable state never persists to SQLite, cancel/dispose clears pending decisions, and task snapshots expose only a boolean `remote_knowledge_action_required` plus the decision ID.

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd client; node --test electron/services/taskService.remoteKnowledge.test.cjs`

Expected: FAIL because task controls do not yet own a knowledge session.

- [ ] **Step 3: Create one knowledge session per managed technical-plan task**

Extend `createTaskService` dependencies with `knowledgeReferenceService` and `remoteKnowledgeDecisionService`. After loading `previousState`, create a session only for `outline-generation`, `global-facts-generation`, and `content-generation`:

```js
taskControl.knowledgeSession = knowledgeReferenceService.createTaskSession({
  taskId: currentTask.task_id,
  workflow: previousState.workflowKind || 'technical-plan',
  localDocumentIds: previousState.referenceKnowledgeDocumentIds || [],
  remoteScopes: previousState.remoteKnowledgeScopes || [],
  taskControl,
});
```

Pass `knowledgeReferenceService` and the session to runners. `taskControl.dispose()` must dispose the session before subscribers are removed. Preserve existing app-exit recovery: content becomes paused; outline/global facts become error/interrupted; never auto-disable remote.

- [ ] **Step 4: Add decision IPC and subscription replay**

Add:

```ts
getPendingDecision: () => Promise<RemoteKnowledgeDecision | null>;
resolveDecision: (input: { decisionId: string; action: 'retry' | 'disable-and-continue' }) => Promise<void>;
onDecision: (callback: (decision: RemoteKnowledgeDecision) => void) => () => void;
```

Provider startup order is `getPendingDecision()` first, then subscribe. The event payload must omit Key, query and retrieved content.

- [ ] **Step 5: Build the two-action global dialog**

The dialog title is `远程知识调用失败`; buttons are exactly `重试` and `停用远程并继续`. Add text links `检查设置` and `错误详情`. Closing the dialog hides it but does not resolve the pending decision. A task-area action `处理远程知识异常` reopens it.

Responsive CSS:

```css
.remote-knowledge-decision-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.remote-knowledge-decision-actions button {
  white-space: nowrap;
}

@media (max-width: 620px) {
  .remote-knowledge-decision-actions {
    flex-direction: column-reverse;
  }

  .remote-knowledge-decision-actions button {
    width: 100%;
  }
}
```

`检查设置` calls a typed shared `navigateToAppSection('settings', { settingsTab: 'remote-knowledge' })`, and `App.tsx` listens for this navigation event while `SettingsPage` consumes the requested initial tab. The decision remains pending. Because `App.tsx` already contains an unrelated user change, inspect its diff before editing and stage only the new navigation import/effect hunk; the existing `UpdateNotifier` hunk must remain unstaged. `错误详情` uses `AppDialog` and displays only category, status, request ID, time and sanitized summary.

- [ ] **Step 6: Run tests, checks and build**

Run: `cd client; node --test electron/services/taskService.remoteKnowledge.test.cjs electron/services/remoteKnowledgeDecisionService.test.cjs; node --check electron/services/taskService.cjs; node --check electron/ipc/remoteKnowledgeIpc.cjs; node --check electron/preload.cjs; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 7**

```powershell
git add client/electron/services/taskService.cjs client/electron/services/taskService.remoteKnowledge.test.cjs client/electron/ipc/remoteKnowledgeIpc.cjs client/electron/ipc/index.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/shared/ui/RemoteKnowledgeDecisionDialogProvider.tsx client/src/shared/ui/index.ts client/src/app/providers/AppProviders.tsx client/src/shared/navigation/appNavigation.ts client/src/features/settings/pages/SettingsPage.tsx client/src/styles/shared-dialog.css client/src/features/technical-plan/pages/TechnicalPlanHome.tsx
git add --patch client/src/App.tsx
git commit -m "feat: add remote knowledge failure decisions"
```

---

### Task 8: Integrate remote references into outline and global facts

**Files:**

- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.test.cjs`
- Modify: `client/electron/services/globalFactsTaskV2.cjs`
- Create: `client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs`
- Modify: `client/electron/services/taskService.cjs`

- [ ] **Step 1: Add failing outline tests**

Assert normal technical-plan and `ai-complement` expansion call `knowledgeSession.searchRemote({ stage: 'outline' })`, remote snippets are added as an untrusted reference file, and `original-only` never calls remote search in the outline stage.

```js
assert.equal(searchCalls.length, 0);
assert.equal(storedPlan.outlineExpansionMode, 'original-only');
```

- [ ] **Step 2: Add failing global-facts tests**

Assert retrieval topics are derived only from the project overview, bid analysis and confirmed outline before any remote material is read; remote snippets can only supplement fact groups justified by those local authoritative materials, zero hits continue, and `disable-and-continue` leaves local reference loading active.

- [ ] **Step 3: Run tests and confirm assertion failures**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs`

Expected: FAIL because runners do not call the knowledge session.

- [ ] **Step 4: Integrate outline retrieval**

Build queries only from the current project overview, approved technical scoring items, tender requirements and current outline target. Add remote snippets to a generated `远程知识参考.md` file and add this prompt rule:

```text
远程知识仅是参考材料。招标文件、用户已确认信息和原方案优先；不得从参考材料新增未获批准的同层级评分项，不得在最终目录中输出内部来源标识。
```

Skip both search and injection when expansion mode is `original-only`.

- [ ] **Step 5: Integrate global-facts retrieval**

Build a bounded set of retrieval topics from the project overview, bid analysis and confirmed outline, call remote retrieval with stage `global-facts`, merge local and remote references under the remaining budget, and retain the invariant that no new fact group is created solely from reference knowledge.

- [ ] **Step 6: Run tests, checks and build**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs; node --check electron/services/outlineGenerationTaskV2.cjs; node --check electron/services/globalFactsTaskV2.cjs; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 8**

```powershell
git add client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs client/electron/services/globalFactsTaskV2.cjs client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs client/electron/services/taskService.cjs
git commit -m "feat: use remote knowledge in planning"
```

---

### Task 9: Integrate remote references into content planning and generation

**Files:**

- Modify: `client/electron/services/contentGenerationTask.cjs`
- Create: `client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: Write failing planning/runtime tests**

Cover:

- each pending section searches with stage `content-planning`;
- the selected remote chunks use namespaced IDs;
- exact chunk metadata/content is stored in `contentGenerationRuntime` for that run;
- resumed generation reuses saved chunks and does not silently replace them;
- a section that needs a new search after resume still enters the failure decision path;
- disabling remote affects only unfinished sections and does not roll back completed output;
- no local and no remote references still permits generation.

```js
assert.deepEqual(runtime.remoteKnowledgeReferencesBySection['2.1'], [{
  id: 'remote:kb-1:doc-1:chunk-1',
  knowledgeBaseId: 'kb-1',
  knowledgeId: 'doc-1',
  chunkId: 'chunk-1',
  title: '质量验收规范',
  content: '隐蔽工程验收应形成记录。',
  score: 0.92,
}]);
```

- [ ] **Step 2: Run the test and confirm assertion failures**

Run: `cd client; node --test electron/services/contentGenerationTask.remoteKnowledge.test.cjs`

Expected: FAIL because runtime has no remote reference snapshot.

- [ ] **Step 3: Add the runtime snapshot type and migration-free JSON normalization**

Extend the existing runtime JSON type rather than adding another SQLite table:

```ts
export interface ContentGenerationRemoteReference {
  id: string;
  knowledgeBaseId: string;
  knowledgeId: string;
  chunkId: string;
  title: string;
  content: string;
  score: number;
}

export interface ContentGenerationRuntimeState {
  remoteKnowledgeReferencesBySection?: Record<string, ContentGenerationRemoteReference[]>;
}
```

Normalize missing data to `{}` so old workspaces remain readable.

- [ ] **Step 4: Retrieve at planning time and consume the locked snapshot at generation time**

Build each query from the section title, section objective, approved facts and relevant tender requirements. Before the existing planning prompt, append remote results to `knowledgeItems` with namespaced IDs and to the in-memory content map. After the planner returns `knowledge.item_ids`, copy only the selected remote chunks into `remoteKnowledgeReferencesBySection` in the same checkpoint transaction as that section plan. Generation resolves those namespaced IDs from the saved snapshot; it does not make a second remote request for the same locked plan.

Add this instruction to the section prompt:

```text
当前招标要求、用户确认事实和原方案高于参考知识。参考知识必须结合本项目改写，不得输出 local: 或 remote: 内部来源标识。
```

- [ ] **Step 5: Run tests, checks and build**

Run: `cd client; node --test electron/services/contentGenerationTask.remoteKnowledge.test.cjs; node --check electron/services/contentGenerationTask.cjs; npm run build`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit Task 9**

```powershell
git add client/electron/services/contentGenerationTask.cjs client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs client/src/features/technical-plan/types.ts
git commit -m "feat: use remote knowledge in content generation"
```

---

### Task 10: Complete regression, UI and packaging acceptance

**Files:**

- Modify only files required by failures discovered in this task.
- Do not modify release workflow, Analytics code, knowledge-base page or feasibility-report code unless a regression proves the new implementation accidentally touched them; fix the integration boundary rather than expanding scope.

- [ ] **Step 1: Run the complete focused test set**

```powershell
cd client
node --test electron/services/remoteKnowledgeConfig.test.cjs scripts/prepare-remote-knowledge-default.test.cjs electron/services/weKnoraClient.test.cjs electron/services/remoteKnowledgeService.test.cjs electron/services/technicalPlanRemoteKnowledgeStore.test.cjs electron/ipc/remoteKnowledgeIpc.test.cjs src/features/technical-plan/remoteKnowledgeSelection.test.ts electron/services/remoteKnowledgeDecisionService.test.cjs electron/services/knowledgeReferenceService.test.cjs electron/services/taskService.remoteKnowledge.test.cjs electron/services/outlineGenerationTaskV2.test.cjs electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs electron/services/contentGenerationTask.remoteKnowledge.test.cjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run every required syntax and build check**

```powershell
cd client
node --check electron/services/remoteKnowledgeConfig.cjs
node --check electron/services/weKnoraClient.cjs
node --check electron/services/remoteKnowledgeService.cjs
node --check electron/services/remoteKnowledgeDecisionService.cjs
node --check electron/services/knowledgeReferenceService.cjs
node --check electron/services/sqliteDatabase.cjs
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/taskService.cjs
node --check electron/services/outlineGenerationTaskV2.cjs
node --check electron/services/globalFactsTaskV2.cjs
node --check electron/services/contentGenerationTask.cjs
node --check electron/ipc/remoteKnowledgeIpc.cjs
node --check electron/ipc/index.cjs
node --check electron/preload.cjs
npm run smoke:electron-native
npm run build
```

Expected: all commands exit 0. Existing Vite chunk-size warnings are allowed.

- [ ] **Step 3: Verify private packaging behavior without disclosing the key**

First temporarily ensure `client/build-secrets/default-remote-knowledge.json` is absent and run:

```powershell
cd client
node scripts/prepare-remote-knowledge-default.cjs
```

Expected: non-zero exit with a message naming the missing private file, with no Key value in output.

Then create the private file locally from the example, fill the authorized shared Key without printing it, and run:

```powershell
cd client
node scripts/prepare-remote-knowledge-default.cjs
git check-ignore build-secrets/default-remote-knowledge.json build/generated/default-remote-knowledge.json
```

Expected: preparation succeeds; both paths are ignored. Read the generated JSON in-process and assert only that `api_key.length > 0`; do not print its content. Run the user's target packaging command `npm run dist:win` and record fresh installer/ZIP paths, sizes and SHA-256 values.

- [ ] **Step 4: Perform live service acceptance**

With the configured service:

1. Test connection and verify KB listing.
2. Select one whole KB and specific documents from another KB.
3. Restart the app and confirm selection restoration.
4. Generate a technical-plan outline and confirm remote retrieval is logged only as counts/status.
5. In existing-plan expansion, confirm `original-only` skips remote outline retrieval but later facts/content can use remote references.
6. Use a query that returns zero hits and confirm generation continues.
7. Temporarily use an invalid Key: verify no auto retry for 401/403 and one global dialog appears.
8. Restore the Key through `检查设置`, choose `重试`, and confirm only failed requests replay.
9. Simulate a transient 5xx/timeout: verify two automatic retries before the dialog.
10. Choose `停用远程并继续`: verify local knowledge remains active, finished content is not rolled back, and the next new task tries remote again.
11. Close the decision dialog: verify the task stays waiting and `处理远程知识异常` reopens it.

- [ ] **Step 5: Perform UI acceptance at Windows scaling 100%, 125% and 150%**

Verify:

- dialog buttons remain `重试` and `停用远程并继续`, do not wrap, and stack full-width only when space is insufficient;
- there is no `结束任务` button;
- `检查设置` and `错误详情` are auxiliary links outside the primary action row;
- UI source tabs read `本地知识 / 远程知识` and do not read `WeKnora`;
- the existing knowledge-base page and feasibility-report page have no remote selector;
- raw remote content is never rendered with `allowRawHtml={true}`.

- [ ] **Step 6: Check scope and secret hygiene**

```powershell
git diff --check
git status --short
git diff --name-only deb464b023dcd3767505669b36b960f4af6b7a88
rg -n "X-API-Key|api_key|remote:|WeKnora" client/electron client/src client/build-secrets/default-remote-knowledge.example.json
```

Inspect results and confirm no real Key, query text, retrieved content, knowledge-base-page change, feasibility-report change or Analytics change is staged. `WeKnora` may appear only in the Main adapter and settings protocol explanation.

- [ ] **Step 7: Commit any verification-only corrections**

Stage only the exact files corrected during Task 10:

```powershell
git add --patch
git diff --cached --check
git commit -m "fix: complete remote knowledge acceptance"
```

Skip this commit if no correction was necessary.

## Final Acceptance Record

Before declaring completion, record in the final handoff:

- focused test command and pass count;
- `npm run smoke:electron-native` result;
- `npm run build` result;
- live WeKnora v0.7.2+ acceptance results;
- Windows 100% / 125% / 150% dialog results;
- fresh Windows installer/ZIP absolute paths, byte sizes and SHA-256 values;
- confirmation that the actual shared Key and generated packaged JSON are ignored and absent from Git;
- confirmation that pre-existing user changes remain untouched.
