function registerRemoteKnowledgeIpc({ ipcMain, remoteKnowledgeService, remoteKnowledgeDecisionService }) {
  ipcMain.handle('remote-knowledge:test-connection', (_event, config) => remoteKnowledgeService.testConnection(config));
  ipcMain.handle('remote-knowledge:get-endpoint-fingerprint', () => remoteKnowledgeService.getEndpointFingerprint());
  ipcMain.handle('remote-knowledge:list-knowledge-bases', () => remoteKnowledgeService.listKnowledgeBases());
  ipcMain.handle('remote-knowledge:list-documents', (_event, input) => remoteKnowledgeService.listDocuments(input));
  if (!remoteKnowledgeDecisionService) return;
  ipcMain.handle('remote-knowledge:get-pending-decision', () => remoteKnowledgeDecisionService?.getPendingDecision?.() || null);
  ipcMain.handle('remote-knowledge:resolve-decision', (_event, input) => remoteKnowledgeDecisionService?.resolveDecision?.(input));
  const subscriptions = new Map();
  ipcMain.on('remote-knowledge:subscribe-decisions', (event) => {
    subscriptions.get(event.sender)?.();
    const unsubscribe = remoteKnowledgeDecisionService?.onDecision?.((decision) => {
      if (!event.sender.isDestroyed()) event.sender.send('remote-knowledge:decision', decision);
    });
    subscriptions.set(event.sender, unsubscribe);
    event.sender.once('destroyed', () => {
      unsubscribe?.();
      subscriptions.delete(event.sender);
    });
  });
  ipcMain.handle('remote-knowledge:unsubscribe-decisions', (event) => {
    subscriptions.get(event.sender)?.();
    subscriptions.delete(event.sender);
  });
}

module.exports = {
  registerRemoteKnowledgeIpc,
};
