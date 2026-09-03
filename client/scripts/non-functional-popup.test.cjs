const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const clientRoot = path.resolve(__dirname, '..');

async function bundleWithStubs(entryPoint, stubs) {
  const result = await esbuild.build({
    entryPoints: [path.join(clientRoot, entryPoint)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    plugins: [{
      name: 'test-stubs',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (!Object.hasOwn(stubs, args.path)) return null;
          return { path: args.path, namespace: 'test-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'test-stub' }, (args) => ({
          contents: stubs[args.path],
          loader: 'tsx',
        }));
      },
    }],
  });

  const outputPath = path.join(clientRoot, `non-functional-popup-test-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(outputPath, result.outputFiles[0].contents);
  try {
    return await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

test('application startup mounts functional prompts without remote announcements', async () => {
  const { default: App } = await bundleWithStubs('src/App.tsx', {
    './app/AppRouter': 'export default function AppRouter() { return <main>workspace</main>; }',
    './app/GpuHardwareAccelerationPrompt': 'export default function Prompt() { return <div data-global-prompt="gpu" />; }',
    './app/RequiredOnlineServicesPrompt': 'export default function Prompt() { return <div data-global-prompt="online-services" />; }',
    './app/PluginUpdateNotifier': 'export default function Notifier() { return <div data-global-service="plugin-updates" />; }',
    './app/UpdateNotifier': 'export default function Prompt() { return <div data-global-prompt="remote-notice" />; }',
    './components/AppShell': 'export default function AppShell({ children }) { return <>{children}</>; }',
    './shared/analytics/analytics': 'export function trackAppOpen() {} export function trackConfigUsage() {} export function trackPageView() {}',
  });

  const html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /data-global-prompt="gpu"/);
  assert.match(html, /data-global-prompt="online-services"/);
  assert.match(html, /data-global-service="plugin-updates"/);
  assert.doesNotMatch(html, /data-global-prompt="remote-notice"/);
});

test('global providers keep operational dialogs without the donation provider', async () => {
  const { default: AppProviders } = await bundleWithStubs('src/app/providers/AppProviders.tsx', {
    '../../shared/ui': `
      const wrap = (name) => ({ children }) => <section data-provider={name}>{children}</section>;
      export const ToastProvider = wrap('toast');
      export const DonationPromptProvider = wrap('donation');
      export const AgentQuestionDialogProvider = wrap('agent-question');
      export const AiHttpErrorDialogProvider = wrap('ai-http-error');
      export const DocumentParseNoticeProvider = wrap('document-parse');
    `,
  });

  const html = renderToStaticMarkup(
    React.createElement(AppProviders, null, React.createElement('main', null, 'workspace')),
  );
  assert.match(html, /data-provider="toast"/);
  assert.match(html, /data-provider="agent-question"/);
  assert.match(html, /data-provider="ai-http-error"/);
  assert.match(html, /data-provider="document-parse"/);
  assert.doesNotMatch(html, /data-provider="donation"/);
});
