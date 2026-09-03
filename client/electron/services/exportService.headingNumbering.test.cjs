const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { buildDocxBuffer } = require('./exportService.cjs');

const headings = [
  { numbering_format: 'custom', numbering_template: '第{zh}章' },
  { numbering_format: 'custom', numbering_template: '第{zh}节' },
  { numbering_format: 'custom', numbering_template: '{tail}' },
  { numbering_format: 'custom', numbering_template: '{tail}' },
  { numbering_format: 'custom', numbering_template: '{tail}' },
  { numbering_format: 'custom', numbering_template: '{tail}' },
];

function readDocxXml(buffer, entryName) {
  const entry = new AdmZip(buffer).getEntry(entryName);
  assert.ok(entry, `DOCX should contain ${entryName}`);
  return entry.getData().toString('utf8');
}

function paragraphContaining(documentXml, text) {
  const paragraph = documentXml
    .match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
    ?.find((value) => value.includes(`>${text}</w:t>`));
  assert.ok(paragraph, `expected a paragraph containing ${text}`);
  return paragraph;
}

function numberingLevel(numberingXml, level) {
  const matches = [...numberingXml.matchAll(new RegExp(`<w:lvl w:ilvl="${level}"[^>]*>[\\s\\S]*?</w:lvl>`, 'g'))];
  assert.ok(matches.length, `expected numbering level ${level}`);
  return matches.at(-1)[0];
}

function createPayload(headingBorderEnabled = false, minHeadingLeftEnabled = false) {
  return {
    project_name: '测试项目',
    export_format: {
      heading_border: {
        enabled: headingBorderEnabled,
        min_heading_left_enabled: minHeadingLeftEnabled,
        border_color: '#000000',
        level_cell_colors: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
        structure: '上下结构',
      },
      headings,
    },
    outline: [{
      id: '1',
      title: '总体方案',
      children: [{
        id: '1.1',
        title: '实施方案',
        children: [{
          id: '1.1.1',
          title: '准备工作',
          content: '正文内容。',
        }],
      }],
    }],
  };
}

test('Word export uses template-driven native multilevel numbering for headings', async () => {
  const buffer = await buildDocxBuffer(createPayload());
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');

  assert.doesNotMatch(documentXml, />第一章 总体方案<\/w:t>/);
  assert.doesNotMatch(documentXml, />第一节 实施方案<\/w:t>/);
  assert.match(paragraphContaining(documentXml, '总体方案'), /<w:pStyle w:val="Heading1"\/>[\s\S]*<w:ilvl w:val="0"\/>/);
  assert.match(paragraphContaining(documentXml, '实施方案'), /<w:pStyle w:val="Heading2"\/>[\s\S]*<w:ilvl w:val="1"\/>/);
  assert.match(paragraphContaining(documentXml, '准备工作'), /<w:pStyle w:val="Heading3"\/>[\s\S]*<w:ilvl w:val="2"\/>/);

  assert.match(numberingLevel(numberingXml, 0), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="第%1章"\/>/);
  assert.match(numberingLevel(numberingXml, 1), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="第%2节"\/>/);
  assert.match(numberingLevel(numberingXml, 2), /<w:numFmt w:val="decimal"\/>[\s\S]*<w:lvlText w:val="%3"\/>/);
  assert.match(numberingLevel(numberingXml, 3), /<w:lvlText w:val="%3.%4"\/>/);
});

test('chapter-frame export keeps heading numbering as native Word numbering', async () => {
  const buffer = await buildDocxBuffer(createPayload(true));
  const documentXml = readDocxXml(buffer, 'word/document.xml');

  assert.match(paragraphContaining(documentXml, '总体方案'), /<w:ilvl w:val="0"\/>/);
  assert.match(paragraphContaining(documentXml, '实施方案'), /<w:ilvl w:val="1"\/>/);
  assert.match(paragraphContaining(documentXml, '准备工作'), /<w:ilvl w:val="2"\/>/);
});

test('custom heading placeholders keep their Word-native number formats', async () => {
  const payload = createPayload();
  payload.export_format.headings = [
    { numbering_format: 'custom', numbering_template: '{circled}' },
    { numbering_format: 'custom', numbering_template: '{alpha}.' },
    { numbering_format: 'custom', numbering_template: '{ALPHA}.' },
    { numbering_format: 'custom', numbering_template: '{roman}.' },
    { numbering_format: 'custom', numbering_template: '{ROMAN}.' },
    { numbering_format: 'custom', numbering_template: '{num}' },
  ];

  const buffer = await buildDocxBuffer(payload);
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');

  assert.match(numberingLevel(numberingXml, 0), /<w:numFmt w:val="decimalEnclosedCircle"\/>/);
  assert.match(numberingLevel(numberingXml, 1), /<w:numFmt w:val="lowerLetter"\/>/);
  assert.match(numberingLevel(numberingXml, 2), /<w:numFmt w:val="upperLetter"\/>/);
  assert.match(numberingLevel(numberingXml, 3), /<w:numFmt w:val="lowerRoman"\/>/);
  assert.match(numberingLevel(numberingXml, 4), /<w:numFmt w:val="upperRoman"\/>/);
  assert.match(numberingLevel(numberingXml, 5), /<w:numFmt w:val="decimal"\/>/);
});

