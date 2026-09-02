// 在隔离的 Electron Renderer 中验证真实 App，不访问用户配置或在线服务。
// 运行：npx electron scripts/app-notice-smoke.cjs
const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-notice-smoke-')));
app.disableHardwareAcceleration();

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App';
import { ToastProvider } from './src/shared/ui/ToastProvider';
import './src/styles.css';

window.runNoticeSmoke = async () => {
  const results = [];
  const requests = [];
  const runtimeErrors = [];
  window.addEventListener('error', (event) => runtimeErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason)));
  const updates = [{ id: 'smoke-plugin', name: '验证插件', installedVersion: '1.0.0', version: '1.1.0' }];
  let pluginListener;
  let noticeRequests = 0;
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, body: options.body ? JSON.parse(options.body) : null });
    if (pathname === '/notice') {
      noticeRequests++;
      return Response.json({ code: 0, notice: {
        id: 'smoke-notice-' + noticeRequests, projectName: 'yibiao-client', enabled: true,
        title: '不应显示的远程公告', content: '这是用于验证隐藏行为的公告。',
        createdAt: '2026-08-31', updatedAt: '2026-08-31',
      } });
    }
    return Response.json({ code: 0 });
  };
  // 仅替换本机 IPC 边界；App、侧栏、公告、Toast 和埋点代码均使用真实实现。
  window.yibiao = {
    platform: 'win32',
    config: { load: async () => ({ developer_mode: true, analytics_client_id: 'smoke-client',
      analytics_created_at: '2026-08-31', components: { file_parser: { provider: 'local' } } }) },
    getVersion: async () => '0.1.0',
    getGpuHardwareAccelerationStatus: async () => null,
    requiredOnlineServices: { getStatus: async () => ({ unavailableServices: [] }) },
    agent: { getStatus: async () => null, onStatus: () => () => {} },
    ui: { setCurrentView: async () => {} },
    plugins: { checkUpdates: async () => updates },
    onPluginUpdatesAvailable: (listener) => { pluginListener = listener; return () => { pluginListener = null; }; },
  };
  const root = createRoot(document.getElementById('root'));
  root.render(<ToastProvider><App /></ToastProvider>);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
  const waitFor = async (predicate, name) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('等待超时：' + name + '; ' + runtimeErrors.join('; '));
      await tick();
    }
    await tick();
  };
  const check = (name, passed) => results.push({ name, passed: Boolean(passed) });
  const button = (label) => document.querySelector('button[aria-label="' + label + '"]');
  const checkFooterWidths = async (state) => {
    await waitFor(() => document.querySelector('.sidebar').getAnimations()
      .every((animation) => animation.playState !== 'running'), '侧栏尺寸过渡完成');
    const guideWidth = button('使用文档').getBoundingClientRect().width;
    const settingsWidth = button('设置').getBoundingClientRect().width;
    check(state + '文档与设置等宽（' + guideWidth + '/' + settingsWidth + 'px）',
      guideWidth > 0 && Math.abs(guideWidth - settingsWidth) < 0.5);
  };
  await waitFor(() => button('测试页') && document.body.textContent.includes('插件更新可用')
    && requests.some((item) => item.body?.event === 'config_usage'), 'App 启动及后台检查');

  check('展开侧栏不显示加群按钮', !button('加群'));
  check('收到有效公告仍不展示公告弹窗', !document.querySelector('.remote-notice-card'));
  check('保留使用文档和设置入口', button('使用文档') && button('设置'));
  await checkFooterWidths('展开侧栏时');
  check('开发者模式的测试页保持可见', button('测试页'));
  check('保留插件更新提示及升级操作', document.body.textContent.includes('验证插件')
    && Array.from(document.querySelectorAll('button')).some((item) => item.textContent === '升级全部'));
  check('保留启动、页面及配置统计', ['app_open', 'page_view', 'config_usage']
    .every((event) => requests.some((item) => item.pathname === '/track' && item.body?.event === event)));
  check('未展示公告不误报送达', !requests.some((item) => item.pathname === '/notice/delivered'));

  button('收起菜单').click();
  await waitFor(() => button('展开菜单'), '侧栏收起');
  check('收起侧栏也不显示加群或二维码弹窗', !button('加群') && !document.querySelector('.group-chat-dialog'));
  await checkFooterWidths('收起侧栏时');
  button('展开菜单').click();
  await waitFor(() => button('收起菜单'), '侧栏展开');
  check('重新展开后加群入口仍隐藏', !button('加群'));
  await checkFooterWidths('重新展开侧栏后');

  button('投标机会').click();
  await waitFor(() => document.body.textContent.includes('正在开发中'), '业务提示');
  check('业务 Toast 提示及操作保留', document.body.textContent.includes('点此直达'));
  pluginListener([{ id: 'another-plugin', name: '后续通知插件', installedVersion: '2.0.0', version: '2.1.0' }]);
  await waitFor(() => document.body.textContent.includes('后续通知插件'), '插件事件提示');
  check('后续插件更新事件仍提示', document.body.textContent.includes('后续通知插件'));

  window.__yibiaoCheckRemoteNotice();
  await waitFor(() => noticeRequests === 2, '再次检查公告');
  check('后续公告仍隐藏且不误报送达', !document.querySelector('.remote-notice-card')
    && !requests.some((item) => item.pathname === '/notice/delivered'));
  root.unmount();
  check('卸载时清理插件监听及公告检查入口', !pluginListener && !window.__yibiaoCheckRemoteNotice);
  check('没有 Renderer 运行时错误', runtimeErrors.length === 0);
  return { results, runtimeErrors };
};
`;

app.whenReady().then(async () => {
  let window;
  try {
    const bundled = await build({
      stdin: { contents: fixture, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
      bundle: true,
      write: false,
      outdir: 'notice-smoke-output',
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    window = new BrowserWindow({ show: false, width: 1440, height: 920,
      webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'notice-smoke' } });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^https?:/.test(details.url) });
    });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<div id="root"></div>'));
    await window.webContents.insertCSS(bundled.outputFiles.find((file) => file.path.endsWith('.css')).text);
    const { results, runtimeErrors } = await window.webContents.executeJavaScript(
      bundled.outputFiles.find((file) => file.path.endsWith('.js')).text + '\nwindow.runNoticeSmoke();',
    );
    for (const result of results) console.log((result.passed ? 'PASS ' : 'FAIL ') + result.name);
    for (const error of runtimeErrors) console.error(error);
    app.exit(results.every((result) => result.passed) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
});
