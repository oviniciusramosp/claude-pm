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
import { ErrorDetailModal } from './components/error-detail-modal';
import { DebugErrorsModal } from './components/debug-errors-modal';
import { AuthProvider, useAuth } from './contexts/auth-context';
import { LoginPage } from './components/login-page';
import { useIsDesktop } from './hooks/use-is-desktop';
import { useNotifications } from './hooks/useNotifications';
import { NotificationsModal } from './components/notifications-modal';

// ── Error Boundary ──────────────────────────────────────────────────
// Catches uncaught errors in the React tree and renders a fallback UI
// instead of letting the entire tree unmount to an empty #root.

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-primary p-8">
          <div className="w-full max-w-lg rounded-xl border border-error-primary bg-primary p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-error-primary">Something went wrong</h2>
            <p className="mt-2 text-sm text-secondary">
              An unexpected error caused the panel to crash. Check the browser console for full details.
            </p>
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-secondary p-3 text-xs text-primary">
              {this.state.error?.message || 'Unknown error'}
              {this.state.error?.stack && (
                <>
                  {'\n\n'}
                  {this.state.error.stack}
                </>
              )}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              className="mt-4 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white hover:bg-brand-solid_hover"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App({ mode = 'light', themeMode = 'system', setThemeMode = (_m) => {} }) {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);

  return (
    <ErrorBoundary>
      <AuthProvider apiBaseUrl={apiBaseUrl}>
        <AppInner mode={mode} themeMode={themeMode} setThemeMode={setThemeMode} apiBaseUrl={apiBaseUrl} />
      </AuthProvider>
    </ErrorBoundary>
  );
}

