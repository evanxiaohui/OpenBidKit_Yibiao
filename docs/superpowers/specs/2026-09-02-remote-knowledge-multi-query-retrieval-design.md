# 远程知识多查询检索设计

## 1. 文档状态

- 日期：2026-09-02
- 状态：用户已确认，待按实施计划开发
- 适用范围：`client/` 技术方案目录、全局事实和正文编排阶段
- 远程协议：沿用现有 WeKnora v0.7.2+ `POST /knowledge-search`

## 2. 背景与结论

当前客户端把一个阶段的项目概述、招标要求、评分信息或章节上下文拼成单个 `query`，再调用一次远程检索。旧实现截取前 1800 个字符，修复分支中的过渡实现取消了截取并发送完整长文本。

这两个实现都不是终态：前缀截取会确定性丢失后文；完整长文本会把多个检索意图压缩进一个 embedding，并可能在具体 embedding provider 内再次被截断。WeKnora 的直接检索接口不会替客户端拆解 query，因此客户端改为阶段感知的多查询检索。

## 3. 目标与非目标

### 3.1 目标

1. 每次检索都基于完整阶段上下文规划 1 至 5 个短、单意图语义 query。
2. 每个 query 独立调用现有远程检索协议，保留 WeKnora 的混合检索与单 query 重排能力。
3. 客户端对多 query 结果做去重、RRF 排名融合和最低查询覆盖保留。
4. 目录、全局事实和正文编排使用各自的 query 规划规则。
5. query 规划失败时使用确定性阶段模板降级，不回退到完整长文本或固定前缀截取。
6. 保持现有远程范围、失败决策、任务恢复和正文引用快照语义。

### 3.2 非目标

1. 不修改 WeKnora 服务端、embedding 模型、rerank 模型或租户检索阈值。
2. 不新增用户可配置的 query 数量、RRF 常量或检索并发设置。
3. 不把完整 query、项目正文或远程片段写入普通日志和 Analytics。
4. 不在首版增加第二次 LLM 重排；跨 query 排名使用确定性算法。
5. 不改变本地知识条目优先占用引用预算的现有规则。
6. 客户端不部署 embedding 或 rerank 模型；单 query 重排由 WeKnora 服务端负责，客户端只执行确定性跨 query 融合。

## 4. 总体数据流

```text
完整阶段上下文
      |
      v
remoteKnowledgeQueryPlanner
  AI 规划 1~5 个短语义 query
  失败时使用阶段模板降级
      |
      v
knowledgeReferenceService.searchRemote({ queries })
      |
      v
remoteKnowledgeService.searchMany()
  每个 query 独立执行 /knowledge-search
      |
      v
按 chunk 去重 + RRF 融合 + 查询覆盖保留
      |
      v
最终 8 个远程参考片段
      |
      v
目录 / 全局事实 / 当前正文小节 Agent
```

完整项目材料仍是生成阶段的事实与约束来源；短 query 只负责寻找可能相关的远程知识，远程结果不得覆盖招标文件、项目概述和用户确认事实。

## 5. Query 规划器

新增 Main 侧 `remoteKnowledgeQueryPlanner.cjs`，只承担“完整上下文到短 query 列表”的转换，不发起远程请求。

### 5.1 接口

```js
async function planRemoteKnowledgeQueries({
  aiService,
  stage,
  context,
  signal,
})
```

返回值：

```js
{
  queries: ['语义问题一', '语义问题二'],
  source: 'ai' // 或 fallback
}
```

### 5.2 通用规则

1. 输入使用当前阶段已有的完整本地材料，不先按字符截取。
2. 输出必须为 1 至 5 个去重后的非空字符串。
3. 每个 query 只表达一个检索意图，采用完整问题或概念陈述，不使用关键词堆砌。
4. AI Prompt 要求单条 query 不超过 160 个中文字符；规范化结果超过 240 个字符视为无效，不进行二次字符截断。
5. 过滤空白、重复 query 和包含大段原文特征的无效结果。
6. AI 调用失败、JSON 不合法或全部 query 无效时，使用对应阶段的确定性模板。
7. 规划失败不进入远程知识失败决策；只有实际 WeKnora 调用失败才进入现有“重试/停用远程并继续”流程。

### 5.3 AI 输出格式

```json
{
  "queries": [
    "该类项目通常包含哪些实施阶段和成果交付要求？",
    "该类项目如何组织质量控制、进度管理和验收？"
  ]
}
```

Query 规划 Prompt 必须明确：完整项目材料只用于识别检索意图，不得在 query 中复制完整段落，不得编造项目事实。

## 6. 分阶段规划规则

### 6.1 目录生成

输入：完整项目概述、响应文件要求、技术评分信息和目录生成目标。

