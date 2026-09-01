const crypto = require('node:crypto');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS = [200, 500];
const DEFAULT_TIMEOUT_MS = 15000;

class RemoteKnowledgeRequestError extends Error {
  constructor({ category, httpStatus, message }) {
    super(message || '远程知识请求失败');
    this.name = 'RemoteKnowledgeRequestError';
    this.category = category;
    if (httpStatus) this.httpStatus = httpStatus;
  }
}

function createError(category, httpStatus) {
  const messages = {
    cancelled: '远程知识请求已取消',
    incompatible: '远程知识服务响应格式不兼容',
    network: '远程知识服务网络连接失败',
    timeout: '远程知识服务请求超时',
  };
  return new RemoteKnowledgeRequestError({
    category,
    httpStatus,
    message: messages[category] || `远程知识服务请求失败（HTTP ${httpStatus}）`,
  });
}

function wait(delay, signal) {
  if (signal?.aborted) return Promise.reject(createError('cancelled'));
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    function onAbort() {
      clearTimeout(timer);
      reject(createError('cancelled'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getBaseUrl(config) {
  return String(config?.base_url || '').replace(/\/+$/, '');
}

function ensureObject(value) {
  if (!value || typeof value !== 'object') throw createError('incompatible');
  return value;
}

function extractArrayResponse(payload) {
  const body = ensureObject(payload);
  if (body.success === false || !Array.isArray(body.data)) throw createError('incompatible');
  return body.data;
}

function extractSearchResponse(payload) {
  const body = ensureObject(payload);
  if (body.success === false) throw createError('incompatible');
  if (Array.isArray(body.data)) return body.data;
  if (body.data && typeof body.data === 'object' && Array.isArray(body.data.results)) return body.data.results;
  throw createError('incompatible');
}

function createRemoteKnowledgeClient({ config, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retryDelays = DEFAULT_RETRY_DELAYS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('远程知识请求实现不可用');
  const baseUrl = getBaseUrl(config);

  async function requestOnce({ method, requestPath, body, signal, requestId }) {
    if (signal?.aborted) throw createError('cancelled');
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}${requestPath}`, {
        method,
        headers: {
          'X-API-Key': String(config?.api_key || ''),
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response?.ok) throw createError('http', response?.status);
      try {
        return await response.json();
      } catch {
        throw createError('incompatible');
      }
    } catch (error) {
      if (error?.category) throw error;
      if (signal?.aborted) throw createError('cancelled');
      if (timedOut) throw createError('timeout');
      throw createError('network');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function request({ method, requestPath, body, signal }) {
    const requestId = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await requestOnce({ method, requestPath, body, signal, requestId });
      } catch (error) {
        const retryable = error.category === 'network'
          || error.category === 'timeout'
          || RETRYABLE_STATUS.has(error.httpStatus);
        if (!retryable || attempt === 2) throw error;
        await wait(retryDelays[attempt], signal);
      }
    }
    throw new Error('远程知识请求未返回结果');
  }

  async function listKnowledgeBases({ signal } = {}) {
    return extractArrayResponse(await request({ method: 'GET', requestPath: '/knowledge-bases', signal }));
  }

  async function listKnowledge({ knowledgeBaseId, page = 1, pageSize = 20, signal } = {}) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const payload = ensureObject(await request({
      method: 'GET',
      requestPath: `/knowledge-bases/${encodeURIComponent(String(knowledgeBaseId))}/knowledge?${query}`,
      signal,
    }));
    if (payload.success === false || !Array.isArray(payload.data) || !Number.isFinite(Number(payload.total))) {
      throw createError('incompatible');
    }
    return {
      items: payload.data,
      total: Number(payload.total),
      page: Number.isFinite(Number(payload.page)) ? Number(payload.page) : page,
      pageSize: Number.isFinite(Number(payload.page_size)) ? Number(payload.page_size) : pageSize,
    };
  }

  async function hybridSearch({ query, knowledgeBaseIds, knowledgeIds, signal } = {}) {
    const ids = Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds.map(String).filter(Boolean) : [];
    if (!ids.length) throw new Error('远程知识检索范围不能为空');
    const body = {
      query: String(query || ''),
      knowledge_base_ids: ids,
    };
    const documentIds = Array.isArray(knowledgeIds) ? knowledgeIds.map(String).filter(Boolean) : [];
    if (documentIds.length) body.knowledge_ids = documentIds;
    return extractSearchResponse(await request({
      method: 'POST',
      requestPath: '/knowledge-search',
      body,
      signal,
    }));
  }

  return { hybridSearch, listKnowledge, listKnowledgeBases };
}

module.exports = {
  createRemoteKnowledgeClient,
};
