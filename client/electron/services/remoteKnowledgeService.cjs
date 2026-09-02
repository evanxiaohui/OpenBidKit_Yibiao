const { createRemoteKnowledgeClient } = require('./weKnoraClient.cjs');
const {
  getEndpointFingerprint: fingerprintEndpoint,
  normalizeRemoteKnowledgeConfig,
} = require('./remoteKnowledgeConfig.cjs');

const INCOMPATIBLE_MESSAGE = '远程知识服务版本不受支持，请升级到 v0.7.2 或以上';
const SEARCH_CONCURRENCY = 3;
const DEFAULT_MATCH_COUNT = 8;
const QUERY_CANDIDATE_LIMIT = 8;
const RRF_K = 60;

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

function normalizeSearchQueries(queries) {
  return (Array.isArray(queries) ? queries : [])
    .map((query) => String(query || '').trim())
    .filter(Boolean);
}

function getResultKey(item) {
  return `${item.knowledgeBaseId}:${item.knowledgeId}:${item.chunkId}`;
}

function rankQueryCandidates(items) {
  const unique = new Map();
  for (const candidate of items.slice().sort((left, right) => (
    right.item.score - left.item.score || left.encounterIndex - right.encounterIndex
  ))) {
    const key = getResultKey(candidate.item);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].slice(0, QUERY_CANDIDATE_LIMIT);
}

function fuseSearchResults(queryCandidates, resultLimit) {
  const unique = new Map();
  for (const [queryIndex, candidates] of queryCandidates.entries()) {
    for (const [index, candidate] of candidates.entries()) {
      const { item, encounterIndex } = candidate;
      const key = getResultKey(item);
      const entry = unique.get(key) || {
        item,
        rrfScore: 0,
        queryIndexes: new Set(),
        bestScore: item.score,
        firstSeen: encounterIndex,
      };
      entry.rrfScore += 1 / (RRF_K + index + 1);
      entry.queryIndexes.add(queryIndex);
      entry.bestScore = Math.max(entry.bestScore, item.score);
      entry.firstSeen = Math.min(entry.firstSeen, encounterIndex);
      if (item.score > entry.item.score) entry.item = item;
      unique.set(key, entry);
    }
  }

  const selected = [];
  const selectedKeys = new Set();
  for (const candidates of queryCandidates) {
    const candidate = candidates.find(({ item }) => !selectedKeys.has(getResultKey(item)));
    if (!candidate) continue;
    const key = getResultKey(candidate.item);
    selected.push(unique.get(key));
    selectedKeys.add(key);
    if (selected.length >= resultLimit) return selected.map(({ item }) => item);
  }

  const remaining = [...unique.entries()]
    .filter(([key]) => !selectedKeys.has(key))
    .sort(([, left], [, right]) => (
      right.rrfScore - left.rrfScore
      || right.queryIndexes.size - left.queryIndexes.size
      || right.bestScore - left.bestScore
      || left.firstSeen - right.firstSeen
    ));
  for (const [key, entry] of remaining) {
    selected.push(entry);
    selectedKeys.add(key);
    if (selected.length >= resultLimit) break;
  }
  return selected.map(({ item }) => item);
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

  async function searchMany({ queries, scopes, matchCount, signal } = {}) {
    const normalizedQueries = normalizeSearchQueries(queries);
    if (!normalizedQueries.length) return [];
    const groups = buildSearchGroups(scopes);
    const resultLimit = resolveMatchCount(matchCount);
    const jobs = normalizedQueries.flatMap((query, queryIndex) => groups.map((group, groupIndex) => ({
      query,
      queryIndex,
      group,
      groupIndex,
    })));
    const resultGroups = await runWithConcurrency(jobs, SEARCH_CONCURRENCY, (job) => getClient().hybridSearch({
      query: job.query,
      signal,
      ...job.group,
    }));
    const perQueryResults = normalizedQueries.map(() => []);
    let encounterIndex = 0;
    for (const [jobIndex, results] of resultGroups.entries()) {
      const queryResults = perQueryResults[jobs[jobIndex].queryIndex];
      for (const result of results) {
        queryResults.push({ item: mapSearchResult(result), encounterIndex });
        encounterIndex += 1;
      }
    }
    return fuseSearchResults(perQueryResults.map(rankQueryCandidates), resultLimit);
  }

  async function search({ query, scopes, matchCount, signal } = {}) {
    return searchMany({ queries: [query], scopes, matchCount, signal });
  }

  async function testConnection(input = {}) {
    const hasConfigOverride = input && (Object.hasOwn(input, 'base_url') || Object.hasOwn(input, 'api_key'));
    const signal = hasConfigOverride ? undefined : input?.signal;
    const client = getClient(hasConfigOverride ? input : undefined);
    try {
      const knowledgeBases = (await client.listKnowledgeBases({ signal })).map(mapKnowledgeBase);
      const results = await client.hybridSearch({
        query: '远程知识连接测试',
        knowledgeBaseIds: knowledgeBases.length ? [knowledgeBases[0].id] : [],
        signal,
      });
      results.map(mapSearchResult);
      return { knowledgeBaseCount: knowledgeBases.length };
    } catch (error) {
      if (error?.category === 'incompatible') throw incompatibleError();
      throw error;
    }
  }

  return {
    getConnectionConfig,
    getEndpointFingerprint,
    listDocuments,
    listKnowledgeBases,
    search,
    searchMany,
    testConnection,
  };
}

module.exports = {
  createRemoteKnowledgeService,
  mapSearchResult,
};
