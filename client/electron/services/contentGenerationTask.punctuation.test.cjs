const assert = require('node:assert/strict');
const test = require('node:test');

const {
  __developerContentExpansionPatchRuntime,
  buildChapterContentMessages,
} = require('./contentGenerationTask.cjs');

const normalize = (value) => __developerContentExpansionPatchRuntime.normalizeGeneratedLeadInPunctuation(value);

test('inline bold lead-ins use a Chinese colon before following prose', () => {
  assert.equal(
    normalize('**房屋建筑信息核实。** 房屋数量核实。'),
    '**房屋建筑信息核实：** 房屋数量核实。',
  );
  assert.equal(normalize('__房屋属性信息核实.__ 房屋权属方面'), '__房屋属性信息核实：__ 房屋权属方面');
});

test('standalone bold lead-ins remove terminal sentence punctuation', () => {
  assert.equal(normalize('**自查自检机制。**'), '**自查自检机制**');
  assert.equal(normalize('  **自查自检机制.**  '), '  **自查自检机制**  ');
});

test('punctuation normalization skips protected blocks and unrelated prose', () => {
  const source = [
    '| **表格标题。** | 内容 |',
    '![**图片说明。**](image.png)',
    '<img alt="**图片说明。**" src="image.png">',
    '普通正文中的 **术语。** 不应被改写。',
    '```markdown',
    '**代码示例。**',
    '```',
  ].join('\r\n');
  assert.equal(normalize(source), source.replace(/\r\n/g, '\n'));
});

test('normalization handles converted Markdown headings and is idempotent', () => {
  const normalized = normalize('**自查自检机制。**\n\n**实施要点：** 逐项检查。');
  assert.equal(normalized, '**自查自检机制**\n\n**实施要点：** 逐项检查。');
  assert.equal(normalize(normalized), normalized);
});

test('save normalization applies the existing heading cleanup before punctuation cleanup', () => {
  assert.equal(
    __developerContentExpansionPatchRuntime.normalizeLeafContentForSave('### 自查自检机制。', { id: '1.1', title: '其他章节' }),
    '**自查自检机制**',
  );
});

test('chapter content prompt states the lead-in punctuation rules', () => {
  const messages = buildChapterContentMessages({
    chapter: { id: '1.1', title: '测试章节', description: '' },
    projectOverview: '',
    selectedFactsText: '',
    regenerateRequirement: '',
    contentPlan: null,
    knowledgeContents: [],
    wordControl: {},
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, /行内加粗引导语/);
  assert.match(prompt, /中文冒号/);
  assert.match(prompt, /独立成行/);
});

test('word adjustment prompt states the lead-in punctuation rules', () => {
  const messages = __developerContentExpansionPatchRuntime.buildWordAdjustmentMessages({
    context: { item: { id: '1.1', title: '测试章节', description: '' }, parentChapters: [], siblingChapters: [] },
    currentContent: '**自查自检机制。**',
    currentWords: 1,
    targetWords: 2,
    mode: 'expand',
    granularity: 'sentence',
    maximumChangeWords: 10,
    totalRemainingWords: 2,
    globalFactsMode: 'fabricate',
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, /行内加粗引导语/);
  assert.match(prompt, /中文冒号/);
  assert.match(prompt, /独立成行/);
});
