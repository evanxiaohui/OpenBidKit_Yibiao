# 多查询检索最终审查修复报告

## 修复范围

本次修复仅涉及 `client/electron/services/` 下的 Main-process 服务及聚焦测试，工作树为 `codex/full-remote-knowledge-query`。

## Findings 与实现

1. **会话层破坏 RRF/coverage 顺序**：`knowledgeReferenceService.searchRemote()` 仍执行按原始 score 排序，已改为仅按首次出现顺序防御性去重并限制数量；重复条目仍保留较高 score 的内容，但不改变首条位置。新增低分首项/高分后项回归测试。
2. **查询与范围并发预算不独立**：`remoteKnowledgeService.searchMany()` 改用搜索组调度器，最多同时运行两个不同 query，HTTP 总并发保持不超过三个；多范围测试继续验证三路 HTTP 并发，三查询测试验证 query 去重并发上限。
3. **首个 HTTP 错误后仍继续派发**：多查询组创建内部 AbortController，并与调用方 signal 联动。首错立即记录原始错误、取消组内在途请求，队列不再派发；会话层收到错误后仍走原有重试/决策流程，停用远程后不会产生后续请求。
4. **规划器降级复制原文**：新增材料主题提取，优先从项目/业务主题生成阶段化短问题，再补充分类主题；AI 规划结果超过短查询约束或呈长段落特征时直接丢弃并走 fallback，不截断原文。新增项目主题、阶段化 fallback 和原文拒绝测试。
5. **无远程范围仍规划/检索**：目录、全局事实、正文编排入口均在存在已选 `remoteScopes` 时才调用规划器和远程搜索；会话层也在空范围直接返回空结果。保留 `original-only` 的更严格目录跳过规则，并新增空范围会话回归测试。

## RED/GREEN 证据

按 TDD 先加入回归测试并执行：

- `knowledgeReferenceService.test.cjs`：新增顺序测试初始失败，实际结果为高分后项被提前。
- `remoteKnowledgeService.test.cjs`：三查询测试初始失败，观察到三个不同 query 同时活动；首错取消测试初始实现会继续触发队列。
- `remoteKnowledgeQueryPlanner.test.cjs`：项目主题长度与长段落拒绝测试初始失败，planner 返回 `source: ai` 且使用原始段落。
- 空范围会话测试初始失败，空 `remoteScopes` 仍调用 `searchMany`。

修复后同一聚焦命令 GREEN：六文件共 **60 tests, 60 pass, 0 fail, 0 cancelled, 0 skipped**。

## 最终验证

- 六个 CommonJS 文件 `node --check`：全部通过。
- 精确六文件测试套件：60/60 通过。
- `npm run build`：退出码 0；Vite 仅报告既有 chunk size warning。
- `git diff --check`：通过。
- 提交前 `git status --short`：仅列出本次九个服务/测试文件修改及本报告。

## 修改文件

- `client/electron/services/remoteKnowledgeService.cjs`
- `client/electron/services/remoteKnowledgeService.test.cjs`
- `client/electron/services/knowledgeReferenceService.cjs`
- `client/electron/services/knowledgeReferenceService.test.cjs`
- `client/electron/services/remoteKnowledgeQueryPlanner.cjs`
- `client/electron/services/remoteKnowledgeQueryPlanner.test.cjs`
- `client/electron/services/outlineGenerationTaskV2.cjs`
- `client/electron/services/globalFactsTaskV2.cjs`
- `client/electron/services/contentGenerationTask.cjs`

## 自审

- WeKnora 请求体仍只使用既有 `query`、`knowledge_base_ids` 和可选 `knowledge_ids`，未加入 `query_text`、`match_count` 或客户端模型依赖。
- RRF、查询覆盖、去重、单 query 兼容包装器、endpoint fingerprint、本地优先预算、暂停/恢复和小节快照路径未改动。
- 远程组首错保留原始错误；调用方取消仍通过传入 signal 触发取消错误。
- 日志与请求中未新增完整 query、项目正文、远程片段、密钥或本地路径输出。
- Recall@8、评分要求覆盖率、无关结果比例和 A/B/C 延迟对比仍需真实 WeKnora 数据集做外部验收，单元测试不替代这些指标。
