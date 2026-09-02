'use strict';

const MAX_QUERY_COUNT = 5;
const MAX_QUERY_LENGTH = 240;

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePlannedQueries(value) {
  const seen = new Set();
  const queries = [];
  for (const raw of Array.isArray(value?.queries) ? value.queries : []) {
    const query = normalizeQuery(raw);
    if (!query || query.length > MAX_QUERY_LENGTH || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length === MAX_QUERY_COUNT) break;
  }
  return queries;
}

function collectContextText(value, path = '', output = []) {
  if (typeof value === 'string') {
    if (value.trim()) output.push({ path, text: value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectContextText(item, `${path}[${index}]`, output));
    return output;
  }
  if (value && typeof value === 'object') {
    if (typeof value.title === 'string' && typeof value.description === 'string') {
      output.push({ path, text: `${value.title}：${value.description}` });
    }
    Object.entries(value).forEach(([key, item]) => collectContextText(item, path ? `${path}.${key}` : key, output));
  }
  return output;
}

const CATEGORY_RULES = {
  implementation: { keys: ['实施', '流程', '步骤', '组织', '进度', '工期'], template: (topic, stage) => stage === 'outline' ? `目录编排中的“${topic}”应如何划分实施阶段和成果要求？` : `围绕“${topic}”，该类项目通常包含哪些专业实施阶段和成果要求？` },
  quality: { keys: ['质量', '验收', '成果汇交', '数据库更新', '检查', '整改'], template: (topic, stage) => stage === 'global-facts' ? `“${topic}”相关的质量事实、验收依据与成果交付通常如何确认？` : `“${topic}”相关的质量控制、验收与成果交付通常如何组织？` },
  technical: { keys: ['技术', '标准', '规范', '方法', '系统', '数据'], template: (topic, stage) => stage === 'content-planning' ? `章节“${topic}”应落实哪些技术方法、标准规范和数据成果要求？` : `“${topic}”涉及哪些技术方法、标准规范和数据成果要求？` },
  security: { keys: ['安全', '保密', '风险', '应急'], template: (topic) => `“${topic}”相关的安全风险、保密要求和应急措施有哪些？` },
  personnel: { keys: ['人员', '团队', '项目经理', '培训', '服务'], template: (topic) => `“${topic}”需要怎样的人员配置、服务组织和保障机制？` },
};

const STAGE_CATEGORY_ORDER = {
  outline: ['implementation', 'technical', 'quality', 'personnel', 'security'],
  'global-facts': ['quality', 'technical', 'implementation', 'security', 'personnel'],
  'content-planning': ['technical', 'quality', 'implementation', 'personnel', 'security'],
};

function splitSentences(text) {
  return String(text || '')
    .split(/[。！？!?；;\n\r]+/)
    .map((sentence) => normalizeQuery(sentence))
    .filter(Boolean);
}

function informationScore(sentence, rule) {
  const matched = rule.keys.filter((key) => sentence.includes(key));
  const specific = matched.filter((key) => key.length >= 3).length;
  return matched.length * 10 + specific * 8 + Math.min(sentence.length, 120) / 120;
}

function buildFallbackQueries(stage, context) {
  const entries = collectContextText(context);
  const sentences = entries.flatMap(({ text }) => splitSentences(text));
  const selected = [];
  const seenTopics = new Set();
  const categoryOrder = STAGE_CATEGORY_ORDER[stage] || STAGE_CATEGORY_ORDER['global-facts'];
  for (const category of categoryOrder) {
    const rule = CATEGORY_RULES[category];
    const candidates = sentences.filter((item) => rule.keys.some((key) => item.includes(key)));
    const sentence = candidates
      .map((item, index) => ({ item, index, score: informationScore(item, rule) }))
      .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.item;
    if (!sentence || seenTopics.has(sentence)) continue;
    const query = normalizeQuery(rule.template(sentence, stage));
    if (query.length <= MAX_QUERY_LENGTH) {
      selected.push(query);
      seenTopics.add(sentence);
    }
    if (selected.length === MAX_QUERY_COUNT) break;
  }
  if (!selected.length) {
    const stageLabel = {
      'global-facts': '项目全局事实',
      outline: '投标文件目录与章节',
      'content-planning': '章节正文编制',
      content: '章节正文编制',
    }[stage] || '项目实施';
    selected.push(`该类项目通常包含哪些${stageLabel}相关的专业要求和成果要求？`);
  }
  return selected.slice(0, MAX_QUERY_COUNT);
}

function buildQueryPlanningMessages(stage, context) {
  const contextJson = JSON.stringify(context ?? {}, null, 2);
  return [
    {
      role: 'system',
      content: '你是远程知识库查询规划器。只输出 JSON，格式为 {"queries":["..."]}。返回 1-5 个完整语义问题；每个查询只包含一个意图，且不超过 160 个中文字符。不要复制原文段落，不要截断问题，不要臆造项目事实；只能根据提供的阶段和上下文提炼检索主题。',
    },
    {
      role: 'user',
      content: `当前阶段：${stage}\n以下是完整项目上下文，请据此规划短查询：\n${contextJson}`,
    },
  ];
}

async function planRemoteKnowledgeQueries({ aiService, stage, context, signal } = {}) {
  if (signal?.aborted) {
    const error = new Error('远程知识查询规划已取消');
    error.name = 'AbortError';
    throw error;
  }
  try {
    const planned = await aiService.collectJsonResponse({
      messages: buildQueryPlanningMessages(stage, context),
      logTitle: `远程知识查询规划-${stage}`,
      progressLabel: '远程知识查询规划',
      failureMessage: '模型返回的远程知识查询规划无效',
      normalizer: (value) => ({ queries: normalizePlannedQueries(value) }),
      validator: (value) => Array.isArray(value?.queries) && value.queries.length > 0,
      max_retries: 1,
      signal,
    });
    const queries = normalizePlannedQueries(planned);
    if (queries.length) return { queries, source: 'ai' };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
  }
  return { queries: buildFallbackQueries(stage, context), source: 'fallback' };
}

module.exports = {
  MAX_QUERY_COUNT,
  MAX_QUERY_LENGTH,
  normalizePlannedQueries,
  buildFallbackQueries,
  buildQueryPlanningMessages,
  planRemoteKnowledgeQueries,
};
