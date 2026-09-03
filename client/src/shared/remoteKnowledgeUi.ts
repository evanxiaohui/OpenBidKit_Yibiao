const stageLabels: Record<string, string> = {
  outline: '目录生成',
  'global-facts': '全局事实提取',
  'content-planning': '正文编排',
};

const categoryLabels: Record<string, string> = {
  network: '网络连接失败',
  timeout: '请求超时',
  http: '远程服务响应错误',
  incompatible: '响应格式不兼容',
  'endpoint-mismatch': '服务地址不匹配',
  cancelled: '请求已取消',
};

export type RemoteKnowledgeLoadFailure =
  | { kind: 'bases'; message: string }
  | { kind: 'documents'; message: string; knowledgeBaseId: string; page: number };

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message || '').trim();
    if (message) return message;
  }
  return fallback;
}

export function formatRemoteKnowledgeDecisionDescription(stage: string | undefined, summary: string | undefined) {
  return `${stageLabels[String(stage || '')] || '当前阶段'}：${String(summary || '').trim() || '远程知识检索失败'}`;
}

export function getRemoteKnowledgeCategoryLabel(category: string | undefined) {
  return categoryLabels[String(category || '')] || '未知错误';
}

export function formatRemoteKnowledgeConnectionError(error: unknown) {
  return errorMessage(error, '连接失败，请检查服务地址、API Key 和远程服务状态');
}

export function createRemoteKnowledgeLoadFailure(
  kind: 'bases' | 'documents',
  error: unknown,
  context?: { knowledgeBaseId: string; page: number },
): RemoteKnowledgeLoadFailure {
  if (kind === 'documents' && context) {
    return {
      kind,
      knowledgeBaseId: context.knowledgeBaseId,
      page: context.page,
      message: errorMessage(error, '读取远程文档失败'),
    };
  }
  return { kind: 'bases', message: errorMessage(error, '读取远程知识库失败') };
}

export function retryRemoteKnowledgeLoad(
  failure: RemoteKnowledgeLoadFailure,
  actions: {
    loadBases: () => void | Promise<void>;
    loadDocuments: (knowledgeBaseId: string, page: number) => void | Promise<void>;
  },
) {
  if (failure.kind === 'documents') {
    return actions.loadDocuments(failure.knowledgeBaseId, failure.page);
  }
  return actions.loadBases();
}
