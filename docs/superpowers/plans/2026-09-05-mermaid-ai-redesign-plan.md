# Mermaid 配图 AI 重绘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Mermaid 配图增加默认关闭的 AI 图片重绘模式，同时完整保留原 Mermaid 代码渲染模式和现有任务/导出协议。

**Architecture:** Renderer 在现有 `ContentGenerationOptions` 中增加 Mermaid 专属模式字段并持久化；Main 的 Mermaid 配图生成服务先生成并本地校验 Mermaid 代码，再按字段选择保存 Mermaid PNG 或调用图片模型生成 PNG。计划项仍保持 `kind: mermaid`，正文插入、资产协议、数量限制、任务恢复和 Word 导出复用现有链路。

**Tech Stack:** React + TypeScript、Electron CommonJS、现有 `aiService`、本地 Mermaid/图片渲染服务、Node `node:test`、Vite/TypeScript build。

---

### Task 1: 扩展生成选项与 Mermaid 配置 UI

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`（`ContentGenerationOptions`）
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`（默认值、归一化、请求参数和 Mermaid 配置组）
- Test: `client/src/features/technical-plan/` 现有类型编译检查；必要时将选项归一化抽为纯 helper 后补对应测试

- [ ] **Step 1: 写出选项归一化的失败测试/断言**
  若页面内函数难以直接测试，先将 `normalizeGenerationOptions()` 抽到同 feature 的纯工具模块并导出；覆盖缺少字段时 `useAiRedesignForMermaid === false`、显式 `true` 能保留。图片模型可用性由现有 `imageModelAvailable` 控制 UI，不把它写入该字段的归一化结果。

- [ ] **Step 2: 运行定向检查确认测试或类型断言尚未通过**
  运行 `cd client; npm run build`，预期在字段尚未加入类型/归一化前出现类型或断言失败。

- [ ] **Step 3: 增加字段并接入现有配置链路**
  在 `ContentGenerationOptions` 和 `defaultContentGenerationOptions` 中加入 `useAiRedesignForMermaid: boolean`，在 `normalizeGenerationOptions()` 中对旧配置补 `false`。将字段原样加入保存草稿、全量生成、单小节重生成和失败重试共用的 generation options 对象；即使图片模型当前不可用，也不要像 `useAiImages` 那样把该字段 gate 成 false，避免 Main 静默回退。不要新增 IPC 通道，也不要改变 `saveContentGenerationOptions()` 的既有计划失效语义。

- [ ] **Step 4: 实现 Mermaid 二级开关**
  在“使用 Mermaid 生图”组内增加“Mermaid 改用 AI 图片重绘”开关和中文说明。开关受 `generationStrategyLocked` 与 `imageModelAvailable` 控制；图片模型不可用时禁用并提示先配置/测试图片模型。一级开关关闭时二级开关不可用，Mermaid 上限输入保持现有行为。

- [ ] **Step 5: 运行验证**
  运行 `cd client; npm run build`，预期 TypeScript 检查和 Vite 构建成功（允许既有 chunk 体积警告）。

- [ ] **Step 6: 提交**
  `git add client/src/features/technical-plan/types.ts client/src/features/technical-plan/pages/ContentEditPage.tsx`，提交 `feat: 增加Mermaid AI重绘配置`。

### Task 2: 抽取可复用 Mermaid 代码生成/校验并实现 AI 重绘分支

**Files:**
- Modify: `client/electron/services/contentIllustrationGeneration.cjs`（Mermaid 生成、校验和 AI 图片 prompt）
- Modify: `client/electron/services/contentGenerationTask.cjs`（按模式选择 Mermaid 生成函数）
- Test: `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`

- [ ] **Step 1: 写失败测试**
  使用 stub `aiService` 和本地渲染服务，验证 AI 模式会先收到包含已校验 Mermaid 代码的图片 prompt、调用 `generateImage()` 并返回 `asset_url`；验证默认模式仍返回 Mermaid `code`；验证 AI 生成失败返回错误而不静默回退。

- [ ] **Step 2: 运行定向测试确认失败**
  运行 `cd client; node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`，预期新 API/分支尚未存在而失败。

