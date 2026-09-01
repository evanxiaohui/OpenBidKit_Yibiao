const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGlobalFactsRetrievalTopics,
  buildRemoteKnowledgeFile,
} = require('./globalFactsTaskV2.cjs');

test('全局事实检索主题只来自项目概述、招标解析和已确认目录', () => {
  const topics = buildGlobalFactsRetrievalTopics({
    projectOverview: '智慧水务平台建设',
    bidAnalysis: '工期 180 日历天，提供运维服务',
    outline: [{ id: '1', title: '平台总体设计', description: '总体架构与实施' }],
  });
  assert.ok(topics.length > 0 && topics.length <= 8);
  assert.ok(topics.every((topic) => !/远程正文|知识库新增话题/.test(topic)));
  assert.match(topics.join(' '), /智慧水务|工期|平台总体设计/);
});

test('全局事实远程参考文件只作为不可信补充材料', () => {
  const file = buildRemoteKnowledgeFile([
    { title: '远程规范', content: '远程内容', knowledgeBaseId: 'kb-secret', knowledgeId: 'doc-secret', chunkId: 'chunk-secret' },
  ]);
  assert.equal(file.path, '远程知识参考.md');
  assert.match(file.content, /仅是参考材料/);
  assert.match(file.content, /不得仅因参考材料新增全局事实大项/);
  assert.doesNotMatch(file.content, /kb-secret|doc-secret|chunk-secret/);
});
