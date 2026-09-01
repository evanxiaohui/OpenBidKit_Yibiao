import { useEffect, useMemo, useState } from 'react';
import type { RemoteKnowledgeBase, RemoteKnowledgeDocumentPage } from '../../../shared/types/ipc';
import type { RemoteKnowledgeScope } from '../types';
import { isRemoteScopeStale, selectRemoteDocuments, selectWholeKnowledgeBase } from '../remoteKnowledgeSelection';

interface Props {
  scopes: RemoteKnowledgeScope[];
  disabled?: boolean;
  onChange: (scopes: RemoteKnowledgeScope[]) => void;
}

export default function RemoteKnowledgePicker({ scopes, disabled = false, onChange }: Props) {
  const [bases, setBases] = useState<RemoteKnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<Record<string, RemoteKnowledgeDocumentPage>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [endpointFingerprint, setEndpointFingerprint] = useState('');
  const [page, setPage] = useState<Record<string, number>>({});

  const loadBases = async () => {
    setLoading(true); setError('');
    try {
      const config = await window.yibiao?.config.getRemoteKnowledgeDefault();
      const fingerprint = config?.base_url || '';
      setEndpointFingerprint(fingerprint);
      setBases(await window.yibiao?.remoteKnowledge.listKnowledgeBases() || []);
    } catch (e) { setError(e instanceof Error ? e.message : '读取远程知识库失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadBases(); }, []);

  const loadDocuments = async (baseId: string, nextPage = 1) => {
    try {
      const result = await window.yibiao?.remoteKnowledge.listDocuments({ knowledgeBaseId: baseId, page: nextPage, pageSize: 20 });
      if (result) { setDocuments((prev) => ({ ...prev, [baseId]: result })); setPage((prev) => ({ ...prev, [baseId]: nextPage })); }
    } catch (e) { setError(e instanceof Error ? e.message : '读取远程文档失败'); setRetry(() => () => void loadDocuments(baseId, nextPage)); }
  };
  const selectedIds = useMemo(() => new Set(scopes.flatMap((scope) => scope.documents.map((doc) => doc.knowledgeId))), [scopes]);
  return <div className="remote-knowledge-picker">
    {error && <div className="outline-knowledge-error">{error}<button type="button" onClick={() => { const action = retry || (() => void loadBases()); setError(''); action(); }}>重试</button></div>}
    {loading && <div className="outline-knowledge-empty">正在读取远程知识库...</div>}
    {!loading && !error && !bases.length && <div className="outline-knowledge-empty">暂无可用远程知识库</div>}
    {bases.map((base) => {
      const current = scopes.find((scope) => scope.knowledgeBaseId === base.id);
      const docs = documents[base.id];
      const stale = current && isRemoteScopeStale(current, endpointFingerprint);
      return <section className="remote-knowledge-base" key={base.id}>
        <div className="remote-knowledge-base-head"><strong>{base.name}</strong><div>
          <button type="button" disabled={disabled} onClick={() => onChange(selectWholeKnowledgeBase(scopes, base, endpointFingerprint))}>{current?.mode === 'all' ? '已选整个知识库' : '选择整个知识库'}</button>
          <button type="button" disabled={disabled} onClick={() => void loadDocuments(base.id, 1)}>查看文档</button>
        </div></div>
        {stale && <small className="outline-knowledge-stale">连接配置已变化，请重新选择</small>}
        {docs && <div className="remote-knowledge-documents">{docs.items.map((doc) => <label key={doc.id}>
          <input type="checkbox" disabled={disabled} checked={current?.mode === 'documents' && current.documents.some((item) => item.knowledgeId === doc.id)} onChange={() => {
            const selected = current?.mode === 'documents' ? current.documents : [];
            const next = selectedIds.has(doc.id) ? selected.filter((item) => item.knowledgeId !== doc.id) : [...selected, { knowledgeId: doc.id, title: doc.title }];
            onChange(selectRemoteDocuments(scopes, base, next, endpointFingerprint));
          }} />{doc.title}
        </label>)}<div><button type="button" disabled={docs.page <= 1} onClick={() => void loadDocuments(base.id, docs.page - 1)}>上一页</button><span>{docs.page}/{Math.max(1, Math.ceil(docs.total / docs.pageSize))}</span><button type="button" disabled={docs.page * docs.pageSize >= docs.total} onClick={() => void loadDocuments(base.id, docs.page + 1)}>下一页</button></div></div>}
      </section>;
    })}
  </div>;
}
