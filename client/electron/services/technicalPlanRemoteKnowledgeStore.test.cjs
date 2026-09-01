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

function createStore(app, db, fileService) {
  return createTechnicalPlanStore({
    app,
    db,
    fileService,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

function resetToV23(app) {
  const database = createSqliteDatabase(app);
  database.db.exec(`
    DROP TABLE IF EXISTS technical_plan_remote_knowledge_documents;
    DROP TABLE IF EXISTS technical_plan_remote_knowledge_scopes;
    PRAGMA user_version = 23;
  `);
  database.close();
}

async function runPersistenceAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-remote-knowledge-'));
  let database;
  let restartedDatabase;
  try {
    const app = createApp(userDataPath);
    resetToV23(app);

    database = createSqliteDatabase(app);
    assert.equal(database.schemaVersion, 24);

    const store = createStore(app, database.db, {
      importDocument: async () => ({
        success: true,
        file_content: '# 招标文件',
        file_name: '招标文件.docx',
      }),
    });
    store.saveOutlineConfig({
      referenceKnowledgeDocumentIds: ['local-1'],
      outlineMode: 'aligned',
      outlineExpansionMode: 'ai-complement',
      remoteKnowledgeScopes: [
        {
          knowledgeBaseId: 'kb-1',
          knowledgeBaseName: '施工规范',
          mode: 'documents',
          endpointFingerprint: 'fingerprint-a',
          apiKey: 'must-not-be-persisted',
          documents: [
            { knowledgeId: 'doc-1', title: '质量验收规范' },
            { knowledgeId: 'doc-1', title: '重复文档' },
          ],
        },
        {
          knowledgeBaseId: 'kb-1',
          knowledgeBaseName: '重复知识库',
          mode: 'all',
          endpointFingerprint: 'fingerprint-b',
        },
      ],
    });

    assert.deepEqual(store.loadTechnicalPlan().remoteKnowledgeScopes, [
      {
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: '施工规范',
        mode: 'documents',
        endpointFingerprint: 'fingerprint-a',
        documents: [{ knowledgeId: 'doc-1', title: '质量验收规范' }],
      },
    ]);
    assert.deepEqual(store.loadTechnicalPlan().referenceKnowledgeDocumentIds, ['local-1']);

    await store.importTenderDocument(['招标文件.docx']);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_documents').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_scopes').get().count, 0);

    store.saveOutlineConfig({
      remoteKnowledgeScopes: [{
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: '施工规范',
        mode: 'all',
        endpointFingerprint: 'fingerprint-a',
        documents: [{ knowledgeId: 'doc-1', title: '不应保存' }],
      }],
    });
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_documents').get().count, 0);

    store.saveOutlineConfig({
      remoteKnowledgeScopes: [
        {
          knowledgeBaseId: 'kb-2',
          knowledgeBaseName: '安全规范',
          mode: 'all',
          endpointFingerprint: 'fingerprint-a',
        },
        {
          knowledgeBaseId: 'kb-1',
          knowledgeBaseName: '施工规范',
          mode: 'documents',
          endpointFingerprint: 'fingerprint-a',
          documents: [{ knowledgeId: 'doc-1', title: '质量验收规范' }],
        },
      ],
    });
    database.close();
    database = null;

    restartedDatabase = createSqliteDatabase(app);
    const restartedStore = createStore(app, restartedDatabase.db);
    assert.deepEqual(restartedStore.loadTechnicalPlan().remoteKnowledgeScopes.map((scope) => scope.knowledgeBaseId), ['kb-2', 'kb-1']);

    restartedStore.saveOutlineConfig({
      referenceKnowledgeDocumentIds: ['local-before-switch'],
      remoteKnowledgeScopes: [{
        knowledgeBaseId: 'kb-before-switch',
        knowledgeBaseName: '切换前规范',
        mode: 'all',
        endpointFingerprint: 'fingerprint-a',
      }],
    });
    restartedStore.switchWorkflowKind('existing-plan-expansion');
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_reference_docs').get().count, 0);
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_documents').get().count, 0);
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_scopes').get().count, 0);

    restartedStore.saveBidAnalysisConfig({ mode: 'key', selectedTaskIds: [], bidSectionMode: 'multiple' });
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_documents').get().count, 0);
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_scopes').get().count, 0);

    restartedStore.saveOutlineConfig({
      remoteKnowledgeScopes: [{
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: '施工规范',
        mode: 'all',
        endpointFingerprint: 'fingerprint-a',
      }],
    });

    restartedStore.clearTechnicalPlan();
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_documents').get().count, 0);
    assert.equal(restartedDatabase.db.prepare('SELECT COUNT(*) AS count FROM technical_plan_remote_knowledge_scopes').get().count, 0);
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
  test('persists normalized remote knowledge scopes through the technical-plan workspace lifecycle', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native persistence test timed out'}`);
  });
}
