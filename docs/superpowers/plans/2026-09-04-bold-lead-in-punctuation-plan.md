# 正文加粗引导语标点规范化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后续生成或调整并写回的正文中，加粗引导语按语义使用冒号或不带句末标点。

**Architecture:** 在 `contentGenerationTask.cjs` 的统一正文保存入口前增加 Markdown 行级规范化函数，并保留现有章节标题去重、换行和代码围栏处理。同步收紧正文生成提示词，测试纯函数和保存规范化行为。

**Tech Stack:** Node.js CommonJS、Node built-in test runner、现有 AI Markdown 生成链路。

---

### Task 1: Add failing normalization tests

**Files:**
- Create: `client/electron/services/contentGenerationTask.punctuation.test.cjs`
- Test: `client/electron/services/contentGenerationTask.cjs`

- [ ] **Step 1: Write tests** for inline bold lead-ins, inline lead-ins with an internal colon, standalone bold lines with an internal colon, `__...__`, code fences, table rows, full-line image Markdown/HTML, Markdown-heading conversion, CRLF, unclosed fences, ordinary prose, and preservation of existing chapter-title stripping/Markdown normalization.
- [ ] **Step 2: Run** `node --test client/electron/services/contentGenerationTask.punctuation.test.cjs` and confirm failure because the helper is not implemented/exported.

### Task 2: Implement punctuation normalization and prompt constraints

**Files:**
- Modify: `client/electron/services/contentGenerationTask.cjs`

- [ ] **Step 1: Implement** a fenced-code-aware line normalizer that skips table rows and full-line `![...](...)`/`<img ...>` lines, then changes sentence-final `。`/`.` inside complete bold lead-ins to `：` when inline text follows without an internal colon, to `，` when an internal colon already exists, and removes it for standalone bold lines.
- [ ] **Step 2: Call** the normalizer from `normalizeLeafContentForSave()` only after `normalizeGeneratedMarkdown()`, `stripRepeatedChapterTitle()`, and `stripMarkdownHeadingsFromLeafContent()` have completed, so all existing save paths receive the same behavior.
- [ ] **Step 3: Update** the chapter-content prompt rules to state the required punctuation explicitly.
- [ ] **Step 4: Export** the helper for focused tests without changing runtime APIs.
- [ ] **Step 5: Run** the focused test and confirm pass.
- [ ] **Step 6: Assert** the shared prompt text contains the punctuation rule for first generation, restored optimization, and word-adjustment messages.

### Task 3: Verify client build

**Files:** None.

- [ ] **Step 1: Run** `cd client; npm run build`.
- [ ] **Step 2: Confirm** exit code 0; treat only existing chunk-size warnings as non-failures.
- [ ] **Step 3: Review** `git diff` to ensure no historical export-time rewriting or unrelated changes.

### Task 4: Remove duplicate punctuation at the bold boundary

**Files:**
- Modify: `client/electron/services/contentGenerationTask.punctuation.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`

- [ ] **Step 1: Add a failing regression test** asserting `**图属一致性处理：**，各类表格` becomes `**图属一致性处理：** 各类表格`, with equivalent cases for `，,、；;：:` and both `**...**` / `__...__` markers. Also cover optional whitespace, repeated delimiters, and `**图属一致性处理：**，` remaining unchanged when no prose follows.
- [ ] **Step 2: Run** `node --test electron/services/contentGenerationTask.punctuation.test.cjs` from `client/` and confirm the new case fails because the current normalizer returns the duplicate boundary punctuation unchanged.
- [ ] **Step 3: Implement the minimal boundary rule** in `normalizeGeneratedLeadInPunctuation()`: when the bold content ends in `：` or `:`, and one or more leading `，,、；;：:` delimiters are followed by non-empty prose, strip those delimiters and surrounding whitespace, then join the prose with one ASCII space. Preserve delimiter-only trailing text, standalone bold titles, and protected code/table/image lines.
- [ ] **Step 4: Run the focused test** and confirm every punctuation case passes.
- [ ] **Step 5: Run regressions** with `node --test electron/services/contentGenerationTask.punctuation.test.cjs electron/services/contentGenerationTask.remoteKnowledge.test.cjs`, then run `node --check electron/services/contentGenerationTask.cjs` and `npm run build` from `client/`.
- [ ] **Step 6: Review** `git diff --check` and confirm no export-time or historical-content rewriting was added.
