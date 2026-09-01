const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getEndpointFingerprint,
  normalizeRemoteKnowledgeConfig,
} = require('./remoteKnowledgeConfig.cjs');

test('normalizes the endpoint and excludes the key from its fingerprint', () => {
  const first = normalizeRemoteKnowledgeConfig({
    base_url: 'http://192.168.231.16:8080/api/v1/',
    api_key: 'first-key',
  });
  const second = normalizeRemoteKnowledgeConfig({
    base_url: 'http://192.168.231.16:8080/api/v1',
    api_key: 'second-key',
  });
  assert.equal(first.base_url, 'http://192.168.231.16:8080/api/v1');
  assert.equal(getEndpointFingerprint(first.base_url), getEndpointFingerprint(second.base_url));
});

test('uses the bundled default when the connection is absent', () => {
  const config = normalizeRemoteKnowledgeConfig();
  assert.equal(config.base_url, 'http://192.168.231.16:8080/api/v1');
  assert.equal(config.api_key, '');
});
