import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock, Menu01, X } from '@untitledui/icons';
import { cx } from '@/utils/cx';

import {
  TEXT_FIELD_CONFIG,
  TEXT_FIELD_KEYS,
  TOGGLE_KEYS,
  NAV_TAB_KEYS,
  CLAUDE_CHAT_MAX_CHARS
} from './constants';

import {
  boolToEnv,
  normalizeText,
  buildInitialConfig,
  parseConfigPayload,
  parseRuntimeSettingsPayload,
  isSameConfigValue,
  isSetupConfigurationComplete,
  validateFieldValue,
  resolveApiBaseUrl
} from './utils/config-helpers';

import { normalizeLogLevel } from './utils/log-helpers';
import { ToastNotification } from './components/toast-notification';
import { SidebarNav } from './components/sidebar-nav';
import { SetupTab } from './components/setup-tab';
import { FeedTab } from './components/feed-tab';
import { BoardTab } from './components/board-tab';
import { GitTab } from './components/git-tab';
import { SaveConfirmModal } from './components/save-confirm-modal';
import { RuntimeSettingsModal } from './components/runtime-settings-modal';
import { ErrorDetailModal } from './components/error-detail-modal';
import { DebugErrorsModal } from './components/debug-errors-modal';

export function App({ mode = 'light', setMode = () => {} }) {
  const [config, setConfig] = useState(buildInitialConfig);
  const [savedConfig, setSavedConfig] = useState(buildInitialConfig);
  const [activeTab, setActiveTab] = useState(NAV_TAB_KEYS.setup);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [runtimeSettings, setRuntimeSettings] = useState({ streamOutput: false, logPrompt: true });
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState({});
  const [saveConfirm, setSaveConfirm] = useState({ open: false, changedKeys: [] });
  const [revealedFields, setRevealedFields] = useState({});
  const [runtimeSettingsModalOpen, setRuntimeSettingsModalOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [serviceErrors, setServiceErrors] = useState({ app: null, api: null });
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collectedErrors, setCollectedErrors] = useState([]);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [boardRefreshTrigger, setBoardRefreshTrigger] = useState(0);
  const [fixingTaskId, setFixingTaskId] = useState(null);
  const [unreadFeedCount, setUnreadFeedCount] = useState(0);
  const logFeedRef = useRef(null);
  const didResolveInitialTabRef = useRef(false);

  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const currentMode = mode || 'light';
  const isDark = currentMode === 'dark';
  const validationMap = useMemo(() => {
    const map = {};
    for (const field of TEXT_FIELD_CONFIG) {
      map[field.key] = validateFieldValue(field.key, config[field.key]);
    }
    return map;
  }, [config]);

  const hasBlockingErrors = useMemo(() => TEXT_FIELD_KEYS.some((key) => validationMap[key]?.level === 'error'), [validationMap]);

  const changedKeys = useMemo(() => {
    const allKeys = [...TEXT_FIELD_KEYS, ...TOGGLE_KEYS];
    return allKeys.filter((key) => !isSameConfigValue(key, config[key], savedConfig[key]));
  }, [config, savedConfig]);

  const allFieldsValidated = useMemo(() => TEXT_FIELD_KEYS.every((key) => validationMap[key]?.level === 'success'), [validationMap]);
  const saveDisabled = hasBlockingErrors || !allFieldsValidated || changedKeys.length === 0 || Boolean(busy.save);

  const apiRunning = status?.api?.status === 'running';
  const orchestratorState = status?.automationApi?.health?.payload?.orchestrator || null;
  const isEpicRunning = useMemo(() => {
    return orchestratorState?.active && orchestratorState?.mode === 'epic';
  }, [orchestratorState]);
  const isPaused = orchestratorState?.paused === true;

  const disabledTabs = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    if (apiRunning) {
      setServiceErrors((prev) => (prev.app ? { ...prev, app: null } : prev));
    }
  }, [apiRunning]);

  const onThemeToggle = useCallback(() => {
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  const showToast = useCallback((message: string, color: 'success' | 'warning' | 'danger' | 'neutral' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, color }]);

    if (color === 'danger') {
      setCollectedErrors((prev) => [...prev, {
        id,
        ts: new Date().toISOString(),
        level: 'error',
        source: 'panel',
        message
      }]);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const appendLog = useCallback((entry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > 900) {
        return next.slice(next.length - 900);
      }
      return next;
    });

    if (normalizeLogLevel(entry?.level) === 'error') {
      setCollectedErrors((prev) => [...prev, entry]);
    }
  }, []);



  const callApi = useCallback(
    async (path, options = {}) => {
      const url = `${apiBaseUrl}${path}`;

      let response;
      try {
        response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json'
          },
          ...options
        });
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error(
            `Failed to reach panel API at ${apiBaseUrl || window.location.origin}. If you are using panel:dev, run npm run panel too.`
          );
        }

        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json().catch(() => ({})) : await response.text().catch(() => '');

      if (!response.ok) {
        if (typeof payload === 'string' && payload.trim()) {
          throw new Error(payload.trim());
        }

        const message = payload?.message || payload?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }

      return payload;
    },
    [apiBaseUrl]
  );

  const refreshStatus = useCallback(async () => {
    const payload = await callApi('/api/status');
    setStatus(payload);
  }, [callApi]);

  const loadConfig = useCallback(async () => {
    const payload = await callApi('/api/config');
    const nextConfig = parseConfigPayload(payload.values || {});
    setConfig(nextConfig);
    setSavedConfig(nextConfig);
    if (!didResolveInitialTabRef.current) {
      setActiveTab(isSetupConfigurationComplete(nextConfig) ? NAV_TAB_KEYS.feed : NAV_TAB_KEYS.setup);
      didResolveInitialTabRef.current = true;
    }
  }, [callApi]);

  const loadLogs = useCallback(async () => {
    const payload = await callApi('/api/logs');
    setLogs(payload.lines || []);
  }, [callApi]);

  const loadRuntimeSettings = useCallback(async () => {
    const payload = await callApi('/api/automation/runtime');
    setRuntimeSettings(parseRuntimeSettingsPayload(payload));
  }, [callApi]);

  const loadWeeklyUsage = useCallback(async () => {
    try {
      const payload = await callApi('/api/usage/weekly');
      setWeeklyUsage(payload);
    } catch {
      // Silent failure — widget just shows empty state
    }
  }, [callApi]);

  useEffect(() => {
    let canceled = false;

    async function bootstrap() {
      const results = await Promise.allSettled([loadConfig(), loadLogs(), loadRuntimeSettings(), refreshStatus(), loadWeeklyUsage()]);
      if (canceled) return;
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === results.length) {
        showToast(`Failed to load panel data: ${failed[0].reason?.message || 'unknown error'}`, 'danger');
      }
    }

    bootstrap();

    const streamUrl = `${apiBaseUrl}/api/logs/stream`;
    const events = new EventSource(streamUrl);
    events.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        appendLog(parsed);
        refreshStatus().catch(() => {});

        // Increment unread counter if not on feed tab
        if (activeTab !== NAV_TAB_KEYS.feed) {
          setUnreadFeedCount((prev) => prev + 1);
        }

        const msg = String(parsed.message || '');
        if (
          msg.startsWith('Moved to In Progress:') ||
          msg.startsWith('Moved to Done:') ||
          msg.startsWith('Returned to Not Started') ||
          msg.startsWith('Epic moved to Done') ||
          msg.startsWith('Resuming In Progress task:') ||
          msg.includes('Reconciliation finished')
        ) {
          setBoardRefreshTrigger((prev) => prev + 1);
        }

        if (msg.startsWith('Moved to Done:') || msg.startsWith('Epic moved to Done')) {
          loadWeeklyUsage().catch(() => {});
        }
      } catch {
        // Ignore malformed event.
      }
    };

    events.onerror = () => {
      // Keep SSE silent; status polling continues.
    };

    const interval = setInterval(() => {
      refreshStatus().catch(() => {});
    }, 5000);

    const usageInterval = setInterval(() => {
      loadWeeklyUsage().catch(() => {});
    }, 60000);

    return () => {
      canceled = true;
      clearInterval(interval);
      clearInterval(usageInterval);
      events.close();
    };
  }, [apiBaseUrl, appendLog, loadConfig, loadLogs, loadRuntimeSettings, loadWeeklyUsage, refreshStatus, showToast]);

  const runAction = useCallback(
    async (key, endpoint, successMessage) => {
      setBusy((prev) => ({ ...prev, [key]: true }));

      const isAppAction = key === 'startApi' || key === 'stopApi';
      if (isAppAction) {
        setServiceErrors((prev) => ({ ...prev, app: null }));
      }

      try {
        await callApi(endpoint, {
          method: 'POST',
          body: '{}'
        });
        showToast(successMessage);
        await refreshStatus();
      } catch (error) {
        const errorMessage = error.message || String(error);
        showToast(`Action failed: ${errorMessage}`, 'danger');

        if (isAppAction) {
          setServiceErrors((prev) => ({ ...prev, app: errorMessage }));
          setErrorModal({ open: true, title: 'App failed to start', message: errorMessage });
        }
      } finally {
        setBusy((prev) => ({ ...prev, [key]: false }));
      }
    },
    [callApi, refreshStatus, showToast]
  );

  const sendClaudeChatMessage = useCallback(async () => {
    const message = normalizeText(chatDraft);

    if (!message) {
      showToast('Type a message before sending.', 'warning');
      return;
    }

    if (message.length > CLAUDE_CHAT_MAX_CHARS) {
      showToast(`Message too long (${CLAUDE_CHAT_MAX_CHARS} chars max).`, 'danger');
      return;
    }

    setBusy((prev) => ({ ...prev, chat: true }));
    try {
      await callApi('/api/claude/chat', {
        method: 'POST',
        body: JSON.stringify({ message, model: config.CLAUDE_MODEL_OVERRIDE || undefined })
      });
      setChatDraft('');
    } catch (error) {
      showToast(`Could not send message to Claude: ${error.message}`, 'danger');
    } finally {
      setBusy((prev) => ({ ...prev, chat: false }));
    }
  }, [callApi, chatDraft, config.CLAUDE_MODEL_OVERRIDE, showToast]);



  const copyLiveFeedMessage = useCallback(
    async (message) => {
      const text = String(message ?? '');
      if (!text.trim()) {
        showToast('Message is empty.', 'warning');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showToast('Message copied');
      } catch (error) {
        showToast(`Failed to copy message: ${error.message}`, 'danger');
      }
    },
    [showToast]
  );

  const pickClaudeWorkdir = useCallback(async () => {
    setBusy((prev) => ({ ...prev, pickWorkdir: true }));

    try {
      const payload = await callApi('/api/system/select-directory', {
        method: 'POST',
        body: '{}'
      });

      if (payload?.path) {
        setConfig((prev) => ({ ...prev, CLAUDE_WORKDIR: payload.path }));
        showToast(`Folder selected: ${payload.path}`);
      }
    } catch (error) {
      if (error.message.toLowerCase().includes('canceled')) {
        showToast('Folder selection canceled.', 'neutral');
        return;
      }

      if (error.message.includes('Failed to reach panel API')) {
        const manualPath = window.prompt(
          'Could not open native folder picker because the panel API is not reachable. Paste CLAUDE_WORKDIR path manually:'
        );
        if (manualPath && manualPath.trim()) {
          setConfig((prev) => ({ ...prev, CLAUDE_WORKDIR: manualPath.trim() }));
          showToast('Folder path set manually.', 'success');
          return;
        }
      }

      showToast(`Could not choose folder: ${error.message}`, 'danger');
    } finally {
      setBusy((prev) => ({ ...prev, pickWorkdir: false }));
    }
  }, [callApi, showToast]);

  const updateRuntimeSetting = useCallback(
    async (settingKey, checked) => {
      const busyKey = `runtime_${settingKey}`;
      setBusy((prev) => ({ ...prev, [busyKey]: true }));

      try {
        const next = {
          ...runtimeSettings,
          [settingKey]: checked
        };

        await callApi('/api/automation/runtime', {
          method: 'POST',
          body: JSON.stringify({
            claude: {
              streamOutput: next.streamOutput,
              logPrompt: next.logPrompt
            }
          })
        });

        setRuntimeSettings(next);
        showToast('Runtime Claude settings updated.', 'success');
      } catch (error) {
        showToast(`Could not update runtime settings: ${error.message}`, 'danger');
      } finally {
        setBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [callApi, runtimeSettings, showToast]
  );


  const persistConfig = useCallback(
    async ({ restartApi }) => {
      setBusy((prev) => ({ ...prev, save: true }));

      try {
        const updates = {};

        for (const key of TEXT_FIELD_KEYS) {
          updates[key] = config[key] || '';
        }

        for (const key of TOGGLE_KEYS) {
          updates[key] = boolToEnv(Boolean(config[key]));
        }

        await callApi('/api/config', {
          method: 'POST',
          body: JSON.stringify(updates)
        });

        if (restartApi) {
          await callApi('/api/process/api/restart', {
            method: 'POST',
            body: '{}'
          });
          showToast('Saved and restarted app with latest configuration.', 'success');
        } else if (apiRunning) {
          showToast('Saved. Restart app to apply changes immediately.', 'warning');
        } else {
          showToast('Saved successfully.', 'success');
        }

        setSavedConfig({ ...config });
        await refreshStatus();
      } catch (error) {
        showToast(`Failed to save: ${error.message}`, 'danger');
      } finally {
        setBusy((prev) => ({ ...prev, save: false }));
      }
    },
    [apiRunning, callApi, config, refreshStatus, showToast]
  );

  const onSaveClick = useCallback(async () => {
    if (hasBlockingErrors) {
      showToast('Please fix required fields before saving.', 'danger');
      return;
    }

    if (!allFieldsValidated) {
      showToast('Please validate all fields before saving.', 'warning');
      return;
    }

    if (changedKeys.length === 0) {
      showToast('No changes to save.', 'neutral');
      return;
    }

    if (apiRunning) {
      setSaveConfirm({ open: true, changedKeys });
      return;
    }

    await persistConfig({ restartApi: false });
  }, [allFieldsValidated, apiRunning, changedKeys, hasBlockingErrors, persistConfig, showToast]);

  const apiHealthStatus = useMemo(() => {
    if (!status?.automationApi) {
      return {
        label: 'Checking',
        color: 'gray',
        icon: Clock,
        connectionState: 'pending'
      };
    }

    if (status.automationApi.reachable) {
      setServiceErrors((prev) => (prev.api ? { ...prev, api: null } : prev));
      return {
        label: 'Online',
        color: 'success',
        icon: Check,
        connectionState: 'active'
      };
    }

    if (apiRunning) {
      const apiErr = status.automationApi.error || 'API is not reachable';
      setServiceErrors((prev) => (prev.api !== apiErr ? { ...prev, api: apiErr } : prev));
    }

    return {
      label: 'Offline',
      color: 'error',
      icon: X,
      connectionState: 'inactive'
    };
  }, [status, apiRunning]);

  const toggleFieldVisibility = useCallback((fieldKey) => {
    setRevealedFields((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey]
    }));
  }, []);

  return (
    <div
      className={cx(
        'flex min-h-screen transition-colors duration-300',
        isDark ? 'bg-linear-to-b from-gray-950 via-gray-900 to-gray-950' : 'bg-linear-to-b from-utility-brand-50 via-secondary to-primary'
      )}
    >
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <SidebarNav
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setSidebarOpen(false);
          // Clear unread count when switching to feed tab
          if (tab === NAV_TAB_KEYS.feed) {
            setUnreadFeedCount(0);
          }
        }}
        isDark={isDark}
        onThemeToggle={onThemeToggle}
        apiRunning={apiRunning}
        isPaused={isPaused}
        isEpicRunning={isEpicRunning}
        apiHealthStatus={apiHealthStatus}
        busy={busy}
        runAction={runAction}
        appError={serviceErrors.app}
        apiError={serviceErrors.api}
        onAppBadgeClick={() => {
          if (serviceErrors.app) {
            setErrorModal({ open: true, title: 'App error', message: serviceErrors.app });
          }
        }}
        onApiBadgeClick={() => {
          if (serviceErrors.api) {
            setErrorModal({ open: true, title: 'API error', message: serviceErrors.api });
          }
        }}
        setRuntimeSettingsModalOpen={setRuntimeSettingsModalOpen}
        disabledTabs={disabledTabs}
        errorCount={collectedErrors.length}
        unreadFeedCount={unreadFeedCount}
        onDebugClick={() => setDebugModalOpen(true)}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <main className="flex h-screen flex-1 flex-col lg:ml-[280px]">
        <div className="flex items-center gap-3 border-b border-secondary bg-primary/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu01 className="size-5" />
          </button>
          <span className="text-sm font-semibold text-primary">PM Automation Panel</span>
        </div>

        <div className={cx(
          'mx-auto flex w-full min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:px-8',
          activeTab === NAV_TAB_KEYS.board ? 'max-w-[1600px]' : 'max-w-[1200px]'
        )}>
          {activeTab === NAV_TAB_KEYS.setup ? (
            <SetupTab
              config={config}
              setConfig={setConfig}
              validationMap={validationMap}
              revealedFields={revealedFields}
              toggleFieldVisibility={toggleFieldVisibility}
              busy={busy}
              pickClaudeWorkdir={pickClaudeWorkdir}
              saveDisabled={saveDisabled}
              hasBlockingErrors={hasBlockingErrors}
              allFieldsValidated={allFieldsValidated}
              changedKeys={changedKeys}
              onSaveClick={onSaveClick}
              apiBaseUrl={apiBaseUrl}
            />
          ) : activeTab === NAV_TAB_KEYS.board ? (
            <BoardTab
              apiBaseUrl={apiBaseUrl}
              showToast={showToast}
              refreshTrigger={boardRefreshTrigger}
              onShowErrorDetail={(title, message) => setErrorModal({ open: true, title, message })}
              setFixingTaskId={setFixingTaskId}
            />
          ) : activeTab === NAV_TAB_KEYS.git ? (
            <GitTab
              apiBaseUrl={apiBaseUrl}
              showToast={showToast}
              refreshTrigger={boardRefreshTrigger}
            />
          ) : (
            <FeedTab
              logs={logs}
              logFeedRef={logFeedRef}
              chatDraft={chatDraft}
              setChatDraft={setChatDraft}
              sendClaudeChatMessage={sendClaudeChatMessage}
              copyLiveFeedMessage={copyLiveFeedMessage}
              busy={busy}
              orchestratorState={orchestratorState}
              fixingTaskId={fixingTaskId}
            />
          )}
        </div>
      </main>

      <SaveConfirmModal
        saveConfirm={saveConfirm}
        setSaveConfirm={setSaveConfirm}
        busy={busy}
        persistConfig={persistConfig}
      />

      <RuntimeSettingsModal
        runtimeSettingsModalOpen={runtimeSettingsModalOpen}
        setRuntimeSettingsModalOpen={setRuntimeSettingsModalOpen}
        apiRunning={apiRunning}
        runtimeSettings={runtimeSettings}
        busy={busy}
        updateRuntimeSetting={updateRuntimeSetting}
      />

      <ErrorDetailModal
        open={errorModal.open}
        onClose={() => setErrorModal({ open: false, title: '', message: '' })}
        title={errorModal.title}
        errorMessage={errorModal.message}
      />

      <DebugErrorsModal
        open={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        errors={collectedErrors}
        onClear={() => { setCollectedErrors([]); }}
        onCopy={async () => {
          if (collectedErrors.length === 0) return;
          const text = collectedErrors
            .map((e) => {
              const lines = [
                `[${e.ts || ''}] [${String(e.source || 'unknown').toUpperCase()}]`,
                `Message: ${e.message || ''}`,
              ];
              if (e.exitCode !== undefined && e.exitCode !== null) {
                lines.push(`Exit Code: ${e.exitCode}`);
              }
              if (e.signal) {
                lines.push(`Signal: ${e.signal}`);
              }
              if (e.stderr) {
                lines.push(`\nStderr:\n${e.stderr}`);
              }
              if (e.stdout) {
                lines.push(`\nStdout:\n${e.stdout}`);
              }
              if (e.stack) {
                lines.push(`\nStack Trace:\n${e.stack}`);
              }
              return lines.join('\n');
            })
            .join('\n\n---\n\n');
          try {
            await navigator.clipboard.writeText(text);
            showToast('Errors copied to clipboard.');
          } catch (err) {
            showToast('Failed to copy errors.', 'danger');
          }
        }}
      />

      <ToastNotification
        toasts={toasts}
        onDismiss={dismissToast}
      />
    </div>
  );
}
