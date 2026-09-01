# 远程知识接入技术方案与已有方案扩写设计

## 1. 文档状态

- 日期：2026-09-01
- 状态：用户已确认，待按实施计划开发
- 适用范围：`client/` Electron 桌面客户端
- 远程协议基线：WeKnora v0.7.2 及以上

## 2. 背景

当前客户端的文档知识库完全位于本机：用户导入文档后，Main 进程负责解析、AI 条目提取、原文匹配和 SQLite 持久化。技术方案与已有方案扩写共用技术方案工作区，并通过 `referenceKnowledgeDocumentIds` 选择本地知识文档。目录、全局事实、正文规划和正文生成再按阶段读取本地 Markdown 或知识条目。

本次改造要在不破坏本地知识库的前提下，引入一个可修改配置的单一远程知识服务。远程服务首版使用 WeKnora v0.7.2+ 协议，但业务界面和业务数据结构不写死提供方名称。

## 3. 目标与非目标

### 3.1 目标

1. 本地知识与远程知识并存，本地知识库现有功能和数据保持不变。
2. 远程知识仅出现在技术方案与已有方案扩写的知识选择和生成流程中。
3. 用户既可选择整个远程知识库，也可限定选择知识库中的具体文档。
4. 远程选择随当前技术方案工作区持久化，应用重启后可恢复。
5. 目录、全局事实、正文规划和正文生成按当前任务动态检索远程片段。
6. 远程失败时由用户选择重试或本次停用远程知识后继续。
7. 支持本地打包时注入默认远程地址和共享 API Key，并允许安装后修改。

### 3.2 非目标

1. 不在现有文档知识库页面展示远程知识。
2. 不从客户端向远程服务上传、编辑、移动或删除知识库和文档。
3. 不接入可研报告或其他业务流程。
4. 不支持多套远程连接配置。
5. 不实现远程知识的通用离线镜像或长期缓存。
6. 不在客户端管理 API Key 权限、知识库白名单或租户权限；这些由远程服务管理。
7. 不兼容 WeKnora v0.7.0 或 v0.7.1。

## 4. 已确认的产品规则

1. 单一远程服务，存在默认配置，用户可在设置页修改。
2. 默认地址进入 Git；默认共享 Key 不进入 Git，通过本机私有构建配置注入安装包。
3. 业务界面统一称为“远程知识”，不把来源页签、错误文案、SQLite 表名或业务类型写死为 WeKnora。
4. 每个远程知识库的选择模式为“整库”或“指定文档”，两者在同一个知识库内互斥。
5. 选择具体文档只限定动态检索范围，不下载或注入文档全文。
6. 远程知识参与范围与现有本地知识一致：
   - 目录生成；
   - 全局事实；
   - 正文规划；
   - 正文生成。
7. 已有方案扩写的 `original-only` 模式继续保持现有规则：远程知识不改变目录，但仍可参与后续全局事实和正文。
8. 当前招标文件、用户确认信息和原方案的优先级始终高于本地或远程参考知识。
9. 检索成功但零命中不是错误，任务记录日志后继续。
10. 远程调用最终失败后，用户可选择：
    - “重试”：重放本次失败请求；
    - “停用远程并继续”：仅对当前任务尚未完成的部分停用远程知识。
11. “停用远程并继续”不清除持久化选择；下次生成仍重新尝试远程服务。
12. 失败前已完成且已使用远程知识的输出不回滚。如需整份结果完全不使用远程知识，用户需取消远程选择后重新生成。

## 5. 总体架构

```text
技术方案 / 已有方案扩写任务
              |
              v
  knowledgeReferenceService
       |                 |
       v                 v
本地 knowledgeBaseService   remoteKnowledgeService
                                  |
                                  v
                         WeKnora v0.7.2+ REST API
```

### 5.1 `remoteKnowledgeClient`

Main 侧的底层 HTTP 适配器，只负责：

- 规范化服务地址；
- 设置 `X-API-Key`、`Content-Type` 和请求 ID；
- 超时、取消、错误归一化和有限自动重试；
- 解析 WeKnora 的标准成功或错误响应。

客户端使用 Electron 随附 Node 运行时的 `fetch`，不新增 HTTP 依赖。

### 5.2 `remoteKnowledgeService`

将 WeKnora v0.7.2+ 接口转换为通用远程知识模型：

