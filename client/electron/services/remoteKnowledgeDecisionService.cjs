const crypto = require('node:crypto');

function createAbortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(reason ? String(reason) : '远程知识决策已取消');
  error.name = 'AbortError';
  return error;
}

function createRemoteKnowledgeDecisionService({ emitDecision } = {}) {
  const pendingByTask = new Map();
  const disabledTasks = new Set();
  const listeners = new Set();
  let disposed = false;

  function notify(decision) {
    try { if (typeof emitDecision === 'function') emitDecision(decision); } catch { /* UI notification must not fail task */ }
    for (const listener of listeners) {
      try { listener(decision); } catch { /* subscriber failures are isolated */ }
    }
  }

  function sanitize(request) {
    const error = request?.error;
    const status = Number(error?.httpStatus ?? error?.status);
    return {
      decisionId: crypto.randomUUID(),
      taskId: String(request?.taskId || ''),
      workflow: request?.workflow || 'technical-plan',
      stage: request?.stage || 'outline',
      category: String(error?.category || 'remote-error'),
      summary: String(error?.userMessage || error?.message || '远程知识检索失败').slice(0, 240),
      ...(Number.isFinite(status) ? { httpStatus: status } : {}),
      ...(error?.requestId ? { requestId: String(error.requestId) } : {}),
      occurredAt: new Date().toISOString(),
    };
  }

  function rejectEntry(entry, reason) {
    for (const waiter of entry.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(reason);
    }
    entry.waiters.clear();
  }

  function waitForDecision(request = {}) {
    const taskId = String(request.taskId || '');
    if (disposed) return Promise.reject(new Error('远程知识决策服务已释放'));
    if (request.signal?.aborted) return Promise.reject(createAbortError(request.signal.reason));
    if (disabledTasks.has(taskId)) return Promise.resolve('disable-and-continue');

    let entry = pendingByTask.get(taskId);
    if (!entry) {
      const decision = sanitize(request);
      entry = { taskId, decision, waiters: new Set() };
      pendingByTask.set(taskId, entry);
      notify(decision);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal: request.signal, onAbort: null };
      waiter.onAbort = () => {
        entry.waiters.delete(waiter);
        reject(createAbortError(request.signal.reason));
        if (!entry.waiters.size && pendingByTask.get(taskId) === entry) pendingByTask.delete(taskId);
      };
      if (request.signal) request.signal.addEventListener('abort', waiter.onAbort, { once: true });
      entry.waiters.add(waiter);
    });
  }

  async function resolveDecision({ decisionId, action } = {}) {
    if (!['retry', 'disable-and-continue'].includes(action)) throw new Error('无效的远程知识决策');
    const entry = [...pendingByTask.values()].find((item) => item.decision.decisionId === decisionId);
    if (!entry) return;
    pendingByTask.delete(entry.taskId);
    if (action === 'disable-and-continue') disabledTasks.add(entry.taskId);
    for (const waiter of entry.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.resolve(action);
    }
    entry.waiters.clear();
  }

  function getPendingDecision() {
    const first = pendingByTask.values().next();
    return Promise.resolve(first.done ? null : first.value.decision);
  }

  function onDecision(callback) {
    if (typeof callback !== 'function') return () => {};
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  async function cancelTask(taskId, reason) {
    const key = String(taskId || '');
    const entry = pendingByTask.get(key);
    if (!entry) return;
    pendingByTask.delete(key);
    rejectEntry(entry, createAbortError(reason || '任务已取消'));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of pendingByTask.values()) rejectEntry(entry, new Error('远程知识决策服务已释放'));
    pendingByTask.clear();
    listeners.clear();
    disabledTasks.clear();
  }

  return { waitForDecision, getPendingDecision, resolveDecision, cancelTask, onDecision, dispose };
}

module.exports = { createRemoteKnowledgeDecisionService };
