# Task 4: Expose metadata IPC and build the settings tab

Implement the plan's Task 4 only. Create `client/electron/ipc/remoteKnowledgeIpc.cjs` and its contract test. Modify `client/electron/ipc/index.cjs`, `client/electron/ipc/configIpc.cjs`, `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts`, `client/src/features/settings/pages/SettingsPage.tsx`, and `client/src/styles/feature-settings.css`.

Required behavior:
- Register exactly `remote-knowledge:list-documents`, `remote-knowledge:list-knowledge-bases`, and `remote-knowledge:test-connection`; delegate to the shared remote knowledge service. Do not expose a generic request method.
- Instantiate one remote knowledge service beside configStore in `registerIpcHandlers`, register metadata IPC at the correct lifecycle boundary, and pass the same instance into workspace services/taskService as needed by existing architecture.
- Add `config:get-remote-knowledge-default`, returning only `{ base_url, api_key }` from configStore's packaged default.
- Expose preload `remoteKnowledge.testConnection(config)`, `.listKnowledgeBases()`, and `.listDocuments(input)` methods; sync shared IPC types.
- Add SettingsTab `remote-knowledge`, URL and password inputs, and actions: `测试连接` validates draft at input boundary without saving; `保存配置` uses full config save; `恢复默认` loads config default and uses existing AppDialog confirmation before saving. Include exactly this explanatory copy: `当前接入协议为 WeKnora v0.7.2 或以上版本。API Key 的知识库权限由远程服务管理端控制。`
- Never put the API key in Toast/log/error detail. Preserve unrelated user modifications and existing style conventions.

Verification: `cd client; node --test electron/ipc/remoteKnowledgeIpc.test.cjs; node --check electron/ipc/remoteKnowledgeIpc.cjs; node --check electron/ipc/index.cjs; node --check electron/ipc/configIpc.cjs; node --check electron/preload.cjs; npm run build`.

Write a full report to `.superpowers/sdd/2026-09-01-remote-knowledge-integration/task-4-report.md` including files changed, tests/outputs, self-review, and concerns. Commit only the task files listed above (do not stage pre-existing user changes or `.superpowers/`). Do not spawn subagents.