test('numeric range placeholders render referenced higher levels as Arabic numbers', async () => {
  const payload = createPayload();
  payload.export_format.headings[2] = { numbering_format: 'custom', numbering_template: '{tail2}' };

  const buffer = await buildDocxBuffer(payload);
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');
  const level = numberingLevel(numberingXml, 2);

  assert.match(level, /<w:lvlText w:val="%2.%3"\/>/);
  assert.match(level, /<w:isLgl\/>/);
});

test('outline-decimal template option uses editable native multilevel numbering', async () => {
  const payload = createPayload();
  payload.export_format.headings = headings.map(() => ({
    numbering_format: 'outline-decimal',
    numbering_template: '',
  }));

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');

  assert.doesNotMatch(documentXml, />1\.1\.1 准备工作<\/w:t>/);
  assert.match(paragraphContaining(documentXml, '准备工作'), /<w:ilvl w:val="2"\/>/);
  assert.match(numberingLevel(numberingXml, 0), /<w:lvlText w:val="%1"\/>/);
  assert.match(numberingLevel(numberingXml, 1), /<w:lvlText w:val="%1.%2"\/>/);
  assert.match(numberingLevel(numberingXml, 2), /<w:lvlText w:val="%1.%2.%3"\/>/);
});

test('invalid tail placeholders stay empty instead of becoming a different numbering range', async () => {
  const payload = createPayload();
  payload.export_format.headings[2] = { numbering_format: 'custom', numbering_template: '{tail0}' };

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');

  assert.doesNotMatch(paragraphContaining(documentXml, '准备工作'), /<w:numPr>/);
});

test('mixed custom placeholders fall back to literal numbering instead of corrupting template output', async () => {
  const payload = createPayload();
  payload.export_format.headings[2] = { numbering_format: 'custom', numbering_template: '{full}-{zh}' };

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const paragraph = paragraphContaining(documentXml, '1.1.1-一 准备工作');

  assert.doesNotMatch(paragraph, /<w:numPr>/);
});

test('sibling and child headings share one native list so WPS can increment and restart them', async () => {
  const payload = createPayload();
  payload.outline = [{
    id: '1',
    title: '甲章',
    children: [
      { id: '1.1', title: '甲节一', content: '正文。' },
      { id: '1.2', title: '甲节二', content: '正文。' },
    ],
  }, {
    id: '2',
    title: '乙章',
    children: [
      { id: '2.1', title: '乙节一', content: '正文。' },
      { id: '2.2', title: '乙节二', content: '正文。' },
    ],
  }];

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const titleSequence = ['甲章', '甲节一', '甲节二', '乙章', '乙节一', '乙节二'];
  const paragraphs = titleSequence.map((title) => paragraphContaining(documentXml, title));
  const levels = paragraphs.map((value) => Number(value.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1]));
  const numIds = paragraphs.map((value) => value.match(/<w:numId w:val="(\d+)"\/>/)?.[1]);

  assert.deepEqual(levels, [0, 1, 1, 0, 1, 1]);
  assert.equal(new Set(numIds).size, 1);
  assert.ok(numIds[0]);
});

test('an incompatible parent template falls back the whole used hierarchy to literal numbering', async () => {
  const payload = createPayload();
  payload.export_format.headings[1] = { numbering_format: 'custom', numbering_template: '{full}-{zh}' };
  payload.export_format.headings[2] = { numbering_format: 'custom', numbering_template: '{full}' };
  payload.outline[0].children = [{
    id: '1.1',
    title: '甲节',
    children: [{ id: '1.1.1', title: '甲小节', content: '正文。' }],
  }, {
    id: '1.2',
    title: '乙节',
    children: [{ id: '1.2.1', title: '乙小节', content: '正文。' }],
  }];

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const expectedTitles = [
    '第一章 总体方案',
    '1.1-一 甲节',
    '1.1.1 甲小节',
    '1.2-二 乙节',
    '1.2.1 乙小节',
  ];

  for (const title of expectedTitles) {
    assert.doesNotMatch(paragraphContaining(documentXml, title), /<w:numPr>/);
  }
});

test('a hidden chapter-frame leaf template does not disable native numbering for displayed parents', async () => {
  const payload = createPayload(true, true);
  payload.export_format.headings[1] = { numbering_format: 'custom', numbering_template: '{full}-{zh}' };
  payload.outline[0].children = [{ id: '1.1', title: '居左叶子', content: '正文。' }];

  const buffer = await buildDocxBuffer(payload);
  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const parent = paragraphContaining(documentXml, '总体方案');
  const leaf = paragraphContaining(documentXml, '居左叶子');

  assert.match(parent, /<w:numPr>[\s\S]*<w:ilvl w:val="0"\/>/);
  assert.doesNotMatch(leaf, /<w:numPr>/);
});
