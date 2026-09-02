const { createRemoteKnowledgeDecisionService } = require('./remoteKnowledgeDecisionService.cjs');

const DEFAULT_MATCH_COUNT = 8;

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_MATCH_COUNT;
}

function mapLocalReference(entry) {
  const document = entry?.document || {};
  const documentId = String(document.id || document.document_id || '');
  return (Array.isArray(entry?.items) ? entry.items : []).map((item) => ({
    ...item,
    id: `local:${documentId}:${String(item.id || item.item_id || '')}`,
    origin: 'local',
    documentId,
    documentTitle: String(document.title || document.file_name || document.name || ''),
    title: String(item.title || ''),
    content: String(item.content || item.resume || ''),
  })).filter((item) => !item.id.endsWith(':'));
}

function remoteKey(item) {
  return `${item?.knowledgeBaseId || ''}:${item?.knowledgeId || ''}:${item?.chunkId || ''}`;
}

function createKnowledgeReferenceService({ knowledgeBaseService, remoteKnowledgeService, remoteKnowledgeDecisionService } = {}) {
  const decisionService = remoteKnowledgeDecisionService || createRemoteKnowledgeDecisionService();

  function createTaskSession({ taskId, workflow, localDocumentIds, remoteScopes, taskControl, signal } = {}) {
    const session = {
      taskId: String(taskId || ''),
      workflow: workflow || 'technical-plan',
      localDocumentIds: Array.isArray(localDocumentIds) ? [...localDocumentIds] : [],
      remoteScopes: Array.isArray(remoteScopes) ? [...remoteScopes] : [],
      signal: signal || taskControl?.signal,
      remoteDisabledForRun: false,
      disposed: false,
      pendingDecision: null,
    };

    session.loadLocalReferences = async (documentIds = session.localDocumentIds) => {
      if (!knowledgeBaseService || typeof knowledgeBaseService.readReferences !== 'function') return [];
      const entries = await knowledgeBaseService.readReferences(documentIds, { includeItems: true });
      return (Array.isArray(entries) ? entries : []).flatMap(mapLocalReference);
    };

    function getScopeCompatibilityError() {
      if (!session.remoteScopes.length || typeof remoteKnowledgeService?.getEndpointFingerprint !== 'function') return null;
      const currentFingerprint = String(remoteKnowledgeService.getEndpointFingerprint() || '');
      const incompatible = !currentFingerprint || session.remoteScopes.some((scope) => String(scope?.endpointFingerprint || '') !== currentFingerprint);
      if (!incompatible) return null;
      const error = new Error('远程知识选择与当前服务地址不匹配，请重新选择');
      error.category = 'endpoint-mismatch';
      return error;
    }

    session.searchRemote = async ({ stage, queries, query, matchCount = DEFAULT_MATCH_COUNT } = {}) => {
      const normalizedQueries = (Array.isArray(queries) ? queries : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      if (!normalizedQueries.length) {
        const legacyQuery = String(query || '').trim();
        if (legacyQuery) normalizedQueries.push(legacyQuery);
      }
      if (!normalizedQueries.length || !session.remoteScopes.length || session.remoteDisabledForRun || !remoteKnowledgeService || typeof remoteKnowledgeService.searchMany !== 'function') return [];
      const limit = normalizeCount(matchCount);
      let joinedDecisionWait = false;
      const joinDecisionWait = () => {
        if (joinedDecisionWait) return;
        joinedDecisionWait = true;
        taskControl?.beginRemoteKnowledgeDecisionWait?.();
      };
      try {
        while (!session.remoteDisabledForRun && !session.disposed) {
          if (session.pendingDecision) {
            joinDecisionWait();
            const action = await session.pendingDecision;
            if (action === 'disable-and-continue') {
              session.remoteDisabledForRun = true;
              return [];
            }
            continue;
          }
          try {
            const compatibilityError = getScopeCompatibilityError();
            if (compatibilityError) throw compatibilityError;
            const found = await remoteKnowledgeService.searchMany({ queries: normalizedQueries, scopes: session.remoteScopes, matchCount: limit, signal: session.signal });
            const unique = new Map();
            for (const item of (Array.isArray(found) ? found : [])) {
              const key = remoteKey(item);
              const current = unique.get(key);
              if (!current || Number(item.score || 0) > Number(current.score || 0)) unique.set(key, item);
            }
            return [...unique.values()].slice(0, limit);
          } catch (error) {
            joinDecisionWait();
            const decisionPromise = decisionService.waitForDecision({ taskId: session.taskId, workflow: session.workflow, stage, error, signal: session.signal });
            session.pendingDecision = decisionPromise;
            let action;
            try {
              action = await decisionPromise;
            } finally {
              if (session.pendingDecision === decisionPromise) session.pendingDecision = null;
            }
            if (action === 'disable-and-continue') {
              session.remoteDisabledForRun = true;
              return [];
            }
          }
        }
        return [];
      } finally {
        if (joinedDecisionWait) taskControl?.endRemoteKnowledgeDecisionWait?.();
      }
    };

    session.disableRemote = () => { session.remoteDisabledForRun = true; };
    session.isRemoteDisabled = () => session.remoteDisabledForRun;
    session.loadReferences = async ({ stage, queries, query, matchCount = DEFAULT_MATCH_COUNT } = {}) => {
      const limit = normalizeCount(matchCount);
      const allLocal = await session.loadLocalReferences();
      const local = allLocal.slice(0, limit);
      const remaining = Math.max(0, limit - local.length);
      const remote = remaining > 0 ? await session.searchRemote({ stage, queries, query, matchCount: remaining }) : [];
      return { local, remote: remote.slice(0, remaining), references: [...local, ...remote].slice(0, limit) };
    };
    session.dispose = () => {
      if (session.disposed) return;
      session.disposed = true;
      decisionService.cancelTask(session.taskId, new Error('知识引用任务已释放'));
    };
    return session;
  }

  return { createTaskSession };
}

module.exports = { createKnowledgeReferenceService, mapLocalReference };