- `testConnection()`：验证连接、凭据、知识库读取和最低检索能力；
- `listKnowledgeBases()`：列出当前 Key 可访问的知识库；
- `listDocuments()`：按知识库分页列出远程文档；
- `search()`：按知识库和可选文档范围执行动态检索。

WeKnora 适配器内部可使用提供方名称，暴露给业务层的类型、错误和方法使用 `RemoteKnowledge*` 命名。

### 5.3 `knowledgeReferenceService`

作为技术方案任务的统一知识入口，职责包括：

- 读取本地选择及本地知识内容；
- 读取远程范围并调用动态检索；
- 输出带来源命名空间的统一引用；
- 对远程结果去重、排序和限制上下文体积；
- 触发远程失败决策；
- 保留任务级引用来源和文档标题，供恢复与诊断使用。

现有知识库页面继续直接使用本地 `knowledgeBaseService`。可研任务也继续使用本地服务，不接入统一远程流程。

### 5.4 `remoteKnowledgeDecisionService`

Main 侧维护当前等待处理的远程失败决策，并通过 IPC 广播到全局 Provider。它不复用 Agent 问答，因为两者的来源、选项和恢复语义不同。

决策请求至少包含：任务 ID、工作流、失败阶段、错误类别、HTTP 状态、请求 ID、可读错误摘要和发生时间。不得包含 API Key、检索正文或召回内容。

## 6. 配置与本地打包

### 6.1 运行时配置

`user_config.json` 增加通用配置：

```json
{
  "remote_knowledge": {
    "base_url": "https://example.invalid/api/v1",
    "api_key": ""
  }
}
```

规则：

1. Git 中的默认配置仅包含默认地址，不包含真实 Key。
2. 用户保存的配置优先于安装包默认值。
3. 软件升级不覆盖用户已经保存的修改。
4. “恢复默认”重新读取安装包内置配置。
5. API Key 使用密码框显示，不进入 Toast、日志、普通埋点或错误详情。

### 6.2 本机私有构建配置

新增默认地址与构建私有目录约定：

```text
client/electron/resources/default-remote-knowledge.json
    # 提交到 Git，保存实际默认 base_url 和空 api_key

client/build-secrets/
├─ default-remote-knowledge.example.json  # 提交到 Git，仅含空 api_key 示例
└─ default-remote-knowledge.json          # 本机实际 api_key，Git 忽略
```

打包前脚本从已提交的资源配置读取非空 `base_url`，从本机私有文件读取非空 `api_key`，合并后生成 Electron Builder 打入安装包的默认配置。生成文件同样被 Git 忽略。默认地址的实际值属于发布配置输入，实施时由用户提供或确认；设计文档不记录真实 API Key。

约束：

- `npm run build` 不要求私有配置存在；
- `npm run dist:win`、`npm run dist:mac` 等正式打包命令缺少私有配置时直接失败；
- 安装包内的共享 Key 可被提取，不能视为秘密；其权限、白名单、轮换和吊销由 WeKnora 管理端负责。

## 7. 业务类型与持久化

### 7.1 通用业务类型

```ts
type RemoteKnowledgeScopeMode = 'all' | 'documents';

interface RemoteKnowledgeScope {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  mode: RemoteKnowledgeScopeMode;
  documents: Array<{
    knowledgeId: string;
    title: string;
  }>;
  endpointFingerprint: string;
}
```

`endpointFingerprint` 只根据规范化后的服务地址计算，不包含 API Key。用户只更换 Key 时选择仍有效；用户更换服务地址后，旧选择标记为来源已变化并要求重新选择，禁止把旧 ID 静默用于新服务。

### 7.2 SQLite 表

新增两张表：

```sql
technical_plan_remote_knowledge_scopes
- knowledge_base_id TEXT PRIMARY KEY
- knowledge_base_name TEXT NOT NULL
- scope_mode TEXT NOT NULL            -- all | documents
- endpoint_fingerprint TEXT NOT NULL
- sort_order INTEGER NOT NULL

technical_plan_remote_knowledge_documents
- knowledge_base_id TEXT NOT NULL
- knowledge_id TEXT NOT NULL
- knowledge_title TEXT NOT NULL
- sort_order INTEGER NOT NULL
- PRIMARY KEY (knowledge_base_id, knowledge_id)
- FOREIGN KEY (knowledge_base_id)
  REFERENCES technical_plan_remote_knowledge_scopes(knowledge_base_id)
  ON DELETE CASCADE
```

