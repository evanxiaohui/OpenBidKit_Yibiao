const { createRemoteKnowledgeClient } = require('./weKnoraClient.cjs');
const {
  getEndpointFingerprint: fingerprintEndpoint,
  normalizeRemoteKnowledgeConfig,
} = require('./remoteKnowledgeConfig.cjs');

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
  const contentField = item && typeof item === 'object'
    ? (Object.hasOwn(item, 'content') ? 'content' : Object.hasOwn(item, 'chunk_content') ? 'chunk_content' : '')
    : '';
  if (!item || typeof item !== 'object'
    || !String(item.id || '').trim()
    || !String(item.knowledge_base_id || '').trim()
    || !String(item.knowledge_id || '').trim()
    || !contentField) {
    throw incompatibleError();
  }
  return {
    id: `remote:${item.knowledge_base_id}:${item.knowledge_id}:${item.id}`,
    origin: 'remote',
    knowledgeBaseId: String(item.knowledge_base_id),
    knowledgeId: String(item.knowledge_id),
    chunkId: String(item.id),
    title: String(item.knowledge_title || item.title || '远程知识'),
    content: String(item[contentField] || ''),
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
  return normalizeRemoteKnowledgeConfig(value, fallback);
}

function createRemoteKnowledgeService({ config, fetchImpl, timeoutMs, retryDelays, remoteKnowledgeClient } = {}) {
  const configProvider = typeof config === 'function' ? config : () => config;
  const clientOptions = { fetchImpl, timeoutMs, retryDelays };
  const getClient = (override) => {
    if (remoteKnowledgeClient && !override) return remoteKnowledgeClient;
    const currentConfig = normalizeConfig(configProvider());
    return createRemoteKnowledgeClient({ ...clientOptions, config: normalizeConfig(override, currentConfig) });
  };

  function getConnectionConfig() {
    return normalizeConfig(configProvider());
  }

  function getEndpointFingerprint() {
    return fingerprintEndpoint(getConnectionConfig().base_url);
  }

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
    const unique = new Map();
    for (const item of resultGroups.flat().map(mapSearchResult)) {
      const key = `${item.knowledgeBaseId}:${item.knowledgeId}:${item.chunkId}`;
      const current = unique.get(key);
      if (!current || item.score > current.score) unique.set(key, item);
    }
    return [...unique.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, resultLimit);
  }

  async function testConnection(input = {}) {
    const hasConfigOverride = input && (Object.hasOwn(input, 'base_url') || Object.hasOwn(input, 'api_key'));
    const signal = hasConfigOverride ? undefined : input?.signal;
    const client = getClient(hasConfigOverride ? input : undefined);
    try {
      const knowledgeBases = (await client.listKnowledgeBases({ signal })).map(mapKnowledgeBase);
      if (knowledgeBases.length) {
        const results = await client.hybridSearch({
          query: '远程知识连接测试',
          knowledgeBaseIds: [knowledgeBases[0].id],
          signal,
        });
        results.map(mapSearchResult);
      }
      return { knowledgeBaseCount: knowledgeBases.length };
    } catch (error) {
      if (error?.category === 'incompatible') throw incompatibleError();
      throw error;
    }
  }

  return { getConnectionConfig, getEndpointFingerprint, listDocuments, listKnowledgeBases, search, testConnection };
}

module.exports = {
  createRemoteKnowledgeService,
  mapSearchResult,
};
