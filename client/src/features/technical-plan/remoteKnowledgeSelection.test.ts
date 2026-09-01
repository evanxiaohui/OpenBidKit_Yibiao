import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node 22 executes TypeScript test modules directly.
import {
  clearRemoteSelections,
  isRemoteScopeStale,
  selectRemoteDocuments,
  selectWholeKnowledgeBase,
  type RemoteKnowledgeBase,
  type RemoteKnowledgeScope,
// @ts-expect-error Node 22 native TypeScript test import.
} from './remoteKnowledgeSelection.ts';

const remoteBase = (id: string): RemoteKnowledgeBase => ({ id, name: id, description: '' });
const scope = (id: string, mode: RemoteKnowledgeScope['mode'], ids: string[] = [], fingerprint = 'fp-1'): RemoteKnowledgeScope => ({
  knowledgeBaseId: id,
  knowledgeBaseName: id,
  mode,
  endpointFingerprint: fingerprint,
  documents: ids.map((knowledgeId) => ({ knowledgeId, title: knowledgeId })),
});

test('whole-library selection clears document selections for the same library', () => {
  const next = selectWholeKnowledgeBase([
    scope('kb-1', 'documents', ['doc-1']),
    scope('kb-2', 'documents', ['doc-2']),
  ], remoteBase('kb-1'), 'fp-2');
  assert.equal(next[0].mode, 'all');
  assert.deepEqual(next[0].documents, []);
  assert.deepEqual(next[1].documents.map((item) => item.knowledgeId), ['doc-2']);
});

test('document selection switches a whole-library scope to documents and preserves other scopes', () => {
  const next = selectRemoteDocuments([
    scope('kb-1', 'all'),
    scope('kb-2', 'documents', ['doc-2']),
  ], remoteBase('kb-1'), [{ knowledgeId: 'doc-1', title: 'Doc 1' }], 'fp-1');
  assert.equal(next[0].mode, 'documents');
  assert.deepEqual(next[0].documents.map((item) => item.knowledgeId), ['doc-1']);
  assert.deepEqual(next[1].documents.map((item) => item.knowledgeId), ['doc-2']);
});

test('pagination does not change selected document state', () => {
  const before = [scope('kb-1', 'documents', ['doc-1'])];
  const after = selectRemoteDocuments(before, remoteBase('kb-1'), [{ knowledgeId: 'doc-1', title: 'Doc 1' }], 'fp-1');
  assert.deepEqual(after, before);
});

test('mixed scopes can be cleared without affecting local selection', () => {
  assert.deepEqual(clearRemoteSelections([scope('kb-1', 'all'), scope('kb-2', 'documents', ['doc-2'])]), []);
});

test('fingerprint mismatch marks a scope stale', () => {
  assert.equal(isRemoteScopeStale(scope('kb-1', 'all', [], 'old'), 'new'), true);
  assert.equal(isRemoteScopeStale(scope('kb-1', 'all', [], 'same'), 'same'), false);
});