名称是界面回显快照，检索权威标识仍是远程 ID。运行时 migration 以 `sqliteDatabase.cjs` 为准，并同步 `sql/workspace_schema.sql`。

### 7.3 保存与清理

1. `saveOutlineConfig()` 在同一事务中保存本地文档 ID 和远程范围。
2. 同一知识库选择整库时删除其文档行；选择指定文档时保存 `documents` 模式和文档行。
3. 技术方案工作区重置、删除或切换到需要清理工作流状态的操作，同步清理远程范围。
4. 远程选择与本地选择一样属于目录生成配置；运行中的正文任务继续遵守现有配置锁定规则。

## 8. IPC 与进程边界

Renderer 只获得资源元数据，不获得默认配置文件路径或 Main 的原始网络能力。

新增 preload 命名空间建议：

```ts
remoteKnowledge: {
  testConnection(): Promise<RemoteKnowledgeConnectionTestResult>;
  listKnowledgeBases(): Promise<RemoteKnowledgeBase[]>;
  listDocuments(input): Promise<RemoteKnowledgeDocumentPage>;
  getPendingDecision(): Promise<RemoteKnowledgeDecision | null>;
  resolveDecision(input): Promise<void>;
  onDecision(callback): () => void;
}
```

远程检索正文不通过 Renderer。技术方案任务在 Main 内调用 `knowledgeReferenceService`。

`onDecision()` 必须返回取消订阅函数。Provider 首次挂载时先读取 pending 状态，再订阅事件；任务活动状态回放继续遵循现有 Store 快照、事件订阅和活动任务回放顺序。

## 9. 选择器交互

远程知识只出现在技术方案和已有方案扩写共用的目录生成配置弹窗。

### 9.1 来源页签

- “本地知识”：保留当前文件夹、文档、搜索和已选逻辑；
- “远程知识”：列出远程知识库，可展开分页加载文档；
- “本次已选”：统一展示本地文档、远程整库和远程文档，并用“本地”或“远程”标识来源。

界面不显示“WeKnora”来源页签。设置页可在说明文字中注明当前协议为 WeKnora v0.7.2+。

### 9.2 远程选择规则

1. 用户可对知识库选择“整库”。
2. 用户展开知识库后可选择具体文档。
3. 同一知识库选择整库后，清空并禁用该库的具体文档选择。
4. 从整库切换到指定文档时，先取消整库，再允许勾选文档。
5. 搜索和翻页不改变已选择内容。
6. 可同时整库选择 A，并在 B 中选择若干文档。
7. 远程列表不可用时，本地页签仍正常工作。
8. 服务地址发生变化后，旧选择保留名称回显但标记失效；用户重新选择后才更新为新来源。

## 10. 动态检索数据流

### 10.1 任务启动

1. 从技术方案 Store 读取本地文档 ID 和远程范围快照。
2. 没有远程选择时，不发起远程请求，现有本地链路保持不变。
3. 存在远程选择时，校验 endpoint fingerprint、连接、权限及所选资源可访问性。
4. 确定性失败直接进入用户决策；临时失败完成自动重试后再进入用户决策。

### 10.2 阶段检索

#### 目录生成

根据项目概况、技术评分点、招标要求和当前目录目标构造检索词。远程返回片段作为参考资料文件加入任务工作区。`original-only` 不在目录阶段检索或注入远程知识。

#### 全局事实

根据已有事实主题分别检索。远程知识只补充已有主题，不得创建新的事实大项。

#### 正文规划

按正文小节目标检索候选片段。统一引用 ID 使用来源命名空间，避免本地条目 ID 和远程 chunk ID 冲突：

```text
local:<documentId>:<itemId>
remote:<knowledgeBaseId>:<knowledgeId>:<chunkId>
```

#### 正文生成

使用正文规划阶段为当前小节锁定的远程片段快照。快照属于当前任务运行状态和引用溯源，不是可供其他任务离线复用的通用缓存。

### 10.3 检索参数与预算

1. 使用 `POST /api/v1/knowledge-search`。
2. 整库范围传 `knowledge_base_ids`；指定文档范围同时传 `knowledge_base_ids` 和 `knowledge_ids`。
3. 每次查询默认 `match_count` 为 8，不在首版提供用户配置。
4. 不在客户端覆盖远程服务的向量或关键词阈值，使用服务端配置。
5. 同一阶段按 chunk ID 去重，优先保留较高 score 的结果。
6. 本地和远程材料分别保留来源，再共同受当前模型上下文预算约束；固定系统消息、招标文件和用户确认内容先占预算，知识材料使用剩余预算。
7. 最终生成 Prompt 明确要求结合当前项目改写，不得把参考知识当成高于招标文件的事实，也不得在正文中暴露内部来源 ID。

