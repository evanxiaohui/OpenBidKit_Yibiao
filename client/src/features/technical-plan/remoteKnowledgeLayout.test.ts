import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readClientSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('generation dialog keeps the available-document browser usable when many references are selected', () => {
  const stylesheet = readClientSource('src/styles/feature-technical-plan.css');

  assert.match(
    stylesheet,
    /\.outline-knowledge-picker\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(220px, 1fr\) minmax\(132px, 180px\);/s,
  );
});

test('local available-document browser does not reserve an empty selected-document row', () => {
  const stylesheet = readClientSource('src/styles/feature-technical-plan.css');

  assert.match(
    stylesheet,
    /\.outline-knowledge-grid\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/s,
  );
});

test('selected local and remote sources use distinct compact badges', () => {
  const stylesheet = readClientSource('src/styles/feature-technical-plan.css');

  assert.match(stylesheet, /\.outline-knowledge-badge\s*\{[^}]*display:\s*inline-flex;[^}]*border-radius:\s*var\(--yb-radius-pill\);/s);
  assert.match(stylesheet, /\.outline-knowledge-badge\.remote\s*\{[^}]*color:/s);
});

test('remote knowledge picker uses the dialog list and compact action styles', () => {
  const component = readClientSource('src/features/technical-plan/components/RemoteKnowledgePicker.tsx');

  assert.match(component, /className="remote-knowledge-picker outline-knowledge-browser"/);
  assert.match(component, /className="remote-knowledge-base-actions"/);
  assert.match(component, /className="remote-knowledge-action/);
  assert.match(component, /className="remote-knowledge-pagination"/);
});
test('reference knowledge tabs and remote browser use knowledge-base labels and show the base count', () => {
  const outlinePage = readClientSource('src/features/technical-plan/pages/OutlineEditPage.tsx');
  const remotePicker = readClientSource('src/features/technical-plan/components/RemoteKnowledgePicker.tsx');
  const settingsPage = readClientSource('src/features/settings/pages/SettingsPage.tsx');

  assert.match(outlinePage, />本地知识库<\/button>/);
  assert.match(outlinePage, />远程知识库<\/button>/);
  assert.match(remotePicker, /className="outline-knowledge-pane-head remote-knowledge-pane-head"/);
  assert.match(remotePicker, /<strong>远程知识库<\/strong>/);
  assert.match(remotePicker, /有 \{bases\.length\} 个知识库/);
  assert.match(settingsPage, /\{ id: 'remote-knowledge', label: '远程知识库' \}/);
});