目标生成 3 至 5 个 query，覆盖：

1. 项目所属业务领域的标准实施流程与专业章节；
2. 交付成果、验收和服务边界；
3. 技术评分要求涉及的关键技术响应主题；
4. 项目组织、进度、质量和风险等管理主题；
5. 材料中确有依据的专项技术主题。

确定性降级模板使用项目名称或业务主题、评分大项标题和目录目标构造最多 4 个短 query；无法提取项目主题时使用“该类项目”的中性表述，不复制完整项目概述。

`original-only` 模式继续不在目录阶段检索远程知识。

### 6.2 全局事实

输入：完整项目概述、招标解析结果和技术方案目录。

目标生成 3 至 5 个 query，覆盖：

1. 服务范围、地点和对象的行业解释口径；
2. 规模、进度、阶段和期限相关的实施口径；
3. 成果物、质量和验收相关的行业知识；
4. 组织人员、设备和保障措施；
5. 目录中反复出现的专项技术主题。

远程知识仍只能补充本地事实分组，不得创建本地材料没有依据的新项目事实。确定性降级时从现有 `buildGlobalFactsRetrievalTopics()` 扫描全部候选主题，按上述类别选取最多 5 个，而不是连接全部主题形成一个 query。

### 6.3 正文编排

输入：当前叶子章节标题、目标、章节要求，以及完整项目事实材料。

每个叶子章节目标生成 2 至 4 个 query，覆盖：

1. 当前章节对应的专业实施方法；
2. 当前章节对应的质量、验收或风险控制；
3. 与章节直接相关的项目约束；
4. 章节确有需要时的成果模板或行业最佳实践。

query 必须以当前章节为中心，禁止把完整项目概述、全部评分项和全部全局事实复制进每条 query。确定性降级模板使用章节标题、章节目标和相关要求生成最多 3 条短 query。

正文编排选中的远程片段继续写入 `remoteKnowledgeReferencesBySection`。暂停、恢复和小节重试继续使用同一片段快照，不重复检索。

## 7. 多查询检索与融合

### 7.1 服务接口

`knowledgeReferenceService` 的任务会话扩展为：

```js
session.searchRemote({
  stage,
  queries,
  matchCount: 8,
})
```

为保持现有调用兼容，单个 `query` 仍可传入，并在内部规范化为单元素 `queries`。新业务调用统一传 `queries`。

`remoteKnowledgeService` 新增 `searchMany({ queries, scopes, matchCount, signal })`；现有 `search()` 委托给 `searchMany()` 的单 query 路径。

### 7.2 请求预算与并发

1. 每个 query 对同一远程范围独立执行现有搜索。
2. `/knowledge-search` 不提供客户端 `match_count` 参数；每个 query 独立接收服务端返回结果，并在客户端保留前 8 个候选后再融合，不能让最终 8 条预算提前限制某个 query 的召回。
3. 多 query 搜索并发上限为 2；范围分组仍沿用现有并发控制，但同一 `searchMany()` 的实际 HTTP 请求总并发不得超过 3。
4. 正文编排继续服从现有正文任务并发，不额外创建无限制 Promise。
5. 任一实际远程请求失败时，整组多 query 检索进入现有任务级失败决策；重试只重放该次尚未成功完成的检索组。

### 7.3 去重与排名融合

唯一键沿用：

```text
knowledgeBaseId:knowledgeId:chunkId
```

对每个 query 的结果先按 score 降序并去重，再计算 RRF：

```text
rrfScore(chunk) = sum(1 / (60 + rankInQuery))
```

其中 `rankInQuery` 从 1 开始。相同 chunk 被多个 query 命中时累加 RRF 分数，并记录最佳原始 score 和命中的 query 索引。

最终选择规则：

1. 先按 query 顺序各保留其最高排名且尚未选中的 1 条结果，保证有效 query 的最低覆盖；
2. 再按 RRF 分数、命中 query 数量、最佳原始 score、首次出现顺序依次排序补足；
3. 最终截取 `matchCount`，默认仍为 8；
4. 返回给现有业务层的字段保持不变，融合元数据只在 Main 内部使用。

如果有效 query 数量超过最终预算，按 query 原顺序覆盖，首版不提高现有最终 8 条预算。

## 8. 失败、取消与降级

1. Query 规划 AI 失败：记录阶段、耗时和 `source=fallback`，使用确定性模板继续。
2. 确定性模板也无法产生 query：视为零命中，跳过远程请求，不弹失败决策。
3. WeKnora 返回空结果：按现有零命中语义继续，不视为错误。
4. WeKnora 网络、权限或协议错误：沿用现有自动重试及用户决策。
5. 用户选择“停用远程并继续”：取消该任务尚未执行的 query 请求并返回空远程结果。
6. 任务取消、重置或释放：规划调用和远程请求都服从现有任务 signal，不允许旧结果写回新任务。