## 11. 远程失败与用户决策

### 11.1 自动重试

- 网络中断、超时、HTTP 429 和 5xx：最多自动重试 2 次，使用有上限的退避；
- HTTP 401、403、404、响应结构不兼容：不自动重试；
- 自动重试耗尽后进入等待用户决策。

### 11.2 全局决策弹窗

弹窗标题使用“远程知识调用失败”，展示失败阶段、可读摘要和建议操作。

决策按钮：

- 主按钮“重试”；
- 次按钮“停用远程并继续”。

辅助文字入口：

- “检查设置”：任务保持等待，允许用户修改远程知识配置；
- “错误详情”：展示 HTTP 状态、请求 ID、发生时间和脱敏错误摘要。

不提供“结束任务”按钮。关闭弹窗不解决决策，任务继续等待；任务状态区域提供“处理远程知识异常”入口重新打开。

### 11.3 运行语义

1. “重试”只重放失败的远程请求。
2. “停用远程并继续”设置当前任务的瞬时 `remoteDisabledForRun` 状态。
3. 有本地选择时继续使用本地知识；没有本地选择时按无知识引用继续。
4. 已完成的阶段和小节不回滚。
5. 页面切换不取消等待，也不卸载全局 Provider。
6. 任务在等待期间被工作区重置或清理时，必须先解除 pending Promise，禁止旧 runner 后续写入。
7. 应用退出无法保留内存中的失败请求：正文任务按现有规则恢复为 paused；目录或全局事实任务按现有中断规则转为 error，用户重新启动相应阶段。不得自动选择本地降级。
8. 同一任务存在并发检索时，第一次最终失败建立唯一的任务级决策闸门并暂停调度新的远程请求；随后失败或到达闸门的请求共享同一决策，不重复弹窗。“重试”后，各等待请求只重放自己的失败调用；“停用远程并继续”同时释放全部等待请求并切换为本地降级。

### 11.4 弹窗布局

使用 `AppDialog` 和现有按钮类：

- 正常宽度下两个按钮同一行；
- 容器不足时纵向排列且按钮占满宽度；
- 按钮文案 `white-space: nowrap`；
- “检查设置”和“错误详情”不进入主按钮组；
- 验证 Windows 100%、125%、150% 显示缩放。

## 12. API 兼容与错误映射

首版最低要求 WeKnora v0.7.2：

- `GET /api/v1/knowledge-bases`；
- `GET /api/v1/knowledge-bases/:id/knowledge`；
- `POST /api/v1/knowledge-search`；
- `knowledge_base_ids`；
- `knowledge_ids`。

连接测试不只判断 HTTP 200，还要验证列表响应和检索能力所需字段。若服务版本或响应结构不兼容，提示“远程知识服务版本不受支持，请升级到 v0.7.2 或以上”。

错误映射至少区分：

- 地址或网络不可达；
- 请求超时；
- API Key 无效；
- 无知识库或文档读取权限；
- 所选资源已删除或失去访问权限；
- 服务限流；
- 服务端异常；
- 响应版本不兼容。

## 13. 任务恢复与一致性

1. 远程范围在任务启动时形成不可变选择快照，任务运行中修改设置不会静默改变当前任务范围。
2. 用户在“检查设置”中修改地址或 Key 后，点击“重试”时重新读取连接配置，但仍校验任务范围的 endpoint fingerprint。
3. 正文规划采用的远程片段写入现有正文任务 runtime/checkpoint，使暂停和恢复使用相同片段。
4. 对尚未完成的小节，恢复后需要新检索时继续遵守失败决策规则。
5. 远程错误决策和任务取消使用同一任务作用域；任务结束、清理或替换时取消未完成请求并释放 resolver。

## 14. 日志、隐私与埋点

允许记录：

- 远程阶段；
- HTTP 状态；
- 请求 ID；
- 耗时；
- 重试次数；
- 选择的知识库和文档数量；
- 返回片段数量；
- 错误类别。

禁止记录：

