import type { RemoteKnowledgeBase } from '../../shared/types/ipc';
import type { RemoteKnowledgeScope } from './types';

export interface RemoteKnowledgeDocumentScope { knowledgeId: string; title: string; }

export type { RemoteKnowledgeBase, RemoteKnowledgeScope };

export function isRemoteScopeStale(scope: RemoteKnowledgeScope, currentFingerprint: string): boolean {
  return scope.endpointFingerprint !== currentFingerprint;
}

export function selectWholeKnowledgeBase(
  scopes: RemoteKnowledgeScope[],
  knowledgeBase: RemoteKnowledgeBase,
  endpointFingerprint = '',
): RemoteKnowledgeScope[] {
  const replacement: RemoteKnowledgeScope = {
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBaseName: knowledgeBase.name,
    mode: 'all',
    documents: [],
    endpointFingerprint,
  };
  const index = scopes.findIndex((scope) => scope.knowledgeBaseId === knowledgeBase.id);
  if (index < 0) return [...scopes, replacement];
  return scopes.map((scope, i) => i === index ? replacement : scope);
}

export function selectRemoteDocuments(
  scopes: RemoteKnowledgeScope[],
  knowledgeBase: RemoteKnowledgeBase,
  documents: RemoteKnowledgeDocumentScope[],
  endpointFingerprint = '',
): RemoteKnowledgeScope[] {
  if (!documents.length) return scopes;
  const existing = scopes.find((scope) => scope.knowledgeBaseId === knowledgeBase.id);
  const normalizedDocuments = documents.map((document) => existing?.documents.find((item) => item.knowledgeId === document.knowledgeId) || document);
  const replacement: RemoteKnowledgeScope = {
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBaseName: knowledgeBase.name,
    mode: 'documents',
    documents: normalizedDocuments,
    endpointFingerprint,
  };
  const index = scopes.findIndex((scope) => scope.knowledgeBaseId === knowledgeBase.id);
  if (index < 0) return [...scopes, replacement];
  return scopes.map((scope, i) => i === index ? replacement : scope);
}

export function clearRemoteSelections(_scopes: RemoteKnowledgeScope[]): RemoteKnowledgeScope[] {
  return [];
}
