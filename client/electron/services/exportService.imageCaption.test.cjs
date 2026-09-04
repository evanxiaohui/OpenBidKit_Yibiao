const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { buildDocxBuffer } = require('./exportService.cjs');

function readDocumentXml(buffer) {
  const entry = new AdmZip(buffer).getEntry('word/document.xml');
  assert.ok(entry, 'DOCX should contain word/document.xml');
  return entry.getData().toString('utf8');
}

function paragraphContaining(documentXml, text) {
  const paragraph = documentXml
    .match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
    ?.find((value) => value.includes(`>${text}</w:t>`));
  assert.ok(paragraph, `expected a paragraph containing ${text}`);
  return paragraph;
}

test('Word 导出按图片标题格式处理无前缀的标记标题', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '测试项目',
    export_format: {
      image: {
        caption_alignment: '右对齐',
        caption_bold: true,
      },
    },
    outline: [{
      id: '1',
      title: '实施方案',
      content: '*<!-- yibiao-figure-caption -->重点难点应对措施责任矩阵*',
    }],
  });

  const paragraph = paragraphContaining(readDocumentXml(buffer), '重点难点应对措施责任矩阵');
  assert.match(paragraph, /<w:jc w:val="right"\/>/);
  assert.match(paragraph, /<w:b\/>/);
  assert.doesNotMatch(paragraph, /图：/);
});
