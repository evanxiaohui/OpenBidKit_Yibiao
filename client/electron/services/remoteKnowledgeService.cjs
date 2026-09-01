const { createRemoteKnowledgeClient } = require('./weKnoraClient.cjs');

const INCOMPATIBLE_MESSAGE = '远程知识服务版本不受支持，请升级到 v0.7.2 或以上';
const SEARCH_CONCURRENCY = 3;
const DEFAULT_MATCH_COUNT = 8;

function incompatibleError() {
  const error = new Error(INCOMPATIBLE_MESSAGE);
  error.category = 'incompatible';
  return error;
}

function mapKnowledgeBase(item) {
  if (!item || typeof item !== 'object' || !item.id || !item.name) throw incompatibleError();
  return {
    id: String(item.id),
    name: String(item.name),
    description: String(item.description || ''),
  };
}

function mapDocument(item, knowledgeBaseId) {
  if (!item || typeof item !== 'object' || !item.id) throw incompatibleError();
  return {
    id: String(item.id),
    knowledgeBaseId: String(item.knowledge_base_id || knowledgeBaseId),
    title: String(item.title || item.file_name || '远程知识'),
    parseStatus: String(item.parse_status || ''),
  };
}

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

async function runWithConcurrency(items, limit, action) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await action(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildSearchGroups(scopes) {
  const wholeLibraryIds = [];
  const wholeLibrarySeen = new Set();
  const documentGroups = new Map();
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    const knowledgeBaseId = String(scope?.knowledgeBaseId || '');
    if (!knowledgeBaseId) continue;
    if (scope.mode === 'all') {
      if (!wholeLibrarySeen.has(knowledgeBaseId)) {
        wholeLibrarySeen.add(knowledgeBaseId);
        wholeLibraryIds.push(knowledgeBaseId);
      }
      continue;
    }
    if (scope.mode === 'documents') {
      const documents = documentGroups.get(knowledgeBaseId) || new Set();
      for (const document of Array.isArray(scope.documents) ? scope.documents : []) {
        const knowledgeId = String(document?.knowledgeId || '');
        if (knowledgeId) documents.add(knowledgeId);
      }
      if (documents.size) documentGroups.set(knowledgeBaseId, documents);
    }
  }
  const groups = wholeLibraryIds.length ? [{ knowledgeBaseIds: wholeLibraryIds }] : [];
  for (const [knowledgeBaseId, documentIds] of documentGroups) {
    groups.push({ knowledgeBaseIds: [knowledgeBaseId], knowledgeIds: [...documentIds] });
  }
  return groups;
}

function resolveMatchCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_MATCH_COUNT;
}

function normalizeConfig(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    base_url: String(source.base_url || fallback?.base_url || ''),
    api_key: String(source.api_key || fallback?.api_key || ''),
  };
}

function createRemoteKnowledgeService({ config, fetchImpl, timeoutMs, retryDelays, remoteKnowledgeClient } = {}) {
  const configProvider = typeof config === 'function' ? config : () => config;
  const clientOptions = { fetchImpl, timeoutMs, retryDelays };
  const getClient = (override) => {
    if (remoteKnowledgeClient && !override) return remoteKnowledgeClient;
    const currentConfig = normalizeConfig(configProvider());
    return createRemoteKnowledgeClient({ ...clientOptions, config: normalizeConfig(override, currentConfig) });
  };

  async function listKnowledgeBases({ signal } = {}) {
    return (await getClient().listKnowledgeBases({ signal })).map(mapKnowledgeBase);
  }

  async function listDocuments({ knowledgeBaseId, page, pageSize, signal } = {}) {
    const result = await getClient().listKnowledge({ knowledgeBaseId, page, pageSize, signal });
    return {
      items: result.items.map((item) => mapDocument(item, knowledgeBaseId)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async function search({ query, scopes, matchCount, signal } = {}) {
    const groups = buildSearchGroups(scopes);
    const resultLimit = resolveMatchCount(matchCount);
    const resultGroups = await runWithConcurrency(groups, SEARCH_CONCURRENCY, (group) => getClient().hybridSearch({
      query,
      signal,
      ...group,
    }));
    return resultGroups.flat().map(mapSearchResult).slice(0, resultLimit);
  }

  async function testConnection(input = {}) {
    const hasConfigOverride = input && (Object.hasOwn(input, 'base_url') || Object.hasOwn(input, 'api_key'));
    const signal = hasConfigOverride ? undefined : input?.signal;
    const knowledgeBases = (await getClient(hasConfigOverride ? input : undefined).listKnowledgeBases({ signal })).map(mapKnowledgeBase);
    return { knowledgeBaseCount: knowledgeBases.length };
  }

  return { listDocuments, listKnowledgeBases, search, testConnection };
}

module.exports = {
  createRemoteKnowledgeService,
  mapSearchResult,
};
