const assert = require('node:assert/strict');
const test = require('node:test');

const { mergePackagedDefault } = require('./prepare-remote-knowledge-default.cjs');

test('rejects packaging without a non-empty local API key', () => {
  assert.throws(
    () => mergePackagedDefault(
      { base_url: 'http://192.168.231.16:8080/api/v1', api_key: '' },
      { base_url: '', api_key: '' },
    ),
    /build-secrets\/default-remote-knowledge\.json/,
  );
});

test('uses a private endpoint override and trims the local API key', () => {
  const result = mergePackagedDefault(
    { base_url: 'http://192.168.231.16:8080/api/v1', api_key: '' },
    { base_url: ' https://knowledge.example/api/v1/ ', api_key: ' local-key ' },
  );
  assert.deepEqual(result, {
    base_url: 'https://knowledge.example/api/v1',
    api_key: 'local-key',
  });
});
