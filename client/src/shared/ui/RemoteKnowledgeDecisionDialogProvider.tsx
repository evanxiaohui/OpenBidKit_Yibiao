import { useEffect, useState, type ReactNode } from 'react';
import AppDialog from './AppDialog';
import type { RemoteKnowledgeDecision } from '../types/ipc';
import { navigateToAppSection, onRemoteKnowledgeDecision } from '../navigation/appNavigation';
import { formatRemoteKnowledgeDecisionDescription, getRemoteKnowledgeCategoryLabel } from '../remoteKnowledgeUi';

export function RemoteKnowledgeDecisionDialogProvider({ children }: { children: ReactNode }) {
  const [decision, setDecision] = useState<RemoteKnowledgeDecision | null>(null);
  const [visible, setVisible] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    const pendingPromise = window.yibiao?.remoteKnowledge?.getPendingDecision?.();
    if (pendingPromise) {
      void pendingPromise.then((pending) => {
        if (!disposed && pending) { setDecision(pending); setVisible(true); }
      });
    }
    const unsubscribe = window.yibiao?.remoteKnowledge?.onDecision?.((next) => {
      setDecision(next);
      setVisible(true);
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, []);

  useEffect(() => onRemoteKnowledgeDecision(() => { if (decision) setVisible(true); }), [decision]);

  const resolve = async (action: 'retry' | 'disable-and-continue') => {
    if (!decision) return;
    await window.yibiao?.remoteKnowledge?.resolveDecision?.({ decisionId: decision.decisionId, action });
    setDecision(null);
    setVisible(false);
  };

  return (
    <>
      {children}
      <AppDialog
        open={visible && Boolean(decision)}
        onOpenChange={(open: boolean) => { if (!open) setVisible(false); }}
        title="远程知识调用失败"
        description={formatRemoteKnowledgeDecisionDescription(decision?.stage, decision?.summary)}
        cardClassName="remote-knowledge-decision-card"
        actions={(
          <div className="remote-knowledge-decision-actions">
            <button type="button" className="secondary-action" onClick={() => void resolve('disable-and-continue')}>停用远程并继续</button>
            <button type="button" className="primary-action" onClick={() => void resolve('retry')}>重试</button>
          </div>
        )}
      >
        <div className="remote-knowledge-decision-links">
          <button type="button" className="text-button" onClick={() => navigateToAppSection('settings', { settingsTab: 'remote-knowledge' })}>检查设置</button>
          <button type="button" className="text-button" onClick={() => setDetailsOpen(true)}>错误详情</button>
        </div>
      </AppDialog>
      <AppDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="远程知识错误详情"
        description="仅显示已脱敏的诊断信息。"
        actions={<button type="button" className="primary-action" onClick={() => setDetailsOpen(false)}>关闭</button>}
      >
        <dl className="remote-knowledge-decision-details">
          <dt>类别</dt><dd>{getRemoteKnowledgeCategoryLabel(decision?.category)}</dd>
          <dt>状态</dt><dd>{decision?.httpStatus || '-'}</dd>
          <dt>请求 ID</dt><dd>{decision?.requestId || '-'}</dd>
          <dt>发生时间</dt><dd>{decision?.occurredAt ? new Date(decision.occurredAt).toLocaleString('zh-CN') : '-'}</dd>
          <dt>摘要</dt><dd>{decision?.summary || '-'}</dd>
        </dl>
      </AppDialog>
    </>
  );
}

export default RemoteKnowledgeDecisionDialogProvider;
