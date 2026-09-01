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
    };

    session.loadLocalReferences = async (documentIds = session.localDocumentIds) => {
      if (!knowledgeBaseService || typeof knowledgeBaseService.readReferences !== 'function') return [];
      const entries = await knowledgeBaseService.readReferences(documentIds, { includeItems: true });
      return (Array.isArray(entries) ? entries : []).flatMap(mapLocalReference);
    };

    session.searchRemote = async ({ stage, query, matchCount = DEFAULT_MATCH_COUNT } = {}) => {
      if (session.remoteDisabledForRun || !remoteKnowledgeService || typeof remoteKnowledgeService.search !== 'function') return [];
      const limit = normalizeCount(matchCount);
      while (!session.remoteDisabledForRun && !session.disposed) {
        try {
          const found = await remoteKnowledgeService.search({ query, scopes: session.remoteScopes, matchCount: limit, signal: session.signal });
          const unique = new Map();
          for (const item of (Array.isArray(found) ? found : [])) {
            const key = remoteKey(item);
            const current = unique.get(key);
            if (!current || Number(item.score || 0) > Number(current.score || 0)) unique.set(key, item);
          }
          return [...unique.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, limit);
        } catch (error) {
          if (!remoteKnowledgeDecisionService) return [];
          const action = await decisionService.waitForDecision({ taskId: session.taskId, workflow: session.workflow, stage, error, signal: session.signal });
          if (action === 'disable-and-continue') {
            session.remoteDisabledForRun = true;
            return [];
          }
        }
      }
      return [];
    };

    session.disableRemote = () => { session.remoteDisabledForRun = true; };
    session.isRemoteDisabled = () => session.remoteDisabledForRun;
    session.loadReferences = async ({ stage, query, matchCount = DEFAULT_MATCH_COUNT } = {}) => {
      const local = await session.loadLocalReferences();
      const remote = await session.searchRemote({ stage, query, matchCount });
      return { local, remote, references: [...local, ...remote].slice(0, normalizeCount(matchCount)) };
    };
    session.dispose = () => {
      if (session.disposed) return;
      session.disposed = true;
      if (remoteKnowledgeDecisionService) decisionService.cancelTask(session.taskId, new Error('知识引用任务已释放'));
    };
    return session;
  }

  return { createTaskSession };
}

module.exports = { createKnowledgeReferenceService, mapLocalReference };
