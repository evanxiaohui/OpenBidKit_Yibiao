const assert = require('node:assert/strict');
const test = require('node:test');

const { applyGeneratedIllustrationsToDocument } = require('./contentIllustrationGeneration.cjs');

test('新生成的正文配图标题不包含“图：”前缀', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'image-1',
      kind: 'ai-image',
      title: '重点难点应对措施责任矩阵',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'success',
        asset_url: 'yibiao-asset://generated-images/image-1.png',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: '实施方案', content: '正文内容。' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: '正文内容。' },
  });

  const content = result.sections['1.1'].content;
  assert.match(content, /\*<!-- yibiao-figure-caption -->重点难点应对措施责任矩阵\*/);
  assert.doesNotMatch(content, /图：重点难点应对措施责任矩阵/);
});

test('新生成的 Mermaid 配图标题不包含“图：”前缀', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'mermaid-1',
      kind: 'mermaid',
      title: '项目实施流程',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'success',
        code: 'flowchart LR\n  A --> B',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: '实施方案', content: '正文内容。' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: '正文内容。' },
  });

  const content = result.sections['1.1'].content;
  assert.match(content, /\*<!-- yibiao-figure-caption -->项目实施流程\*/);
  assert.doesNotMatch(content, /图：项目实施流程/);
});
