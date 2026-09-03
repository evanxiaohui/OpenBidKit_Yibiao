import assert from 'node:assert/strict';
import test from 'node:test';

async function loadUiHelpers() {
  const modulePath = './remoteKnowledgeUi.ts';
  return import(modulePath).catch(() => ({} as Record<string, unknown>));
}

test('remote knowledge decisions use Chinese stage and error labels', async () => {
  const helpers = await loadUiHelpers();
  const formatDescription = helpers.formatRemoteKnowledgeDecisionDescription as undefined | ((stage: string, summary: string) => string);
  const getCategoryLabel = helpers.getRemoteKnowledgeCategoryLabel as undefined | ((category: string) => string);

  assert.equal(formatDescription?.('content-planning', '连接失败'), '正文编排：连接失败');
  assert.equal(getCategoryLabel?.('endpoint-mismatch'), '服务地址不匹配');
  assert.equal(getCategoryLabel?.('unknown-value'), '未知错误');
});

test('connection errors preserve the specific service message', async () => {
  const helpers = await loadUiHelpers();
  const formatError = helpers.formatRemoteKnowledgeConnectionError as undefined | ((error: unknown) => string);

  assert.equal(formatError?.(new Error('远程知识服务响应格式不兼容')), '远程知识服务响应格式不兼容');
  assert.equal(formatError?.(null), '连接失败，请检查服务地址、API Key 和远程服务状态');
});

test('retry routing follows the latest load failure instead of a stored callback', async () => {
  const helpers = await loadUiHelpers();
  const createFailure = helpers.createRemoteKnowledgeLoadFailure as undefined | ((
    kind: 'bases' | 'documents',
    error: unknown,
    context?: { knowledgeBaseId: string; page: number },
  ) => unknown);
  const retryLoad = helpers.retryRemoteKnowledgeLoad as undefined | ((
    failure: unknown,
    actions: { loadBases: () => void; loadDocuments: (knowledgeBaseId: string, page: number) => void },
  ) => void);
  const calls: string[] = [];
  const actions = {
    loadBases: () => calls.push('bases'),
    loadDocuments: (knowledgeBaseId: string, page: number) => calls.push(`documents:${knowledgeBaseId}:${page}`),
  };

  const documentFailure = createFailure?.('documents', new Error('文档失败'), { knowledgeBaseId: 'kb-1', page: 2 });
  retryLoad?.(documentFailure, actions);
  const latestFailure = createFailure?.('bases', new Error('知识库失败'));
  retryLoad?.(latestFailure, actions);

  assert.deepEqual(calls, ['documents:kb-1:2', 'bases']);
});
