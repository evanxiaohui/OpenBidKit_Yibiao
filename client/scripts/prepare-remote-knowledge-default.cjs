const fs = require('node:fs');
const path = require('node:path');
const { normalizeBaseUrl } = require('../electron/services/remoteKnowledgeConfig.cjs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const COMMITTED_DEFAULT_PATH = path.join(CLIENT_ROOT, 'electron', 'resources', 'default-remote-knowledge.json');
const PRIVATE_DEFAULT_PATH = path.join(CLIENT_ROOT, 'build-secrets', 'default-remote-knowledge.json');
const GENERATED_DEFAULT_PATH = path.join(CLIENT_ROOT, 'build', 'generated', 'default-remote-knowledge.json');

function mergePackagedDefault(committedDefault, privateDefault) {
  const baseUrl = normalizeBaseUrl(privateDefault.base_url || committedDefault.base_url);
  const apiKey = String(privateDefault.api_key || '').trim();
  if (!apiKey) {
    throw new Error('缺少 client/build-secrets/default-remote-knowledge.json 中的非空 api_key');
  }
  return { base_url: baseUrl, api_key: apiKey };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function prepareRemoteKnowledgeDefault() {
  const packagedDefault = mergePackagedDefault(
    readJson(COMMITTED_DEFAULT_PATH),
    readJson(PRIVATE_DEFAULT_PATH),
  );
  fs.mkdirSync(path.dirname(GENERATED_DEFAULT_PATH), { recursive: true });
  fs.writeFileSync(GENERATED_DEFAULT_PATH, `${JSON.stringify(packagedDefault, null, 2)}\n`, 'utf-8');
}

if (require.main === module) {
  prepareRemoteKnowledgeDefault();
}

module.exports = {
  mergePackagedDefault,
  prepareRemoteKnowledgeDefault,
};