function AppInner({ mode = 'light', themeMode = 'system', setThemeMode = (_m) => {}, apiBaseUrl }) {
  const { user, loading } = useAuth();
  const [serverInfo, setServerInfo] = useState(null);
  const [config, setConfig] = useState(buildInitialConfig);
  const [savedConfig, setSavedConfig] = useState(buildInitialConfig);
  const [activeTab, setActiveTab] = useState(NAV_TAB_KEYS.setup);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState({});
  const [saveConfirm, setSaveConfirm] = useState({ open: false, changedKeys: [] });
  const [revealedFields, setRevealedFields] = useState({});
  const [chatDraft, setChatDraft] = useState('');
  const [chatModel, setChatModel] = useState('claude-sonnet-4-5-20250929');
  const [serviceErrors, setServiceErrors] = useState({ app: null, api: null });
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('pm-sidebar-open');
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch { /* ignore */ }
    return window.innerWidth >= 1024;
  });
  const [collectedErrors, setCollectedErrors] = useState([]);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [boardRefreshTrigger, setBoardRefreshTrigger] = useState(0);
  const [fixingTaskId, setFixingTaskId] = useState(null);
  const [unreadFeedCount, setUnreadFeedCount] = useState(0);
  const logFeedRef = useRef(null);
  const didResolveInitialTabRef = useRef(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useNotifications();
  const handleLogEntryRef = useRef(notifications.handleLogEntry);
  useEffect(() => { handleLogEntryRef.current = notifications.handleLogEntry; }, [notifications.handleLogEntry]);

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

  const apiManagedByPanel = status?.api?.status === 'running';
  const apiRunning = apiManagedByPanel || status?.automationApi?.reachable === true;
  const orchestratorState = status?.automationApi?.health?.payload?.orchestrator || null;
  const isEpicRunning = useMemo(() => {
    return orchestratorState?.active && orchestratorState?.mode === 'epic';
  }, [orchestratorState]);
  const isPaused = orchestratorState?.paused === true;

  const disabledTabs = useMemo(() => {
    const disabled = new Set<string>();

    // Disable Feed, Board, Git if setup is incomplete
    if (!allFieldsValidated || hasBlockingErrors) {
      disabled.add(NAV_TAB_KEYS.feed);
      disabled.add(NAV_TAB_KEYS.board);
      disabled.add(NAV_TAB_KEYS.git);
    }

    return disabled;
  }, [allFieldsValidated, hasBlockingErrors]);

  // Persist active tab so it survives page refreshes
  useEffect(() => {
    if (!didResolveInitialTabRef.current) return;
    try { localStorage.setItem('pm_active_tab', activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // Persist sidebar open/closed preference
  useEffect(() => {
    try { localStorage.setItem('pm-sidebar-open', String(sidebarOpen)); } catch { /* ignore */ }
  }, [sidebarOpen]);

  // Sync sidebar state on desktop/mobile breakpoint transitions
  useEffect(() => {
    if (isDesktop) {
      try {
        const stored = localStorage.getItem('pm-sidebar-open');
        if (stored !== null) setSidebarOpen(stored === 'true');
      } catch { /* ignore */ }
    } else {
      setSidebarOpen(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (apiRunning) {
      setServiceErrors((prev) => (prev.app ? { ...prev, app: null } : prev));
    }
  }, [apiRunning]);

  // Fetch server info to check if auth is enabled
  useEffect(() => {
    fetch(`${apiBaseUrl}/api/server/info`)
      .then((res) => res.json())
      .then((data) => setServerInfo(data))
      .catch(() => {});
  }, [apiBaseUrl]);

  const onThemeChange = useCallback((newThemeMode) => {
    setThemeMode(newThemeMode);
  }, [setThemeMode]);

  const showToast = useCallback((message: string, color: 'success' | 'warning' | 'danger' | 'neutral' = 'success', duration: number | null = 30000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, color, duration }]);

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

  const onBoardError = useCallback((message: string, details?: { stack?: string; exitCode?: number; stderr?: string; stdout?: string }) => {
    const id = `board-err-${Date.now()}`;
    setCollectedErrors((prev) => [...prev, {
      id,
      ts: new Date().toISOString(),
      level: 'error',
      source: 'board',
      message,
      stack: details?.stack,
      exitCode: details?.exitCode,
      stderr: details?.stderr,
      stdout: details?.stdout
    }]);
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
          credentials: 'include',
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
      const storedTab = (() => { try { const t = localStorage.getItem('pm_active_tab'); return (t === 'feed' || t === 'board' || t === 'git') ? t : null; } catch { return null; } })();
      setActiveTab(isSetupConfigurationComplete(nextConfig) ? (storedTab ?? NAV_TAB_KEYS.board) : NAV_TAB_KEYS.setup);
      didResolveInitialTabRef.current = true;
    }
  }, [callApi]);

  const loadLogs = useCallback(async () => {
    const payload = await callApi('/api/logs');
    setLogs(payload.lines || []);
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
    // Skip bootstrap if auth is loading or if auth is required but user not authenticated
    if (loading || !serverInfo) return;
    if (serverInfo.authEnabled && !user) return;

    let canceled = false;

    async function bootstrap() {
      const results = await Promise.allSettled([loadConfig(), loadLogs(), refreshStatus(), loadWeeklyUsage()]);
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
          msg.includes('Reconciliation finished') ||
          msg.startsWith('Story created (')
        ) {
          setBoardRefreshTrigger((prev) => prev + 1);
        }

        if (msg.startsWith('Moved to Done:') || msg.startsWith('Epic moved to Done')) {
          loadWeeklyUsage().catch(() => {});
        }

        handleLogEntryRef.current(parsed);
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
  }, [apiBaseUrl, appendLog, loadConfig, loadLogs, loadWeeklyUsage, refreshStatus, showToast, loading, serverInfo, user]);

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
        body: JSON.stringify({ message, model: chatModel })
      });
      setChatDraft('');
    } catch (error) {
      showToast(`Could not send message to Claude: ${error.message}`, 'danger');
    } finally {
      setBusy((prev) => ({ ...prev, chat: false }));
    }
  }, [callApi, chatDraft, chatModel, showToast]);



  const copyLiveFeedMessage = useCallback(
    async (message) => {
      const text = String(message ?? '');
      if (!text.trim()) {
        showToast('Message is empty.', 'warning');
        return;
      }

      try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          showToast('Message copied');
        } else {
          // Fallback to legacy method
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-999999px';
          textarea.style.top = '-999999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const successful = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (successful) {
            showToast('Message copied');
          } else {
            throw new Error('Copy command failed');
          }
        }
      } catch (error) {
        showToast('Failed to copy message', 'danger');
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
          showToast('Saved and restarted API with latest configuration.', 'success');
        } else if (apiRunning) {
          showToast('Saved. Restart API to apply changes immediately.', 'warning');
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

  // Show loading state while checking auth or fetching server info
  if (loading || !serverInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  // Show login page if auth required and not authenticated
  if (serverInfo.authEnabled && !user) {
    return <LoginPage isDark={isDark} />;
  }

  return (
    <div
      className={cx(
        'flex h-full overflow-hidden transition-colors duration-300',
        isDark ? 'bg-linear-to-b from-gray-950 via-gray-900 to-gray-950' : 'bg-linear-to-b from-gray-50 via-white to-white'
      )}
    >
      {sidebarOpen && !isDesktop ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <SidebarNav
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          // Only auto-close sidebar on mobile — desktop users chose to keep it open
          if (!isDesktop) setSidebarOpen(false);
          // Clear unread count when switching to feed tab
          if (tab === NAV_TAB_KEYS.feed) {
            setUnreadFeedCount(0);
          }
        }}
        isDark={isDark}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        apiRunning={apiRunning}
        apiManagedByPanel={apiManagedByPanel}
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
        disabledTabs={disabledTabs}
        errorCount={collectedErrors.length}
        unreadFeedCount={unreadFeedCount}
        onDebugClick={() => setDebugModalOpen(true)}
        onNotificationsClick={() => setNotificationsOpen(true)}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        serverInfo={serverInfo}
      />

      <main className={cx('flex min-h-0 flex-1 flex-col overflow-hidden transition-[margin,max-width] duration-200', sidebarOpen && isDesktop ? 'ml-[280px] max-w-[calc(100vw-280px)]' : 'max-w-[100vw]')}>
        <div className="flex items-center gap-3 border-b border-secondary bg-primary/90 px-4 py-3 backdrop-blur-xl">
          <button
            type="button"
            className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          >
            <Menu01 className="size-5" />
          </button>
          <span className="text-sm font-semibold text-primary">PM Automation Panel</span>
        </div>

        <div className={cx(
          'flex w-full min-h-0 flex-1 flex-col px-4 sm:px-6 lg:px-8',
          activeTab === NAV_TAB_KEYS.feed ? 'overflow-hidden py-6' : 'overflow-y-auto py-6',
          'max-w-[1200px]'
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
              onError={onBoardError}
              setFixingTaskId={setFixingTaskId}
              setupComplete={allFieldsValidated && !hasBlockingErrors}
              onNavigateToSetup={() => setActiveTab(NAV_TAB_KEYS.setup)}
            />
          ) : activeTab === NAV_TAB_KEYS.git ? (
            <GitTab
              apiBaseUrl={apiBaseUrl}
              showToast={showToast}
              refreshTrigger={boardRefreshTrigger}
              setupComplete={allFieldsValidated && !hasBlockingErrors}
              onNavigateToSetup={() => setActiveTab(NAV_TAB_KEYS.setup)}
            />
          ) : (
            <FeedTab
              logs={logs}
              logFeedRef={logFeedRef}
              chatDraft={chatDraft}
              setChatDraft={setChatDraft}
              chatModel={chatModel}
              setChatModel={setChatModel}
              sendClaudeChatMessage={sendClaudeChatMessage}
              copyLiveFeedMessage={copyLiveFeedMessage}
              busy={busy}
              orchestratorState={orchestratorState}
              fixingTaskId={fixingTaskId}
              apiBaseUrl={apiBaseUrl}
              showToast={showToast}
              onShowErrorDetail={(title, message) => setErrorModal({ open: true, title, message })}
              refreshTrigger={boardRefreshTrigger}
              setupComplete={allFieldsValidated && !hasBlockingErrors}
              onNavigateToSetup={() => setActiveTab(NAV_TAB_KEYS.setup)}
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

      <NotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        settings={notifications.settings}
        browserPermission={notifications.browserPermission}
        onSettingChange={notifications.updateSettings}
        onRequestPermission={notifications.requestBrowserPermission}
        onPreviewTaskDone={notifications.previewTaskDone}
        onPreviewEpicDone={notifications.previewEpicDone}
        onPreviewError={notifications.previewError}
      />

      <ToastNotification
        toasts={toasts}
        onDismiss={dismissToast}
      />
    </div>
  );
}
