const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskService } = require('./taskService.cjs');
const { createKnowledgeReferenceService } = require('./knowledgeReferenceService.cjs');
const { createRemoteKnowledgeDecisionService } = require('./remoteKnowledgeDecisionService.cjs');

function makeService({ runner, knowledgeReferenceService: knowledgeReferenceServiceOverride, remoteKnowledgeDecisionService } = {}) {
  let state = {
    workflowKind: 'technical-plan',
    referenceKnowledgeDocumentIds: ['local-1'],
    remoteKnowledgeScopes: [{
      knowledgeBaseId: 'kb-1',
      knowledgeBaseName: '规范库',
      mode: 'documents',
      endpointFingerprint: 'fp-1',
      documents: [{ knowledgeId: 'doc-1', title: '规范' }],
    }],
    outlineWordControlSnapshot: { enabled: true },
  };
  const updates = [];
  const sessions = [];
  let runResolve;
  const technicalPlanStore = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlanWithoutReload: (patch) => {
      updates.push(patch);
      state = { ...state, ...patch };
    },
    clearTechnicalPlan: () => ({ success: true }),
    clearBidTemplate() {},
  };
  const emptyStore = { loadRejectionCheck: () => ({}), loadDuplicateCheck: () => ({}) };
  const agentService = {
    bindTaskContext: () => ({}),
    isPrimarySession: () => false,
    deletePersistentTask() {},
  };
  const autoConfirmationService = {
    register() {}, unregister() {}, suppress() {},
  };
  const knowledgeReferenceService = knowledgeReferenceServiceOverride || {
    createTaskSession(input) {
      const session = {
        taskId: input.taskId,
        localDocumentIds: input.localDocumentIds,
        remoteScopes: input.remoteScopes,
        dispose() { session.disposed = true; },
        searchRemote: async () => [],
      };
      sessions.push(session);
      return session;
    },
  };
  const actualRunner = runner || (async (input) => {
    runResolve = input;
    await new Promise((resolve) => input.signal.addEventListener('abort', resolve, { once: true }));
  });
  const service = createTaskService({
    aiService: {},
    agentService,
    autoConfirmationService,
    technicalPlanStore,
    rejectionCheckStore: emptyStore,
    duplicateCheckStore: emptyStore,
    feasibilityReportStore: { loadFeasibilityReport: () => ({}) },
    knowledgeBaseService: {},
    knowledgeReferenceService,
    remoteKnowledgeDecisionService: remoteKnowledgeDecisionService || { onDecision: () => () => {} },
    duplicateCheckService: {},
    openXmlHelperService: {},
    taskRunners: { outlineGeneration: actualRunner },
  });
  return { service, sessions, updates, getState: () => state, getRunnerInput: () => runResolve, start: (payload = {}) => service.startOutlineGeneration(payload) };
}

test('creates an immutable knowledge session snapshot for technical-plan tasks', () => {
  const harness = makeService();
  harness.start({ reference_knowledge_document_ids: ['payload-local'] });
  assert.equal(harness.sessions.length, 1);
  assert.deepEqual(harness.sessions[0].localDocumentIds, ['local-1']);
  assert.equal(harness.sessions[0].remoteScopes[0].documents[0].knowledgeId, 'doc-1');
  harness.getState().remoteKnowledgeScopes[0].documents[0].knowledgeId = 'mutated';
  assert.equal(harness.sessions[0].remoteScopes[0].documents[0].knowledgeId, 'doc-1');
});

test('does not persist transient remote disable state and exposes decision fields only in snapshots', async () => {
  const emitted = [];
  const harness = makeService({ runner: async ({ updateTask }) => { updateTask({ progress: 1 }); await new Promise(() => {}); } });
  const originalSubscribe = harness.service.subscribeCallback;
  originalSubscribe((event) => emitted.push(event));
  const task = harness.start();
  assert.equal(task.remote_knowledge_action_required, false);
  assert.equal(task.remote_knowledge_decision_id, undefined);
  assert.equal(emitted.at(-1).task.remote_knowledge_action_required, false);
  assert.equal(emitted.at(-1).technicalPlanPatch.outlineGenerationTask.remote_knowledge_action_required, false);
  assert.equal(harness.updates.some((patch) => JSON.stringify(patch).includes('remoteDisabledForRun')), false);
});

test('cancel and dispose release the task knowledge session', async () => {
  const harness = makeService();
  harness.start();
  const session = harness.sessions[0];
  await harness.service.resetTechnicalPlan();
  assert.equal(session.disposed, true);
});

test('keeps action-required state until every shared decision waiter has released', async () => {
  const decisionService = createRemoteKnowledgeDecisionService();
  let searchCalls = 0;
  let resolveSlowSearch;
  let notifySlowSearchStarted;
  const slowSearchStarted = new Promise((resolve) => { notifySlowSearchStarted = resolve; });
  const remoteKnowledgeService = {
    getEndpointFingerprint: () => 'fp-1',
    search: async () => {
      searchCalls += 1;
      if (searchCalls === 1) throw new Error('remote down');
      if (searchCalls === 2) return [];
      notifySlowSearchStarted();
      await new Promise((resolve) => { resolveSlowSearch = resolve; });
      return [];
    },
  };
  const knowledgeReferenceService = createKnowledgeReferenceService({
    knowledgeBaseService: {},
    remoteKnowledgeService,
    remoteKnowledgeDecisionService: decisionService,
  });
  let releaseRunner;
  const keepRunnerActive = new Promise((resolve) => { releaseRunner = resolve; });
  let notifySecondWaiterStarted;
  const secondWaiterStarted = new Promise((resolve) => { notifySecondWaiterStarted = resolve; });
  const harness = makeService({
    knowledgeReferenceService,
    remoteKnowledgeDecisionService: decisionService,
    runner: async ({ knowledgeSession }) => {
      const first = knowledgeSession.searchRemote({ stage: 'outline', query: 'first' });
      await new Promise((resolve) => setImmediate(resolve));
      const second = knowledgeSession.searchRemote({ stage: 'global-facts', query: 'second' });
      notifySecondWaiterStarted();
      await Promise.all([first, second]);
      await keepRunnerActive;
    },
  });

  harness.start();
  let decision = await decisionService.getPendingDecision();
  for (let attempts = 0; !decision && attempts < 10; attempts += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    decision = await decisionService.getPendingDecision();
  }
  assert.ok(decision?.decisionId);
  await secondWaiterStarted;
  await decisionService.resolveDecision({ decisionId: decision.decisionId, action: 'retry' });
  for (let attempts = 0; searchCalls < 3 && attempts < 10; attempts += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(searchCalls, 3);
  await slowSearchStarted;
  await new Promise((resolve) => setImmediate(resolve));

  let task = harness.service.getActiveTasks()[0];
  assert.equal(task.remote_knowledge_action_required, true);
  assert.equal(task.remote_knowledge_decision_id, decision.decisionId);

  resolveSlowSearch();
  await new Promise((resolve) => setImmediate(resolve));
  task = harness.service.getActiveTasks()[0];
  assert.equal(task.remote_knowledge_action_required, false);
  assert.equal(task.remote_knowledge_decision_id, undefined);
  releaseRunner();
});
