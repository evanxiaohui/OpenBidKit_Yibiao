const assert = require('node:assert/strict');
const test = require('node:test');

const { createRemoteKnowledgeDecisionService } = require('./remoteKnowledgeDecisionService.cjs');

function request(taskId, stage, error = new Error('远程服务失败')) {
  return { taskId, workflow: 'technical-plan', stage, error };
}

test('coalesces concurrent failures and releases all callers on disable', async () => {
  const emitted = [];
  const service = createRemoteKnowledgeDecisionService({ emitDecision: (value) => emitted.push(value) });
  const first = service.waitForDecision(request('task-1', 'outline'));
  const second = service.waitForDecision(request('task-1', 'global-facts'));
  assert.equal(emitted.length, 1);
  await service.resolveDecision({ decisionId: emitted[0].decisionId, action: 'disable-and-continue' });
  assert.equal(await first, 'disable-and-continue');
  assert.equal(await second, 'disable-and-continue');
});

test('replays retry to each waiter', async () => {
  const emitted = [];
  const service = createRemoteKnowledgeDecisionService({ emitDecision: (value) => emitted.push(value) });
  const first = service.waitForDecision(request('task-1', 'outline'));
  const second = service.waitForDecision(request('task-1', 'global-facts'));
  await service.resolveDecision({ decisionId: emitted[0].decisionId, action: 'retry' });
  assert.equal(await first, 'retry');
  assert.equal(await second, 'retry');
  assert.equal(emitted.length, 1);
});

test('abort rejects the waiting decision', async () => {
  const service = createRemoteKnowledgeDecisionService({ emitDecision() {} });
  const controller = new AbortController();
  const pending = service.waitForDecision({ ...request('task-1', 'outline'), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /取消|aborted/i);
});

test('cancelTask rejects all waiters and removes task state', async () => {
  const emitted = [];
  const service = createRemoteKnowledgeDecisionService({ emitDecision: (value) => emitted.push(value) });
  const pending = service.waitForDecision(request('task-1', 'outline'));
  const second = service.waitForDecision(request('task-1', 'global-facts'));
  await service.cancelTask('task-1', new Error('任务已取消'));
  await assert.rejects(pending, /任务已取消/);
  await assert.rejects(second, /任务已取消/);
  assert.equal(await service.getPendingDecision(), null);
});

test('dispose rejects pending decisions', async () => {
  const service = createRemoteKnowledgeDecisionService({ emitDecision() {} });
  const pending = service.waitForDecision(request('task-1', 'outline'));
  service.dispose();
  await assert.rejects(pending, /disposed|释放|取消/i);
});

test('keeps disable state isolated per task', async () => {
  const emitted = [];
  const service = createRemoteKnowledgeDecisionService({ emitDecision: (value) => emitted.push(value) });
  const taskOne = service.waitForDecision(request('task-1', 'outline'));
  const taskTwo = service.waitForDecision(request('task-2', 'outline'));
  await service.resolveDecision({ decisionId: emitted[0].decisionId, action: 'disable-and-continue' });
  assert.equal(await taskOne, 'disable-and-continue');
  assert.equal(emitted.length, 2);
  await service.resolveDecision({ decisionId: emitted[1].decisionId, action: 'retry' });
  assert.equal(await taskTwo, 'retry');
});
