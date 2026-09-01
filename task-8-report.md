# Task 8 实现报告

## 完成内容

- 目录生成 V2 在非 `original-only` 模式下基于本地项目概述、响应要求、技术评分信息和目录目标构造检索词，通过知识会话执行一次 `outline` 远程检索。
- 远程片段以脱敏的 `远程知识参考.md` 注入 Agent 工作区，并明确标记为不可信参考材料；`original-only` 完全跳过远程检索和文件注入。
- 全局事实生成 V2 先从项目概述、招标解析结果和已确认目录提取最多 8 个检索主题，再按本地知识条目剩余配额执行 `global-facts` 远程检索。远程材料只能补充本地权威材料已证明存在的事实大项。
- 远程检索继续使用知识会话的失败决策闸门；`disable-and-continue` 时保留本地知识条目加载。

## 验证

- `node --test`：相关服务测试共 31 项通过。
- `node --check electron/services/outlineGenerationTaskV2.cjs`：通过。
- `node --check electron/services/globalFactsTaskV2.cjs`：通过。
- `npm run build`：通过；仅有既有 chunk 体积警告。

## Concerns

- 任务 8 未额外修改 `taskService.cjs`，因为当前工作树中 Task 7 已完成知识会话创建和 runner 传递链路。
- `taskService.remoteKnowledge.test.cjs` 存在其他任务产生的未提交改动，本报告对应提交不包含该文件。

## Review Fix

- 修正全局事实材料目录：本地知识库条目与远程参考文件分别统计，远程文件显式列为 `远程知识参考.md`，不再虚构本地条目路径。
- 在全局事实归一化后增加本地材料标题词 allowlist；仅使用有意义的完整短语/三字片段匹配，避免通用二字词误放行。远程检索存在时，无法由招标文件、项目概述、解析结果、目录、本地知识或原方案证明的 remote-only 大项会被过滤，若全部无法证明则拒绝保存。
- 新增真实任务 runner 覆盖：`original-only` 不调用/注入远程知识；普通目录任务验证 `outline` 阶段 query 与 8 条预算；全局事实验证 `global-facts` 阶段、按本地条目扣减预算，以及远程 zero-hit 时保留本地材料。

### Fix Verification

- `node --test electron/services/*remoteKnowledge.test.cjs`：9 项通过。
- `node --test electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs electron/services/outlineGenerationTaskV2.test.cjs`：13 项通过。
- `node --check electron/services/globalFactsTaskV2.cjs`、`node --check electron/services/outlineGenerationTaskV2.cjs`：通过。
- `npm run build`：通过；仅有既有 chunk 体积警告。
