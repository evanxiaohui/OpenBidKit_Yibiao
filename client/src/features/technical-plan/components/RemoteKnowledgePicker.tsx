import { useEffect, useState } from 'react';
import type { RemoteKnowledgeBase, RemoteKnowledgeDocumentPage } from '../../../shared/types/ipc';
import {
  createRemoteKnowledgeLoadFailure,
  retryRemoteKnowledgeLoad,
  type RemoteKnowledgeLoadFailure,
} from '../../../shared/remoteKnowledgeUi';
import type { RemoteKnowledgeScope } from '../types';
import {
  beginRemoteDocumentSelection,
  isRemoteDocumentSelectionDisabled,
  isRemoteScopeStale,
  selectRemoteDocuments,
  selectWholeKnowledgeBase,
} from '../remoteKnowledgeSelection';

interface Props {
  scopes: RemoteKnowledgeScope[];
  disabled?: boolean;
  onChange: (scopes: RemoteKnowledgeScope[]) => void;
}

export default function RemoteKnowledgePicker({ scopes, disabled = false, onChange }: Props) {
  const [bases, setBases] = useState<RemoteKnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<Record<string, RemoteKnowledgeDocumentPage>>({});
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<RemoteKnowledgeLoadFailure | null>(null);
  const [endpointFingerprint, setEndpointFingerprint] = useState('');

  const loadBases = async () => {
    setLoading(true); setLoadFailure(null);
    try {
      const fingerprint = await window.yibiao?.remoteKnowledge.getEndpointFingerprint() || '';
      setEndpointFingerprint(fingerprint);
      setBases(await window.yibiao?.remoteKnowledge.listKnowledgeBases() || []);
    } catch (error) { setLoadFailure(createRemoteKnowledgeLoadFailure('bases', error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadBases(); }, []);

  const loadDocuments = async (baseId: string, nextPage = 1) => {
    setLoadFailure(null);
    try {
      const result = await window.yibiao?.remoteKnowledge.listDocuments({ knowledgeBaseId: baseId, page: nextPage, pageSize: 20 });
      if (result) setDocuments((prev) => ({ ...prev, [baseId]: result }));
    } catch (error) {
      setLoadFailure(createRemoteKnowledgeLoadFailure('documents', error, { knowledgeBaseId: baseId, page: nextPage }));
    }
  };
  return <div className="remote-knowledge-picker outline-knowledge-browser">
    <div className="outline-knowledge-pane-head remote-knowledge-pane-head">
      <strong>知识库</strong>
      <span>{bases.length} 个知识库</span>
    </div>
    {loadFailure && <div className="outline-knowledge-error">{loadFailure.message}<button className="remote-knowledge-action" type="button" onClick={() => {
      const failure = loadFailure;
      setLoadFailure(null);
      void retryRemoteKnowledgeLoad(failure, { loadBases, loadDocuments });
    }}>重试</button></div>}
    {loading && <div className="outline-knowledge-empty compact">正在读取远程知识库...</div>}
    {!loading && !loadFailure && !bases.length && <div className="outline-knowledge-empty compact">暂无可用远程知识库</div>}
    {!!bases.length && <div className="remote-knowledge-base-list">
      {bases.map((base) => {
        const current = scopes.find((scope) => scope.knowledgeBaseId === base.id);
        const docs = documents[base.id];
        const stale = current && isRemoteScopeStale(current, endpointFingerprint);
        return <section className="remote-knowledge-base" key={base.id}>
          <div className="remote-knowledge-base-head">
            <div className="remote-knowledge-base-title">
              <strong title={base.name}>{base.name}</strong>
              {current?.mode === 'all' && <span className="remote-knowledge-selection-state">已选整个库</span>}
              {current?.mode === 'documents' && <span className="remote-knowledge-selection-state">已选 {current.documents.length} 个文档</span>}
            </div>
            <div className="remote-knowledge-base-actions">
              <button className={`remote-knowledge-action${current?.mode === 'all' ? ' is-selected' : ''}`} type="button" disabled={disabled} onClick={() => onChange(selectWholeKnowledgeBase(scopes, base, endpointFingerprint))}>{current?.mode === 'all' ? '已选整个知识库' : '选择整个知识库'}</button>
              <button className="remote-knowledge-action" type="button" disabled={disabled} onClick={() => {
                if (current?.mode === 'all') onChange(beginRemoteDocumentSelection(scopes, base.id));
                void loadDocuments(base.id, 1);
              }}>{current?.mode === 'all' ? '改选文档' : '查看文档'}</button>
            </div>
          </div>
          {stale && <small className="outline-knowledge-stale">连接配置已变化，请重新选择</small>}
          {docs && <div className="remote-knowledge-documents">
            <div className="outline-knowledge-document-list compact">
              {docs.items.map((doc) => {
                const documentSelected = current?.mode === 'documents' && current.documents.some((item) => item.knowledgeId === doc.id);
                const documentDisabled = isRemoteDocumentSelectionDisabled(current, disabled);
                return <label className={`outline-knowledge-document compact remote-knowledge-document${documentSelected ? ' is-selected' : ''}${documentDisabled ? ' is-disabled' : ''}`} key={doc.id}>
                  <input type="checkbox" disabled={documentDisabled} checked={documentSelected} onChange={() => {
                    const selected = current?.mode === 'documents' ? current.documents : [];
                    const next = documentSelected ? selected.filter((item) => item.knowledgeId !== doc.id) : [...selected, { knowledgeId: doc.id, title: doc.title }];
                    onChange(selectRemoteDocuments(scopes, base, next, endpointFingerprint));
                  }} />
                  <span><strong title={doc.title}>{doc.title}</strong></span>
                </label>;
              })}
            </div>
            <div className="remote-knowledge-pagination">
              <button className="remote-knowledge-action" type="button" disabled={docs.page <= 1} onClick={() => void loadDocuments(base.id, docs.page - 1)}>上一页</button>
              <span>{docs.page}/{Math.max(1, Math.ceil(docs.total / docs.pageSize))}</span>
              <button className="remote-knowledge-action" type="button" disabled={docs.page * docs.pageSize >= docs.total} onClick={() => void loadDocuments(base.id, docs.page + 1)}>下一页</button>
            </div>
          </div>}
        </section>;
      })}
    </div>}
  </div>;
}
