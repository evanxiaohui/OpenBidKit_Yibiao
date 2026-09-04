const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyGeneratedIllustrationsToDocument,
  generateMermaidIllustration,
  generateMermaidAiIllustration,
} = require('./contentIllustrationGeneration.cjs');

function createExecution() {
  return {
    planItem: {
      item_id: 'mermaid-1',
      kind: 'mermaid',
      image_type: 'process',
      title: '实施流程',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {},
    },
    reference: '正文事实：先审核资料，再反馈结果。',
  };
}

function createRenderService() {
  const calls = [];
  return {
    calls,
    renderMermaidToPng: async (code) => {
      calls.push(code);
      return { buffer: Buffer.from('png') };
    },
  };
}

test('Mermaid 默认入口返回生成并通过本地渲染校验的 code', async () => {
  const renderService = createRenderService();
  const result = await generateMermaidIllustration({
    collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
  }, createExecution(), undefined, renderService);

  assert.equal(result.code, 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]');
  assert.equal(result.attempts, 0);
  assert.deepEqual(renderService.calls, [result.code]);
});

test('Mermaid AI 重绘 prompt 包含已校验 code、标题、类型和正文 reference', async () => {
  const renderService = createRenderService();
  const imageRequests = [];
  const result = await generateMermaidAiIllustration({
    collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
    generateImage: async (request) => {
      imageRequests.push(request);
      return { asset_url: 'yibiao-asset://generated-images/mermaid-1.png' };
    },
  }, createExecution(), undefined, renderService);

  assert.equal(result.asset_url, 'yibiao-asset://generated-images/mermaid-1.png');
  assert.equal(result.attempts, 1);
  assert.match(imageRequests[0].prompt, /flowchart TD/);
  assert.match(imageRequests[0].prompt, /实施流程/);
  assert.match(imageRequests[0].prompt, /flowchart/);
  assert.match(imageRequests[0].prompt, /正文事实：先审核资料，再反馈结果。/);
  assert.match(imageRequests[0].prompt, /不得新增流程/);
  assert.deepEqual(renderService.calls, ['flowchart TD\n  A["审核资料"] --> B["反馈结果"]']);
});

test('Mermaid AI 图片模型失败时直接报错，不回退为 Mermaid code', async () => {
  const renderService = createRenderService();
  await assert.rejects(
    () => generateMermaidAiIllustration({
      collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
      generateImage: async () => { throw new Error('图片模型不可用'); },
    }, createExecution(), undefined, renderService),
    /图片模型不可用/,
  );
  assert.equal(renderService.calls.length, 1);
});

test('Mermaid AI 对象式运行参数会原样透传暂停异常', async () => {
  const renderService = createRenderService();
  const pauseError = new Error('任务已暂停');
  let caught;
  try {
    await generateMermaidAiIllustration({
      collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
      generateImage: async () => { throw pauseError; },
    }, createExecution(), {
      isPauseLikeError: (error) => error === pauseError,
      localImageRenderService: renderService,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, pauseError);
});

test('Mermaid AI asset_url result creates standard yibiao-asset image Markdown', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'mermaid-1',
      kind: 'mermaid',
      title: 'Implementation flow',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'success',
        asset_url: 'yibiao-asset://generated-images/mermaid-1.png',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: 'Implementation flow', content: 'Existing text.' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: 'Existing text.' },
  });

  assert.equal(
    result.sections['1.1'].content,
    'Existing text.\n\n<!-- yibiao-illustration:start id="mermaid-1" -->\n![Implementation flow](yibiao-asset://generated-images/mermaid-1.png)\n\n*<!-- yibiao-figure-caption -->Implementation flow*\n<!-- yibiao-illustration:end -->',
  );
  assert.equal(result.outlineData.outline[0].content, result.sections['1.1'].content);
});
