# Mermaid 配图 AI 重绘设计

## 背景

当前技术方案正文的 Mermaid 配图流程是：图片编排 Agent 选择适合的流程、层级或职责关系图，文本模型生成 Mermaid 代码，Main 进程本地渲染 PNG，再把图片 Markdown 插入正文。用户希望保留 Mermaid 的结构语义，同时可以选择让图片模型重新设计视觉表现。

## 目标与非目标

目标：

- 在“使用 Mermaid 生图”配置模块中增加一个 Mermaid 专属的 AI 重绘开关。
- 开关默认关闭；关闭时现有 Mermaid 代码生成、本地渲染、重试和导出行为完全不变。
- 开启时，仍由 Mermaid 配图计划决定图类型、小节、上限和插入位置，但在生成阶段输出 AI 图片 PNG。
- 全量生成、单小节重生成、失败重试、任务恢复和正文/Word 导出沿用现有协议。

非目标：

- 不改变独立 AI 图片和 HTML 图片的开关、优先级、上限或统计口径。
- 不把 Mermaid 配图计划改成 `kind: ai`。
- 不自动重绘已经生成的旧 Mermaid 图片；只有后续生成任务读取新配置。
- 不新增 Mermaid 在线渲染依赖或远程图片资产协议。

## 用户配置与持久化

`ContentGenerationOptions` 新增布尔字段 `useAiRedesignForMermaid`，默认值为 `false`。Renderer 在 Mermaid 配图设置组中保留现有“使用 Mermaid 生图”和“Mermaid 生图上限”，并在其下增加二级开关“Mermaid 改用 AI 图片重绘”。二级开关仅在一级开关开启时可操作；其默认关闭状态明确显示原 Mermaid 模式仍有效。

配置继续通过 `technicalPlan.saveContentGenerationOptions()` 写入现有技术方案配置 JSON。旧工作区缺少该字段时，由 Renderer 的选项归一化逻辑补为 `false`。当图片模型不可用时，二级开关不可操作并显示“请先配置并测试图片模型”；若任务启动后模型状态失效，Main 记录明确的图片模型不可用错误，不静默切回 Mermaid 模式。全量生成、单小节重生成、失败重试和继续任务沿用同一个字段，采用现有 generation options 传递路径，不新增 IPC 通道。

## 生成架构

图片编排阶段继续生成 `kind: mermaid` 的计划项，保持 Mermaid 类型白名单、单小节约束、标题去重、数量上限、插入位置和 `illustration_generation_mermaid_*` 统计不变。

图片生成阶段在 `contentGenerationTask` 中根据 `useAiRedesignForMermaid` 选择实现：

1. `false`：调用现有 Mermaid 生成函数。文本模型返回受限的 `flowchart TD/TB/LR/RL/BT` 代码，Main 本地校验并渲染 PNG，渲染失败按现有 AI 修复轮次重试。
2. `true`：先复用现有 Mermaid 文本生成与校验逻辑，得到受支持语法的 Mermaid 代码，但跳过本地 PNG 渲染；再由新的 Mermaid AI 重绘函数将“已校验 Mermaid 代码 + 图片编排标题 + Mermaid 图类型 + 对应正文”作为结构化参考传给统一 `aiService.generateImage()`，生成 PNG 并返回现有 `asset_url` 结构。提示词要求严格保持代码中的步骤顺序、节点语义、判断/反馈关系和正文事实，不得新增流程、角色、设备、数据或承诺；图中文字应尽量少且清晰，视觉风格为专业业务信息图。若 Mermaid 代码生成或校验失败，沿用现有 Mermaid 修复轮次并在修复耗尽后结束为该计划项错误，不调用图片模型。

两条分支都通过现有 `buildGeneratedIllustrationMarkdown()` 写入 `yibiao-asset://generated-images/...` 图片 Markdown，正文插入、旧图清理、任务 checkpoint、暂停/恢复和 Word 导出无需改变。AI 重绘生成失败时记录该计划项错误并继续现有任务收尾，不静默回退到 Mermaid 代码渲染，避免模式与结果不一致。

## 交互与提示

配置说明应明确：开启后仅影响之后的新生成任务；已有图片不会自动重绘。生成日志和进度沿用 Mermaid 分类，但步骤文案应能区分“Mermaid AI 图片重绘”和“Mermaid 代码渲染”，方便用户判断当前模式。

## 测试与验证

- Renderer：验证默认值为 `false`、旧配置归一化为 `false`、开关保存后重新加载保持状态、图片模型不可用时开关禁用并给出提示，并确认全量和单小节请求携带字段。
- Main：验证字段从任务 payload/持久化配置读取，AI 重绘分支先生成并校验 Mermaid 代码再调用 `generateImage()`，原 Mermaid 分支保持代码校验和本地渲染，失败结果正确 checkpoint。
- 现有 Mermaid 相关测试继续通过；补充生成函数的 prompt、模式分支和 asset URL 测试。
- 回归验证切换开关后不会清理或重绘已有成功计划/正文；AI 重绘成功后仍由 `asset_url` 分支插入图片，Word 导出链路保持不变。
- 按仓库约定执行 `node --check`（涉及的 `.cjs`）、`npm run build`，并对相关 `*.test.cjs` 定向运行 Node 测试。

## 风险与取舍

图片模型对中文文字的精确排版能力可能弱于本地 Mermaid/HTML 渲染，因此 AI 重绘是显式可选模式，默认不启用。提示词约束事实和节点数量，不能保证图片中文字百分之百无误；对需要严格文字准确性的流程图，用户仍可使用默认 Mermaid 模式。
