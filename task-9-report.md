# Task 9 报告

## 实现

- 正文 `content-planning` 阶段按章节标题、目标、项目概述、已确认事实和招标要求执行远程检索。
- 远程结果以 `remote:<knowledgeBaseId>:<knowledgeId>:<chunkId>` 命名空间加入编排轻量条目；仅将模型选中的片段写入 `remoteKnowledgeReferencesBySection` runtime 快照。
- 暂停/恢复和历史编排复用 runtime 快照，正文生成阶段只解析已锁定片段，不重复远程检索。
- 远程检索失败由知识引用 Session 的决策机制处理；禁用后当前任务继续使用本地材料，无引用时仍可生成正文。
- 正文提示补充招标要求、用户确认事实和原方案优先，以及禁止输出内部来源标识的约束。

## 验证

- `node --test electron/services/contentGenerationTask.remoteKnowledge.test.cjs`：4 项通过。
- `node --check electron/services/contentGenerationTask.cjs`：通过。
- `npm run build`：通过；仅有既有 Vite chunk 体积警告。
