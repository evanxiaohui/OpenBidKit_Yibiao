const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createStore(app, db) {
  return createTechnicalPlanStore({
    app,
    db,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

async function runPersistenceAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-content-options-'));
  let database;
  let restartedDatabase;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const generatedImagePath = path.join(userDataPath, 'workspace', 'generated-images', 'old.png');
    fs.mkdirSync(path.dirname(generatedImagePath), { recursive: true });
    fs.writeFileSync(generatedImagePath, 'fixture');
    const store = createStore(app, database.db);
    const imageMarkdown = '![AI Mermaid redraw](yibiao-asset://generated-images/old.png)';
    const outlineContent = `Outline text.\n\n${imageMarkdown}`;
    const sectionContent = `Section text.\n\n${imageMarkdown}`;
    const outlineData = {
      project_overview: 'Persistence fixture',
      outline: [{ id: '1.1', title: 'Implementation flow', content: outlineContent }],
    };

    store.saveOutline({ outlineData, reason: 'replace' });
    store.updateTechnicalPlan({
      contentGenerationSections: {
        '1.1': { id: '1.1', title: 'Implementation flow', status: 'success', content: sectionContent },
      },
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'before-redraw',
        items: [{
          item_id: 'mermaid-1',
          kind: 'mermaid',
          image_type: 'process',
          title: 'Implementation flow',
          section_ids: ['1.1'],
          placement: 'after',
          generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/old.png' },
        }],
      },
    });
    assert.equal(store.loadTechnicalPlan().contentGenerationSections['1.1'].content, sectionContent);
    store.updateTechnicalPlan({ outlineData });

    const beforeSave = store.loadTechnicalPlan();
    assert.equal(beforeSave.contentIllustrationPlan.items[0].generation.asset_url, 'yibiao-asset://generated-images/old.png');
    assert.equal(beforeSave.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(beforeSave.outlineData.outline[0].content, outlineContent);
    assert.equal(database.db.prepare('SELECT status FROM technical_plan_content_sections WHERE node_id = ?').get('1.1').status, 'success');

    const result = store.saveContentGenerationOptions({ useAiRedesignForMermaid: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(result.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(result.contentIllustrationPlan, undefined);
    assert.equal(fs.existsSync(generatedImagePath), true);

    const afterSave = store.loadTechnicalPlan();
    assert.deepEqual(afterSave.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(afterSave.contentIllustrationPlan, undefined);
    assert.equal(afterSave.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(afterSave.outlineData.outline[0].content, outlineContent);
    assert.equal(database.db.prepare('SELECT status FROM technical_plan_content_sections WHERE node_id = ?').get('1.1').status, 'success');

    database.close();
    database = null;
    restartedDatabase = createSqliteDatabase(app);
    const restarted = createStore(app, restartedDatabase.db).loadTechnicalPlan();
    assert.deepEqual(restarted.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(restarted.contentIllustrationPlan, undefined);
    assert.equal(restarted.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(restarted.outlineData.outline[0].content, outlineContent);
  } finally {
    database?.close();
    restartedDatabase?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  runPersistenceAssertions()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('saving Mermaid AI redraw options invalidates only illustration metadata', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native persistence test timed out'}`);
  });
}
