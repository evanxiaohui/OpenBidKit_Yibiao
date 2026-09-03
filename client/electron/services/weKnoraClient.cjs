const crypto = require('node:crypto');

const DEFAULT_RETRY_DELAYS = [200, 500];
const DEFAULT_TIMEOUT_MS = 15000;

class RemoteKnowledgeRequestError extends Error {
  constructor({ category, httpStatus, message, requestId }) {
    super(message || '远程知识请求失败');
    this.name = 'RemoteKnowledgeRequestError';
    this.category = category;
    if (httpStatus) this.httpStatus = httpStatus;
    if (requestId) this.requestId = requestId;
  }
}

function createError(category, httpStatus, requestId) {
  const messages = {
    cancelled: '远程知识请求已取消',
    incompatible: '远程知识服务响应格式不兼容',
    network: '远程知识服务网络连接失败',
    timeout: '远程知识服务请求超时',
  };
  return new RemoteKnowledgeRequestError({
    category,
    httpStatus,
    requestId,
    message: messages[category] || `远程知识服务请求失败（HTTP ${httpStatus}）`,
  });
}

function isRetryableHttpStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500 && status < 600);
}

function wait(delay, signal, requestId) {
  if (signal?.aborted) return Promise.reject(createError('cancelled', undefined, requestId));
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    function onAbort() {
      clearTimeout(timer);
      reject(createError('cancelled', undefined, requestId));
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
    if (signal?.aborted) throw createError('cancelled', undefined, requestId);
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
      if (!response?.ok) throw createError('http', response?.status, requestId);
      try {
        return await response.json();
      } catch {
        throw createError('incompatible', undefined, requestId);
      }
    } catch (error) {
      if (error?.category) throw error;
      if (signal?.aborted) throw createError('cancelled', undefined, requestId);
      if (timedOut) throw createError('timeout', undefined, requestId);
      throw createError('network', undefined, requestId);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function request({ method, requestPath, body, signal, transform = (value) => value }) {
    const requestId = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return transform(await requestOnce({ method, requestPath, body, signal, requestId }));
      } catch (error) {
        if (error && !error.requestId) error.requestId = requestId;
        const retryable = error.category === 'network'
          || error.category === 'timeout'
          || isRetryableHttpStatus(error.httpStatus);
        if (!retryable || attempt === 2) throw error;
        await wait(retryDelays[attempt], signal, requestId);
      }
    }
    throw new Error('远程知识请求未返回结果');
  }

  async function listKnowledgeBases({ signal, transformResult } = {}) {
    return request({
      method: 'GET',
      requestPath: '/knowledge-bases',
      signal,
      transform: (payload) => {
        const result = extractArrayResponse(payload);
        return typeof transformResult === 'function' ? transformResult(result) : result;
      },
    });
  }

  async function listKnowledge({ knowledgeBaseId, page = 1, pageSize = 20, signal, transformResult } = {}) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return request({
      method: 'GET',
      requestPath: `/knowledge-bases/${encodeURIComponent(String(knowledgeBaseId))}/knowledge?${query}`,
      signal,
      transform: (value) => {
        const payload = ensureObject(value);
        if (payload.success === false || !Array.isArray(payload.data) || !Number.isFinite(Number(payload.total))) {
          throw createError('incompatible');
        }
        const result = {
          items: payload.data,
          total: Number(payload.total),
          page: Number.isFinite(Number(payload.page)) ? Number(payload.page) : page,
          pageSize: Number.isFinite(Number(payload.page_size)) ? Number(payload.page_size) : pageSize,
        };
        return typeof transformResult === 'function' ? transformResult(result) : result;
      },
    });
  }

  async function hybridSearch({ query, knowledgeBaseIds, knowledgeIds, signal, transformResult } = {}) {
    const ids = Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds.map(String).filter(Boolean) : [];
    const body = {
      query: String(query || ''),
      knowledge_base_ids: ids,
    };
    const documentIds = Array.isArray(knowledgeIds) ? knowledgeIds.map(String).filter(Boolean) : [];
    if (documentIds.length) body.knowledge_ids = documentIds;
    return request({
      method: 'POST',
      requestPath: '/knowledge-search',
      body,
      signal,
      transform: (payload) => {
        const result = extractSearchResponse(payload);
        return typeof transformResult === 'function' ? transformResult(result) : result;
      },
    });
  }

  return { hybridSearch, listKnowledge, listKnowledgeBases };
}

module.exports = {
  createRemoteKnowledgeClient,
};
