import type { ReactNode } from 'react';
import { AgentQuestionDialogProvider, AiHttpErrorDialogProvider, DocumentParseNoticeProvider, RemoteKnowledgeDecisionDialogProvider, ToastProvider } from '../../shared/ui';

interface AppProvidersProps {
  children: ReactNode;
}

function AppProviders({ children }: AppProvidersProps) {
  return (
    <ToastProvider>
      <AgentQuestionDialogProvider>
        <AiHttpErrorDialogProvider>
          <DocumentParseNoticeProvider>
            <RemoteKnowledgeDecisionDialogProvider>{children}</RemoteKnowledgeDecisionDialogProvider>
          </DocumentParseNoticeProvider>
        </AiHttpErrorDialogProvider>
      </AgentQuestionDialogProvider>
    </ToastProvider>
  );
}

export default AppProviders;