## 9. 日志与可观测性

开发日志允许记录：

- 阶段；
- query 数量；
- 规划来源 `ai` 或 `fallback`；
- 每个 query 的稳定哈希和字符数；
- 每个 query 的命中数；
- 去重前后数量；
- 最终引用数量；
- 规划耗时、检索耗时和错误类别。

不得记录完整 query、完整项目材料、远程 chunk 正文、API Key、本地文件名或路径。普通 Analytics 不新增 query 内容或项目内容。

## 10. 代码影响范围

### 10.1 新增

- `client/electron/services/remoteKnowledgeQueryPlanner.cjs`
- `client/electron/services/remoteKnowledgeQueryPlanner.test.cjs`

### 10.2 修改

- `client/electron/services/remoteKnowledgeService.cjs`
- `client/electron/services/remoteKnowledgeService.test.cjs`
- `client/electron/services/knowledgeReferenceService.cjs`
- `client/electron/services/knowledgeReferenceService.test.cjs`
- `client/electron/services/outlineGenerationTaskV2.cjs`
- `client/electron/services/outlineGenerationTaskV2.test.cjs`
- `client/electron/services/globalFactsTaskV2.cjs`
- `client/electron/services/globalFactsTaskV2.remoteKnowledge.test.cjs`
- `client/electron/services/contentGenerationTask.cjs`
- `client/electron/services/contentGenerationTask.remoteKnowledge.test.cjs`

不修改 Renderer、preload、SQLite schema、Analytics、WeKnora 服务端和现有远程知识选择协议。

## 11. 自动验证

### 11.1 Query 规划

1. AI 规划成功时返回 1 至 5 个短、去重 query。
2. 超长、空白、重复或结构非法的 AI 输出触发确定性降级，不进行字符截取。
3. 目录、全局事实和正文编排的降级模板分别覆盖其阶段目标。
4. 降级模板扫描完整输入，能够使用输入后部出现的主题构造 query。
5. 规划 Prompt 不要求 AI 复制项目原文。

### 11.2 检索融合

1. 每个 query 都独立触发检索且携带相同远程范围。
2. 相同 chunk 跨 query 只返回一次。
3. 多 query 命中的 chunk 获得累加 RRF 分数。
4. 每个有效 query 至少贡献一条结果，直至最终预算耗尽。
5. 同分结果使用确定性顺序，重复运行结果一致。
6. 单 query 调用保持现有按 score 排序行为。
7. 空 queries 不发起请求并返回空数组。
8. 取消和远程错误继续进入现有任务控制与失败决策语义。

### 11.3 业务阶段

1. 目录阶段传入 query 数组，不再发送完整拼接文本。
2. 全局事实阶段不再 `join('；')` 形成单 query。
3. 每个正文小节使用自己的 query 数组，引用仍按小节持久化。
4. `original-only`、无远程选择、远程零命中和本地知识优先预算行为保持不变。
5. 删除过渡提交中“query 必须超过 1800 字符”的测试，改为检索意图覆盖和多 query 行为测试。

### 11.4 验证命令

在 `client/` 下执行：

```powershell
node --check electron\services\remoteKnowledgeQueryPlanner.cjs
node --check electron\services\remoteKnowledgeService.cjs
node --check electron\services\knowledgeReferenceService.cjs
node --check electron\services\outlineGenerationTaskV2.cjs
node --check electron\services\globalFactsTaskV2.cjs
node --check electron\services\contentGenerationTask.cjs
node --test electron\services\remoteKnowledgeQueryPlanner.test.cjs electron\services\remoteKnowledgeService.test.cjs electron\services\knowledgeReferenceService.test.cjs electron\services\outlineGenerationTaskV2.test.cjs electron\services\globalFactsTaskV2.remoteKnowledge.test.cjs electron\services\contentGenerationTask.remoteKnowledge.test.cjs
npm run build
```

## 12. 实际效果验收

正式判断检索质量前，用同一批已知项目和知识库对比：

1. A：旧前 1800 字符单 query；
2. B：完整长文本单 query；
3. C：本设计的阶段多 query。

记录 Recall@8、评分要求覆盖率、无关片段比例、重复片段比例、零命中率、平均检索耗时和请求数量。方案 C 的上线门槛是：预期知识片段 Recall@8 和评分要求覆盖率不低于 A、B，且没有不可接受的任务耗时增长。自动测试只能证明流程和融合规则正确，不能替代真实 WeKnora 数据集上的检索质量验收。