- API Key；
- 完整检索词；
- 远程片段正文；
- 招标文件或方案正文；
- 用户本地文件名和路径。

普通 Analytics 不增加检索词、远程内容或 Key。若增加远程知识配置使用统计，只允许记录布尔值或计数，并保持现有统计能力不被删除或弱化。

## 15. 预计影响范围

### 15.1 新增

- Main 远程 HTTP 适配器、远程知识服务、统一知识引用服务、失败决策服务；
- 远程知识 IPC；
- 全局远程失败 Dialog Provider；
- 远程知识通用类型；
- 本机默认配置示例和打包准备脚本；
- 远程服务、范围归一化、引用合并和失败决策定向测试。

### 15.2 修改

- `configStore.cjs` 和设置页；
- `ipc/index.cjs`、preload 和共享 IPC 类型；
- `AppProviders`；
- 技术方案类型、状态 Hook、`TechnicalPlanHome` 和 `OutlineEditPage`；
- `technicalPlanStore.cjs`、`sqliteDatabase.cjs` 和 `sql/workspace_schema.sql`；
- 当前实际启用的目录、全局事实和正文任务；
- 技术方案和共享 Dialog 样式；
- `client/package.json` 的打包前准备链路；
- `.gitignore` 的本机构建私有配置与生成文件规则。

### 15.3 明确不修改

- `KnowledgeBasePage` 及本地知识库 IPC/Store 的业务行为；
- 可研报告知识引用流程；
- Analytics Worker 和 Dashboard 协议；
- 远程 WeKnora 服务端。

## 16. 验证与验收

### 16.1 自动验证

1. 远程地址规范化、endpoint fingerprint 和配置覆盖测试。
2. 知识库列表、文档分页和搜索响应映射测试。
3. 整库、指定文档和混合范围请求体测试。
4. 本地/远程命名空间、去重、排序和上下文预算测试。
5. 429、5xx、超时、401、403、404 和不兼容响应测试。
6. 自动重试次数及失败决策测试。
7. “重试”只重放失败请求测试。
8. “停用远程并继续”只影响当前任务测试。
9. SQLite migration、保存、重启恢复、工作流清理测试。
10. 默认地址与本机私有 Key 合并测试；私有配置缺失时正式打包失败、存在时生成资源测试；测试不输出实际 Key。

### 16.2 命令验证

- 对所有新增或修改的 `.cjs` 执行 `node --check`；
- 执行对应 `node --test <test-file>`；
- `cd client; npm run build`；
- `cd client; npm run smoke:electron-native`；
- 涉及依赖变化时执行 `npm audit`，本方案预期不新增依赖；
- 正式交付前运行 `npm run dist:win` 并核验产物。

### 16.3 手工验收场景

1. 不选择远程知识时，本地技术方案和已有方案扩写行为与改造前一致。
2. 只选择远程整库时，各阶段实际使用 `knowledge_base_ids` 检索。
3. 只选择远程文档时，请求同时包含正确的 `knowledge_base_ids` 和 `knowledge_ids`。
4. 本地文档、远程整库和另一远程库具体文档可混合选择。
5. 关闭并重启应用后，当前方案恢复选择。
6. 修改服务地址后，旧选择不会被用于新服务。
7. 临时错误自动重试两次后显示全局决策。
8. 401/403/404 不自动重试，直接显示决策。
9. 修改设置后“重试”成功，任务从失败点继续。
10. “停用远程并继续”完成当前任务，下次任务重新尝试远程服务。
11. 关闭弹窗、切换页面再返回，等待决策仍存在。
12. 零命中时任务继续，并显示可理解的进度日志。
13. `original-only` 模式不让远程知识改变目录，但后续阶段仍可使用。
14. Windows 100%、125%、150% 显示缩放下弹窗无溢出、按钮不拆行。
15. 远程知识不出现在文档知识库页面。
16. 同一任务多个并发远程请求同时失败时只出现一个决策弹窗，并按同一用户选择恢复。

## 17. 完成标准

只有同时满足以下条件才可声明完成：

1. 代码、migration、IPC、类型和设置链路全部实现；
2. 本地知识库回归通过；
3. WeKnora v0.7.2+ 实际服务完成整库和文档级检索验证；
4. 远程失败两种用户决策均完成真实链路验证；
5. 自动测试、构建、native smoke 和 Windows 手工验收通过；
6. 本地打包产物包含默认远程配置，且 Git 中不存在真实 API Key。
