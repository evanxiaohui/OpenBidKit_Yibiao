import type { ReactNode } from 'react';
import { AgentQuestionDialogProvider, AiHttpErrorDialogProvider, DocumentParseNoticeProvider, DonationPromptProvider, RemoteKnowledgeDecisionDialogProvider, ToastProvider } from '../../shared/ui';

interface AppProvidersProps {
  children: ReactNode;
}

function AppProviders({ children }: AppProvidersProps) {
  return (
    <ToastProvider>
      <DonationPromptProvider>
        <AgentQuestionDialogProvider>
          <AiHttpErrorDialogProvider>
            <DocumentParseNoticeProvider><RemoteKnowledgeDecisionDialogProvider>{children}</RemoteKnowledgeDecisionDialogProvider></DocumentParseNoticeProvider>
          </AiHttpErrorDialogProvider>
        </AgentQuestionDialogProvider>
      </DonationPromptProvider>
    </ToastProvider>
  );
}

export default AppProviders;
