# 远程知识集成最终修复报告

日期：2026-09-01
分支：`codex/remote-knowledge-integration`

## 修复结果

- 远程范围使用规范化服务地址的 SHA-256 指纹，不再受 API Key 变化影响。
- Renderer 保存/生成、Main 保存边界和实际远程检索均校验当前端点指纹；过期范围不会写入 Store，也不会把旧资源 ID 发往新端点。
- 正文编排仅接收当前小节的远程候选，生成仅解析当前小节锁定快照，并新增三小节并发回归覆盖。
- 混合范围结果先全局去重、保留重复项最高分、按分数降序，再应用 `matchCount`。
- 共享故障决策的 action-required 状态等待所有相关检索返回后才清除。
- 工作流切换同步清理本地参考、远程文档和远程范围。
- 连接测试同时验证知识库列表和 `/knowledge-search` 必需字段，协议不兼容时返回统一中文错误。
- 整库选择清空并禁用文档勾选；“改选文档”先取消整库范围；已选区域调整为三列。

## 验证记录

工作目录均为 `client/`，除非另有说明。

- `node --test electron/services/remoteKnowledgeConfig.test.cjs scripts/prepare-remote-knowledge-default.test.cjs electron/services/weKnoraClient.test.cjs electron/services/remoteKnowledgeService.test.cjs electron/services/technicalPlanRemoteKnowledgeStore.test.cjs electron/ipc/remoteKnowledgeIpc.test.cjs src/features/technical-plan/remoteKnowledgeSelection.test.ts electron/services/remoteKnowledgeDecisionService.test.cjs electron/services/knowledgeReferenceService.test.cjs electron/services/taskService.remoteKnowledge.test.cjs electron/services/outlineGenerationTaskV2.test.cjs electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs electron/services/contentGenerationTask.remoteKnowledge.test.cjs`
  - 结果：`75 passed, 0 failed`。
- 原 Task 10 的 14 个 `node --check` 文件全部通过；额外检查本轮修改的 `electron/ipc/technicalPlanIpc.cjs`，合计 `15/15` 通过。
- `npm run smoke:electron-native`
  - 结果：通过；Electron `41.10.2`、Node `24.18.0`，`better-sqlite3` 加载并查询成功。
- `npm run build`
  - 结果：退出码 `0`；仅有项目已知的 Vite chunk 体积警告。
- `git diff --check`
  - 结果：通过。
- 排除范围检查
  - `analytics/`、`.github/workflows/release.yml`、知识库页面和可研功能无差异。
- 凭据检查
  - 生产代码新增差异中未发现凭据；仅测试夹具包含显式假 Key 文本。

## 修改文件

- `client/electron/ipc/index.cjs`
- `client/electron/ipc/remoteKnowledgeIpc.cjs`
- `client/electron/ipc/remoteKnowledgeIpc.test.cjs`
- `client/electron/ipc/technicalPlanIpc.cjs`
- `client/electron/preload.cjs`
- `client/electron/services/contentGenerationTask.cjs`
- `client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs`
- `client/electron/services/knowledgeReferenceService.cjs`
- `client/electron/services/knowledgeReferenceService.test.cjs`
- `client/electron/services/remoteKnowledgeService.cjs`
- `client/electron/services/remoteKnowledgeService.test.cjs`
- `client/electron/services/taskService.cjs`
- `client/electron/services/taskService.remoteKnowledge.test.cjs`
- `client/electron/services/technicalPlanRemoteKnowledgeStore.test.cjs`
- `client/electron/services/technicalPlanStore.cjs`
- `client/src/features/technical-plan/components/RemoteKnowledgePicker.tsx`
- `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- `client/src/features/technical-plan/remoteKnowledgeSelection.test.ts`
- `client/src/features/technical-plan/remoteKnowledgeSelection.ts`
- `client/src/shared/types/ipc.ts`
- `client/src/styles/feature-technical-plan.css`

## 剩余关注项

- 本轮审查修复未重复执行真实 WeKnora 服务验收、Windows 100%/125%/150% 缩放 UI 验收或 `npm run dist:win` 打包验收；自动化回归、native smoke 和生产构建已覆盖本次代码修复。
- 构建仍有既有大 chunk 警告，本次未扩大范围处理。
