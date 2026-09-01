const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskService } = require('./taskService.cjs');

function makeService({ runner } = {}) {
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
  const knowledgeReferenceService = {
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
    remoteKnowledgeDecisionService: { onDecision: () => () => {} },
    duplicateCheckService: {},
    openXmlHelperService: {},
  });
  const actualRunner = runner || (async (input) => {
    runResolve = input;
    await new Promise((resolve) => input.signal.addEventListener('abort', resolve, { once: true }));
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
