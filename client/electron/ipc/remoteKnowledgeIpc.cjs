function registerRemoteKnowledgeIpc({ ipcMain, remoteKnowledgeService }) {
  ipcMain.handle('remote-knowledge:test-connection', (_event, config) => remoteKnowledgeService.testConnection(config));
  ipcMain.handle('remote-knowledge:list-knowledge-bases', () => remoteKnowledgeService.listKnowledgeBases());
  ipcMain.handle('remote-knowledge:list-documents', (_event, input) => remoteKnowledgeService.listDocuments(input));
}

module.exports = {
  registerRemoteKnowledgeIpc,
};
