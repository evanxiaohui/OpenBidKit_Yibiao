const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('远程知识服务地址必须以 http:// 或 https:// 开头');
  return text;
}

function getEndpointFingerprint(baseUrl) {
  return crypto.createHash('sha256').update(normalizeBaseUrl(baseUrl)).digest('hex');
}

function getBundledDefaultPath() {
  if (process.resourcesPath && !process.defaultApp) {
    return path.join(process.resourcesPath, 'default-remote-knowledge.json');
  }
  return path.join(__dirname, '..', 'resources', 'default-remote-knowledge.json');
}

function loadBundledRemoteKnowledgeDefault() {
  return JSON.parse(fs.readFileSync(getBundledDefaultPath(), 'utf-8'));
}

function normalizeRemoteKnowledgeConfig(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : loadBundledRemoteKnowledgeDefault();
  return {
    base_url: normalizeBaseUrl(source.base_url || defaults.base_url),
    api_key: typeof source.api_key === 'string' ? source.api_key.trim() : String(defaults.api_key || '').trim(),
  };
}

module.exports = {
  getEndpointFingerprint,
  loadBundledRemoteKnowledgeDefault,
  normalizeBaseUrl,
  normalizeRemoteKnowledgeConfig,
};