- [ ] **Step 3: 抽取“生成并校验 Mermaid 代码”内部 helper**
  保持现有 `buildMermaidGenerationMessages()`、语法校验、`validateMermaidRender()` 和最多三轮修复语义；让 helper 返回 `{ code, attempts }`，并允许调用方决定是否保存本地渲染 PNG。为 `validateMermaidRender()`/`prepareRenderableMermaid()`/公开 Mermaid 生成入口增加可选 `localImageRenderService` 注入参数，默认仍使用现有模块级服务；测试传入 stub。AI 模式必须执行本地渲染校验，但丢弃校验 PNG。

- [ ] **Step 4: 实现 Mermaid AI 图片 prompt 和生成函数**
  新增 Mermaid AI 重绘函数，使用计划标题、`image_type`、正文 reference 和已校验 Mermaid code 调用 `aiService.generateImage()`。明确要求保留步骤顺序、节点语义、判断/反馈关系和正文事实，不新增流程、角色、设备、数据或承诺，并返回与现有图片生成一致的 `{ asset_url, attempts }`。

- [ ] **Step 5: 接入任务分支**
  在 `runIllustrationGeneration()` 的 `kind === 'mermaid'` 分支读取 `generationOptions.useAiRedesignForMermaid`：true 调用 AI 重绘函数，false 调用原 Mermaid 函数。Renderer 传入原始字段值；当 true 且图片模型不可用时，Main 记录明确的图片模型不可用错误，不切回旧模式。保留 Mermaid 统计、checkpoint、暂停控制和错误记录，并让日志区分“Mermaid AI 图片重绘”和“Mermaid 代码渲染”。

- [ ] **Step 6: 运行定向测试与 CommonJS 语法检查**
  运行 `cd client; node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs electron/services/contentIllustrationGeneration.caption.test.cjs`；再运行 `node --check electron/services/contentIllustrationGeneration.cjs` 和 `node --check electron/services/contentGenerationTask.cjs`，预期全部通过。

- [ ] **Step 7: 提交**
  `git add client/electron/services/contentIllustrationGeneration.cjs client/electron/services/contentGenerationTask.cjs client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`，提交 `feat: 支持Mermaid配图AI重绘`。

### Task 3: 回归持久化、生成参数与构建验证

**Files:**
- Modify: `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`（生成分支、asset URL 回归）
- Create: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`（配置保存与旧正文图片回归）
- Test: `client/src/features/technical-plan/` 类型编译、现有 Mermaid/技术方案相关测试

- [ ] **Step 1: 增加持久化与旧图片回归断言**
  在新增的 `technicalPlanStore.contentGenerationOptions.test.cjs` 中复用 `technicalPlanRemoteKnowledgeStore.test.cjs` 的 Electron native 临时 userData/SQLite fixture，验证保存新选项时沿用 Store 行为：`contentIllustrationPlan` 元数据失效，但正文 sections/outline 中已有图片 Markdown 不被直接修改；只有新任务执行时才清理并替换旧配图。

- [ ] **Step 2: 增加 asset URL 与导出兼容断言**
  验证 AI Mermaid 成功结果通过 `asset_url` 分支生成标准 `yibiao-asset://generated-images/...` 图片 Markdown，标题和插入位置不变。

- [ ] **Step 3: 运行完整客户端构建**
  运行 `cd client; npm run build`，预期 `tsc --noEmit` 与 `vite build` 返回 0。

- [ ] **Step 4: 运行 Electron 原生烟测（若依赖环境可用）**
  运行 `cd client; npm run smoke:electron-native`，确认 Electron 侧加载未受影响；若本机缺少 Electron/native 运行环境，记录未执行原因，不修改业务逻辑绕过检查。

- [ ] **Step 5: 提交验证结果**
  检查 `git diff` 和 `git status --short`，确保只包含批准范围内文件；提交 `test: 验证Mermaid AI重绘兼容性`。

## Handoff

实现时必须先阅读 `docs/superpowers/specs/2026-09-05-mermaid-ai-redesign-design.md`。执行本计划前选择 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，按任务逐步提交并在每个任务后运行对应验证。
