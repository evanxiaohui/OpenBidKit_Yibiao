import type { RemoteKnowledgeBase } from '../../shared/types/ipc';
import type { RemoteKnowledgeScope } from './types';

export interface RemoteKnowledgeDocumentScope { knowledgeId: string; title: string; }

export type { RemoteKnowledgeBase, RemoteKnowledgeScope };

export function isRemoteScopeStale(scope: RemoteKnowledgeScope, currentFingerprint: string): boolean {
  return scope.endpointFingerprint !== currentFingerprint;
}

export function isRemoteDocumentSelectionDisabled(scope: RemoteKnowledgeScope | undefined, disabled: boolean): boolean {
  return disabled || scope?.mode === 'all';
}

export function formatKnowledgeReferenceSummary(localDocumentCount: number, remoteScopes: RemoteKnowledgeScope[]): string {
  const parts: string[] = [];
  if (localDocumentCount > 0) parts.push(`本地 ${localDocumentCount} 个文档`);

  const wholeLibraryCount = remoteScopes.filter((scope) => scope.mode === 'all').length;
  if (wholeLibraryCount > 0) parts.push(`远程 ${wholeLibraryCount} 个完整知识库`);

  const remoteDocumentCount = remoteScopes.reduce(
    (count, scope) => count + (scope.mode === 'documents' ? scope.documents.length : 0),
    0,
  );
  if (remoteDocumentCount > 0) parts.push(`远程 ${remoteDocumentCount} 个指定文档`);

  return parts.join('，') || '未选择';
}

export function beginRemoteDocumentSelection(scopes: RemoteKnowledgeScope[], knowledgeBaseId: string): RemoteKnowledgeScope[] {
  return scopes.filter((scope) => scope.knowledgeBaseId !== knowledgeBaseId || scope.mode !== 'all');
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
  if (!documents.length) return scopes.filter((scope) => scope.knowledgeBaseId !== knowledgeBase.id);
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
