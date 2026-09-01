const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { registerRemoteKnowledgeIpc } = require('./remoteKnowledgeIpc.cjs');

test('registers only remote knowledge metadata channels and delegates requests', async () => {
  const handlers = new Map();
  const registered = [];
  const ipcMain = {
    handle(channel, handler) {
      registered.push(channel);
      handlers.set(channel, handler);
    },
  };
  const calls = [];
  const remoteKnowledgeService = {
    testConnection(config) {
      calls.push({ method: 'testConnection', config });
      return { knowledgeBaseCount: 2 };
    },
    listKnowledgeBases() {
      calls.push({ method: 'listKnowledgeBases' });
      return [{ id: 'kb-1', name: '规范库', description: '' }];
    },
    listDocuments(input) {
      calls.push({ method: 'listDocuments', input });
      return { items: [], total: 0, page: 1, pageSize: 20 };
    },
  };

  registerRemoteKnowledgeIpc({ ipcMain, remoteKnowledgeService });

  assert.deepEqual(registered.sort(), [
    'remote-knowledge:list-documents',
    'remote-knowledge:list-knowledge-bases',
    'remote-knowledge:test-connection',
  ]);
  assert.deepEqual(await handlers.get('remote-knowledge:test-connection')({}, { base_url: 'http://remote.example/api/v1', api_key: 'draft-key' }), { knowledgeBaseCount: 2 });
  assert.deepEqual(await handlers.get('remote-knowledge:list-knowledge-bases')({}), [{ id: 'kb-1', name: '规范库', description: '' }]);
  assert.deepEqual(await handlers.get('remote-knowledge:list-documents')({}, { knowledgeBaseId: 'kb-1', page: 1, pageSize: 20 }), { items: [], total: 0, page: 1, pageSize: 20 });
  assert.deepEqual(calls, [
    { method: 'testConnection', config: { base_url: 'http://remote.example/api/v1', api_key: 'draft-key' } },
    { method: 'listKnowledgeBases' },
    { method: 'listDocuments', input: { knowledgeBaseId: 'kb-1', page: 1, pageSize: 20 } },
  ]);
});

test('real preload bridge exposes only the typed remote knowledge channels', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.match(preloadSource, /remoteKnowledge:\s*\{/);
  assert.match(preloadSource, /testConnection:\s*\(config\)\s*=>\s*ipcRenderer\.invoke\('remote-knowledge:test-connection',\s*config\)/);
  assert.match(preloadSource, /listKnowledgeBases:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('remote-knowledge:list-knowledge-bases'\)/);
  assert.match(preloadSource, /listDocuments:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\('remote-knowledge:list-documents',\s*input\)/);
  const remoteKnowledgeBlock = preloadSource.match(/remoteKnowledge:\s*\{([\s\S]*?)\n\s*\},\n\s*license:/)?.[1] || '';
  assert.equal(/\brequest\s*:/.test(remoteKnowledgeBlock), false);
});
