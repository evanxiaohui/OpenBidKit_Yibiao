import { useEffect, useRef } from 'react';
import { useToast } from '../shared/ui';
import type { PluginUpdateInfo } from '../shared/types/ipc';

const backgroundPollIntervalMs = 30 * 60 * 1000;

function PluginUpdateNotifier() {
  const { showToast, dismissToast } = useToast();
  const pluginCheckingRef = useRef(false);
  const pluginUpdateRunningRef = useRef(false);
  const promptedPluginUpdatesRef = useRef(new Set<string>());

  useEffect(() => {
    let disposed = false;

    const promptPluginUpdates = (updates: PluginUpdateInfo[]) => {
      if (disposed || updates.length === 0) return;
      const signature = updates
        .map((plugin) => `${plugin.id}@${plugin.version}`)
        .sort()
        .join('|');
      if (promptedPluginUpdatesRef.current.has(signature)) return;
      promptedPluginUpdatesRef.current.add(signature);

      const pluginSummary = updates
        .map((plugin) => `${plugin.name} ${plugin.installedVersion} → ${plugin.version}`)
        .join('；');
      showToast(`发现 ${updates.length} 个插件可升级：${pluginSummary}`, 'info', {
        title: '插件更新可用',
        persistent: true,
        actions: [
          {
            label: '升级全部',
            variant: 'primary',
            onClick: async () => {
              if (pluginUpdateRunningRef.current) return;
              pluginUpdateRunningRef.current = true;
              const progressToastId = showToast(`正在升级 ${updates.length} 个插件，请稍候...`, 'info', {
                title: '正在升级插件',
                persistent: true,
              });
              try {
                const result = await window.yibiao?.plugins.updateAll();
                dismissToast(progressToastId);
                window.dispatchEvent(new Event('yibiao:plugins-changed'));
                if (!result || result.results.length === 0) {
                  showToast('插件已是最新版本', 'success');
                  return;
                }

                const succeeded = result.results.filter((item) => item.success);
                const failed = result.results.filter((item) => !item.success);
                if (failed.length === 0) {
                  showToast(`已成功升级 ${succeeded.length} 个插件，无需重启软件。`, 'success');
                  return;
                }

                const failedNames = failed.map((item) => item.name).join('、');
                showToast(`成功 ${succeeded.length} 个，失败 ${failed.length} 个：${failedNames}`, 'error', {
                  title: '插件升级完成',
                });
              } catch (error) {
                dismissToast(progressToastId);
                window.dispatchEvent(new Event('yibiao:plugins-changed'));
                showToast(error instanceof Error ? error.message : '批量升级插件失败', 'error');
              } finally {
                pluginUpdateRunningRef.current = false;
              }
            },
          },
          { label: '稍后' },
        ],
      });
    };

    const unsubscribePluginUpdates = window.yibiao?.onPluginUpdatesAvailable(promptPluginUpdates);

    const checkPluginUpdates = async () => {
      if (pluginCheckingRef.current) return;
      pluginCheckingRef.current = true;
      try {
        const updates = await window.yibiao?.plugins.checkUpdates();
        if (updates) promptPluginUpdates(updates);
      } catch {
        // 插件更新检查失败不打扰用户。
      } finally {
        pluginCheckingRef.current = false;
      }
    };

    void checkPluginUpdates();
    const timer = window.setInterval(() => {
      void checkPluginUpdates();
    }, backgroundPollIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribePluginUpdates?.();
    };
  }, [dismissToast, showToast]);

  return null;
}

export default PluginUpdateNotifier;
