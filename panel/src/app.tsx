import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Asterisk02,
  ArrowUpRight,
  Check,
  Clock,
  Copy01,
  Eye,
  EyeOff,
  File03,
  Flash,
  Folder,
  HelpCircle,
  LinkExternal01,
  Moon01,
  PlayCircle,
  Save01,
  Send01,
  Server01,
  Settings01,
  StopCircle,
  Sun,
  TerminalBrowser,
  Toggle01Right,
  X
} from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Tabs } from '@/components/application/tabs/tabs';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { cx } from '@/utils/cx';

// Constants
import {
  TEXT_FIELD_CONFIG,
  TOGGLE_CONFIG,
  TEXT_FIELD_KEYS,
  TOGGLE_KEYS,
  TEXT_FIELD_BY_KEY,
  TOGGLE_BY_KEY,
  SETUP_SECTIONS,
  LABEL_BY_KEY,
  NAV_TAB_KEYS,
  CLAUDE_CHAT_MAX_CHARS,
  PROCESS_ACTION_BUTTON_CLASS
} from './constants';

// Utilities
import {
  envToBool,
  boolToEnv,
  normalizeText,
  buildInitialConfig,
  parseConfigPayload,
  parseRuntimeSettingsPayload,
  isSameConfigValue,
  isSetupConfigurationComplete,
  validateFieldValue,
  buildNotionDatabaseUrl,
  resolveApiBaseUrl
} from './utils/config-helpers';

import {
  normalizeLogLevel,
  logLevelMeta,
  logSourceMeta,
  logToneClasses,
  formatLiveFeedMessage,
  formatFeedTimestamp,
  helpTooltipContent
} from './utils/log-helpers';

// Components
import { Icon } from './components/icon';
import { StatusBadge } from './components/status-badge';
import { SourceAvatar } from './components/source-avatar';
import { ToastNotification } from './components/toast-notification';

export function App({ mode = 'light', setMode = () => {} }) {
  const [config, setConfig] = useState(buildInitialConfig);
  const [savedConfig, setSavedConfig] = useState(buildInitialConfig);
  const [activeTab, setActiveTab] = useState(NAV_TAB_KEYS.setup);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [runtimeSettings, setRuntimeSettings] = useState({ streamOutput: false, logPrompt: true });
  const [toast, setToast] = useState({ open: false, message: '', color: 'success' });
  const [busy, setBusy] = useState({});
  const [saveConfirm, setSaveConfirm] = useState({ open: false, changedKeys: [] });
  const [revealedFields, setRevealedFields] = useState({});
  const [runtimeSettingsModalOpen, setRuntimeSettingsModalOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const logFeedRef = useRef(null);
  const didResolveInitialTabRef = useRef(false);

  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const currentMode = mode || 'light';
  const isDark = currentMode === 'dark';
  const notionDatabaseUrl = useMemo(() => buildNotionDatabaseUrl(config.NOTION_DATABASE_ID), [config.NOTION_DATABASE_ID]);

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

  const onThemeToggle = useCallback(() => {
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  const showToast = useCallback((message, color = 'success') => {
    setToast({ open: true, message, color });
  }, []);

  useEffect(() => {
    if (!toast.open) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setToast((prev) => ({ ...prev, open: false }));
    }, 2600);

    return () => clearTimeout(timeout);
  }, [toast.open]);

  const appendLog = useCallback((entry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > 900) {
        return next.slice(next.length - 900);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!logFeedRef.current) {
      return;
    }

    logFeedRef.current.scrollTop = logFeedRef.current.scrollHeight;
  }, [logs]);

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
      setActiveTab(isSetupConfigurationComplete(nextConfig) ? NAV_TAB_KEYS.operations : NAV_TAB_KEYS.setup);
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

  useEffect(() => {
    let canceled = false;

    async function bootstrap() {
      try {
        await Promise.all([loadConfig(), loadLogs(), loadRuntimeSettings(), refreshStatus()]);
      } catch (error) {
        if (!canceled) {
          showToast(`Failed to load panel data: ${error.message}`, 'danger');
        }
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

    return () => {
      canceled = true;
      clearInterval(interval);
      events.close();
    };
  }, [apiBaseUrl, appendLog, loadConfig, loadLogs, loadRuntimeSettings, refreshStatus, showToast]);

  const runAction = useCallback(
    async (key, endpoint, successMessage) => {
      setBusy((prev) => ({ ...prev, [key]: true }));
      try {
        await callApi(endpoint, {
          method: 'POST',
          body: '{}'
        });
        showToast(successMessage);
        await refreshStatus();
      } catch (error) {
        showToast(`Action failed: ${error.message}`, 'danger');
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
        body: JSON.stringify({ message })
      });
      setChatDraft('');
    } catch (error) {
      showToast(`Could not send message to Claude: ${error.message}`, 'danger');
    } finally {
      setBusy((prev) => ({ ...prev, chat: false }));
    }
  }, [callApi, chatDraft, showToast]);

  const onChatDraftKeyDown = useCallback(
    async (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      await sendClaudeChatMessage();
    },
    [sendClaudeChatMessage]
  );

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
      return {
        label: 'Online',
        color: 'success',
        icon: Check,
        connectionState: 'active'
      };
    }

    return {
      label: 'Offline',
      color: 'error',
      icon: X,
      connectionState: 'inactive'
    };
  }, [status]);

  const toggleFieldVisibility = useCallback((fieldKey) => {
    setRevealedFields((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey]
    }));
  }, []);

  return (
    <div
      className={cx(
        'min-h-screen transition-colors duration-300',
        isDark ? 'bg-linear-to-b from-gray-950 via-gray-900 to-gray-950' : 'bg-linear-to-b from-utility-brand-50 via-secondary to-primary'
      )}
    >
      <header className="fixed inset-x-0 top-0 z-50 border-b border-secondary bg-primary/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-primary">
              <Icon icon={Asterisk02} className="size-5" />
              PM Automation Panel
            </h1>
            <p className="m-0 max-w-2xl text-xs leading-4 text-tertiary">
              Configure, run and monitor your Notion + Claude automation from one panel.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              role="tablist"
              aria-label="Panel sections"
              className="inline-flex items-center rounded-lg border border-secondary bg-secondary p-1"
            >
              <Button
                size="sm"
                color={activeTab === NAV_TAB_KEYS.setup ? 'primary' : 'secondary'}
                className="h-9"
                iconLeading={Settings01}
                aria-pressed={activeTab === NAV_TAB_KEYS.setup}
                onPress={() => setActiveTab(NAV_TAB_KEYS.setup)}
              >
                Setup
              </Button>
              <Button
                size="sm"
                color={activeTab === NAV_TAB_KEYS.operations ? 'primary' : 'secondary'}
                className="h-9"
                iconLeading={Toggle01Right}
                aria-pressed={activeTab === NAV_TAB_KEYS.operations}
                onPress={() => setActiveTab(NAV_TAB_KEYS.operations)}
              >
                Operations & Feed
              </Button>
            </div>

            <Button
              size="md"
              color="secondary"
              iconLeading={isDark ? Sun : Moon01}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              onPress={onThemeToggle}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 pb-5 pt-28 sm:px-6 sm:pt-24 lg:px-8">
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(nextValue) => {
            if (nextValue) {
              setActiveTab(String(nextValue));
            }
          }}
          className="gap-4"
        >
          <Tabs.Panel id={NAV_TAB_KEYS.setup} className="pt-2">
            <section className="rounded-2xl border border-secondary bg-primary p-5 shadow-sm">
              <div className="space-y-2">
                <h2 className="m-0 inline-flex items-center gap-2 text-xl font-semibold text-primary">
                  <Icon icon={Settings01} className="size-5" />
                  Setup Configuration
                </h2>
                <p className="m-0 text-sm text-tertiary">These values are persisted in your local <code>.env</code> file.</p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {SETUP_SECTIONS.map((section) => (
                  <div key={section.key} className="rounded-xl border border-secondary bg-secondary p-4">
                    <div className="mb-3 space-y-1">
                      <h3 className="m-0 text-md font-semibold text-primary">{section.title}</h3>
                      <p className="m-0 text-sm text-tertiary">{section.description}</p>
                    </div>

                    {section.textKeys.length > 0 ? (
                      <div className="space-y-3">
                        {section.textKeys.map((fieldKey) => {
                          const field = TEXT_FIELD_BY_KEY[fieldKey];
                          if (!field) {
                            return null;
                          }

                          const validation = validationMap[field.key] || { level: 'neutral', message: '' };
                          const isSecretField = Boolean(field.password);
                          const isFieldVisible = Boolean(revealedFields[field.key]);
                          const hasInlineValidationIcon =
                            validation.level === 'success' || validation.level === 'error' || validation.level === 'warning';
                          const validationStatusLabel =
                            validation.level === 'success' ? 'Success' : validation.level === 'error' ? 'Error' : validation.level === 'warning' ? 'Warning' : '';
                          const hasInlineActions = isSecretField || field.key === 'NOTION_DATABASE_ID' || field.folderPicker;

                          return (
                            <div key={field.key} className="space-y-3 rounded-xl border border-secondary bg-primary p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                                  <Icon icon={field.icon} className="size-4 text-fg-quaternary" />
                                  {field.label}
                                </p>

                                <Tooltip title={field.help?.title || field.label} description={helpTooltipContent(field.description, field.help)} placement="top end">
                                  <TooltipTrigger aria-label={`Help for ${field.label}`} className="rounded-md p-1 text-fg-quaternary hover:text-fg-quaternary_hover">
                                    <HelpCircle className="size-4" />
                                  </TooltipTrigger>
                                </Tooltip>
                              </div>

                              <div className="flex items-stretch gap-2">
                                <div className="relative min-w-0 flex-1">
                                  <Input
                                    size="md"
                                    aria-label={field.label}
                                    type={isSecretField && !isFieldVisible ? 'password' : 'text'}
                                    placeholder={field.placeholder}
                                    wrapperClassName="h-11"
                                    inputClassName={hasInlineValidationIcon ? 'pr-9' : undefined}
                                    tooltipClassName={validation.level === 'error' ? 'hidden' : undefined}
                                    value={config[field.key] || ''}
                                    isInvalid={validation.level === 'error'}
                                    onChange={(value) => {
                                      const nextValue = value || '';
                                      setConfig((prev) => ({ ...prev, [field.key]: nextValue }));
                                    }}
                                  />
                                  {hasInlineValidationIcon ? (
                                    <Tooltip title={validationStatusLabel} description={validation.message || undefined} placement="top">
                                      <TooltipTrigger
                                        aria-label={`${field.label} ${validationStatusLabel.toLowerCase()}`}
                                        className={cx(
                                          'absolute right-3 top-1/2 -translate-y-1/2',
                                          validation.level === 'success'
                                            ? 'text-success-primary'
                                            : validation.level === 'warning'
                                              ? 'text-warning-primary'
                                              : 'text-error-primary'
                                        )}
                                      >
                                        {validation.level === 'success' ? (
                                          <CheckCircle className="size-4" />
                                        ) : validation.level === 'warning' ? (
                                          <AlertCircle className="size-4" />
                                        ) : (
                                          <XCircle className="size-4" />
                                        )}
                                      </TooltipTrigger>
                                    </Tooltip>
                                  ) : null}
                                </div>

                                {hasInlineActions ? (
                                  <div className="inline-flex items-stretch gap-2 self-stretch">
                                    {isSecretField ? (
                                      <Tooltip title={isFieldVisible ? 'Hide Secret Value' : 'Reveal Secret Value'} placement="top">
                                        <Button
                                          size="md"
                                          color="secondary"
                                          className="h-11 w-11 shrink-0"
                                          aria-label={isFieldVisible ? 'Hide Secret' : 'Reveal Secret'}
                                          iconLeading={isFieldVisible ? EyeOff : Eye}
                                          onPress={() => toggleFieldVisibility(field.key)}
                                        />
                                      </Tooltip>
                                    ) : null}

                                    {field.key === 'NOTION_DATABASE_ID' ? (
                                      <Tooltip
                                        title={notionDatabaseUrl ? 'Open This Database in a New Tab' : 'Enter a valid 32-char database ID to enable this button'}
                                        placement="top"
                                      >
                                        <span>
                                          <Button
                                            size="md"
                                            color="secondary"
                                            className="h-11 w-11 shrink-0"
                                            aria-label="Open in Notion"
                                            iconLeading={LinkExternal01}
                                            isDisabled={!notionDatabaseUrl}
                                            onPress={() => {
                                              if (!notionDatabaseUrl) {
                                                return;
                                              }
                                              window.open(notionDatabaseUrl, '_blank', 'noopener,noreferrer');
                                            }}
                                          />
                                        </span>
                                      </Tooltip>
                                    ) : null}

                                    {field.folderPicker ? (
                                      <Button
                                        size="md"
                                        color="secondary"
                                        className="h-11 shrink-0"
                                        iconLeading={Folder}
                                        isLoading={Boolean(busy.pickWorkdir)}
                                        onPress={pickClaudeWorkdir}
                                      >
                                        Choose Folder
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {section.toggleKeys.length > 0 ? (
                      <div className={cx('space-y-3', section.textKeys.length > 0 ? 'mt-3' : '')}>
                        {section.toggleKeys.map((toggleKey) => {
                          const toggle = TOGGLE_BY_KEY[toggleKey];
                          if (!toggle) {
                            return null;
                          }

                          return (
                            <div key={toggle.key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-secondary bg-primary p-4">
                              <div className="min-w-0 space-y-1">
                                <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                                  <Icon icon={toggle.icon} className="size-4 text-fg-quaternary" />
                                  {toggle.label}
                                </p>
                                <p className="m-0 text-sm text-tertiary">{toggle.description}</p>
                              </div>

                              <Toggle
                                aria-label={toggle.label}
                                size="md"
                                isSelected={Boolean(config[toggle.key])}
                                onChange={(isSelected) => {
                                  setConfig((prev) => ({ ...prev, [toggle.key]: isSelected }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-4">
                <p className={cx('m-0 text-sm', saveDisabled ? 'text-warning-primary' : 'text-tertiary')}>
                  {hasBlockingErrors
                    ? 'Fix blocking errors before saving.'
                    : !allFieldsValidated
                      ? 'All fields must be validated before saving.'
                      : changedKeys.length === 0
                        ? 'There are no unsaved changes.'
                        : `${changedKeys.length} pending change${changedKeys.length > 1 ? 's' : ''}.`}
                </p>
                <Button size="md" color="primary" iconLeading={Save01} isDisabled={saveDisabled} isLoading={Boolean(busy.save)} onPress={onSaveClick}>
                  Save Configuration
                </Button>
              </div>
            </section>
          </Tabs.Panel>

          <Tabs.Panel id={NAV_TAB_KEYS.operations} className="pt-2">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
              <section className="space-y-4 rounded-2xl border border-secondary bg-primary p-4 shadow-sm">
                <div className="space-y-1">
                  <h2 className="m-0 inline-flex items-center gap-2 text-xl font-semibold text-primary">
                    <Icon icon={Toggle01Right} className="size-5" />
                    Process Controls
                  </h2>
                  <p className="m-0 text-sm text-tertiary">Start/stop the local services required for automation.</p>
                </div>

                <div className="space-y-3">
                  <div className="space-y-3 rounded-xl border border-secondary bg-secondary p-4">
                    <div className="space-y-1">
                      <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                        <Icon icon={Server01} className="size-4" />
                        Automation App
                      </p>
                      <p className="m-0 text-sm text-tertiary">Runs queue processing and sends tasks to Claude.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {apiRunning ? (
                        <Button
                          size="sm"
                          color="secondary-destructive"
                          className={PROCESS_ACTION_BUTTON_CLASS}
                          iconLeading={StopCircle}
                          isLoading={Boolean(busy.stopApi)}
                          onPress={() => runAction('stopApi', '/api/process/api/stop', 'App stop requested')}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          color="primary"
                          className={PROCESS_ACTION_BUTTON_CLASS}
                          iconLeading={PlayCircle}
                          isLoading={Boolean(busy.startApi)}
                          onPress={() => runAction('startApi', '/api/process/api/start', 'App started')}
                        >
                          Start
                        </Button>
                      )}

                      <StatusBadge color={apiRunning ? 'success' : 'error'} connectionState={apiRunning ? 'active' : 'inactive'}>
                        {apiRunning ? 'Running' : 'Stopped'}
                      </StatusBadge>

                      <StatusBadge color={apiHealthStatus.color} connectionState={apiHealthStatus.connectionState}>
                        API {apiHealthStatus.label}
                      </StatusBadge>
                    </div>
                  </div>

                </div>

                <div className="space-y-2 rounded-xl border border-secondary bg-secondary p-4">
                  <p className="m-0 text-sm font-medium text-secondary">Run Queue Now</p>
                  <p className="m-0 text-sm text-tertiary">Triggers one immediate reconciliation cycle in Notion and Claude.</p>
                  <Button
                    size="md"
                    color="primary"
                    iconLeading={Flash}
                    isLoading={Boolean(busy.runNow)}
                    onPress={() => runAction('runNow', '/api/automation/run', 'Manual run requested')}
                  >
                    Run Queue Now
                  </Button>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-secondary bg-primary p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="m-0 inline-flex items-center gap-2 text-xl font-semibold text-primary">
                      <Icon icon={TerminalBrowser} className="size-5" />
                      Live Feed
                    </h2>
                    <p className="m-0 text-sm text-tertiary">Unified stream for panel, app and direct Claude chat.</p>
                  </div>

                  <Button
                    size="sm"
                    color="secondary"
                    iconLeading={Settings01}
                    onPress={() => setRuntimeSettingsModalOpen(true)}
                  >
                    Runtime Settings
                  </Button>
                </div>

                <div
                  ref={logFeedRef}
                  className="max-h-[68vh] min-h-[420px] space-y-2 overflow-auto rounded-2xl border border-secondary bg-secondary p-3"
                >
                  {logs.map((line) => {
                    const timestamp = formatFeedTimestamp(line.ts);
                    const level = normalizeLogLevel(line.level);
                    const levelMeta = logLevelMeta(level);
                    const sourceMeta = logSourceMeta(line);
                    const displayMessage = formatLiveFeedMessage(line);
                    const isOutgoing = sourceMeta.side === 'outgoing';
                    const alignment = isOutgoing ? 'justify-end' : 'justify-start';

                    return (
                      <div
                        key={line.id || `${line.ts || timestamp}-${line.source || 'system'}-${line.message || ''}`}
                        className={cx('flex', alignment)}
                      >
                        <div
                          className={cx(
                            'flex w-full max-w-[min(95%,900px)] items-end gap-2',
                            isOutgoing ? 'justify-end' : 'justify-start'
                          )}
                        >
                          {!isOutgoing ? <SourceAvatar sourceMeta={sourceMeta} /> : null}

                          <div
                            className={cx(
                              'max-w-[min(86%,760px)] rounded-2xl px-3.5 py-2.5 shadow-xs',
                              isOutgoing ? 'rounded-br-md' : 'rounded-bl-md',
                              logToneClasses(level, sourceMeta.side, sourceMeta.directClaude),
                              sourceMeta.directClaude ? 'ring-1 ring-brand/45' : ''
                            )}
                          >
                            <div className="mb-1 inline-flex items-center gap-2 text-[11px] font-medium">
                              <span className={cx(sourceMeta.directClaude ? 'text-brand-primary' : 'text-tertiary')}>
                                {sourceMeta.label}
                              </span>
                              {sourceMeta.directClaude ? (
                                <span className="rounded-full bg-primary/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary">
                                  Direct
                                </span>
                              ) : null}
                            </div>

                            <p className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-current">{displayMessage}</p>

                            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-tertiary">
                              <div className="inline-flex items-center gap-1">
                                <Icon icon={levelMeta.icon} className="size-3" />
                                <span>{levelMeta.label}</span>
                                <span className="mx-0.5 text-quaternary">•</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
                              </div>
                              <Button
                                size="sm"
                                color="tertiary"
                                className="h-7 w-7 shrink-0"
                                aria-label="Copy message"
                                iconLeading={Copy01}
                                onPress={() => {
                                  copyLiveFeedMessage(displayMessage);
                                }}
                              />
                            </div>
                          </div>

                          {isOutgoing ? <SourceAvatar sourceMeta={sourceMeta} /> : null}
                        </div>
                      </div>
                    );
                  })}

                  {logs.length === 0 ? (
                    <div className="rounded-2xl bg-primary p-3 text-sm text-tertiary shadow-xs">
                      No logs yet. Start App or click <strong>Run Queue Now</strong> to see messages here.
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-xl border border-secondary bg-secondary p-4">
                  <p className="m-0 text-sm font-medium text-secondary">Chat With Claude</p>

                  <div className="flex items-stretch gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        size="md"
                        aria-label="Chat prompt"
                        placeholder="Ask Claude about this project..."
                        value={chatDraft}
                        isDisabled={Boolean(busy.chat)}
                        onChange={(value) => setChatDraft(value || '')}
                        onKeyDown={onChatDraftKeyDown}
                      />
                    </div>
                    <Button size="md" color="primary" iconLeading={Send01} className="shrink-0" isLoading={Boolean(busy.chat)} onPress={sendClaudeChatMessage}>
                      Send
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>

      <ModalOverlay
        isOpen={saveConfirm.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSaveConfirm({ open: false, changedKeys: [] });
          }
        }}
        isDismissable={!busy.save}
      >
        <Modal className="sm:max-w-xl">
          <Dialog>
            <div className="w-full rounded-2xl border border-secondary bg-primary p-6 shadow-2xl">
              <div className="space-y-2">
                <h3 className="m-0 text-lg font-semibold text-primary">Apply changes now?</h3>
                <p className="m-0 text-sm text-tertiary">The automation app is running. Restart to apply new settings immediately.</p>
              </div>

              <div className="mt-4 rounded-xl border border-secondary bg-secondary p-3 text-sm text-secondary">
                Changed settings: {saveConfirm.changedKeys.map((key) => LABEL_BY_KEY[key] || key).join(', ')}
              </div>

              <p className="m-0 mt-3 text-sm text-tertiary">Restarting the app does not close this panel tab.</p>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button
                  size="md"
                  color="secondary"
                  isLoading={Boolean(busy.save)}
                  onPress={async () => {
                    setSaveConfirm({ open: false, changedKeys: [] });
                    await persistConfig({ restartApi: false });
                  }}
                >
                  Save without restart
                </Button>
                <Button
                  size="md"
                  color="primary"
                  iconLeading={ArrowUpRight}
                  isLoading={Boolean(busy.save)}
                  onPress={async () => {
                    setSaveConfirm({ open: false, changedKeys: [] });
                    await persistConfig({ restartApi: true });
                  }}
                >
                  Save and restart app
                </Button>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <ModalOverlay
        isOpen={runtimeSettingsModalOpen}
        onOpenChange={setRuntimeSettingsModalOpen}
        isDismissable
      >
        <Modal className="sm:max-w-xl">
          <Dialog>
            <div className="w-full rounded-2xl border border-secondary bg-primary p-6 shadow-2xl">
              <div className="space-y-2">
                <h3 className="m-0 text-lg font-semibold text-primary">Runtime Settings</h3>
                <p className="m-0 text-sm text-tertiary">Applied immediately to the next task execution.</p>
              </div>

              <div className="mt-4 space-y-3 rounded-xl border border-secondary bg-secondary p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                    <Icon icon={Activity} className="size-4" />
                    Show Claude Live Output
                  </p>
                  <Toggle
                    aria-label="Show Claude Live Output"
                    isDisabled={!apiRunning || Boolean(busy.runtime_streamOutput)}
                    isSelected={Boolean(runtimeSettings.streamOutput)}
                    onChange={(selected) => {
                      updateRuntimeSetting('streamOutput', selected);
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                    <Icon icon={File03} className="size-4" />
                    Log Prompt Sent to Claude
                  </p>
                  <Toggle
                    aria-label="Log Prompt Sent to Claude"
                    isDisabled={!apiRunning || Boolean(busy.runtime_logPrompt)}
                    isSelected={Boolean(runtimeSettings.logPrompt)}
                    onChange={(selected) => {
                      updateRuntimeSetting('logPrompt', selected);
                    }}
                  />
                </div>
              </div>

              {!apiRunning ? <p className="m-0 mt-3 text-sm text-warning-primary">Start Automation App to change runtime settings.</p> : null}

              <div className="mt-5 flex justify-end">
                <Button
                  size="md"
                  color="secondary"
                  onPress={() => {
                    setRuntimeSettingsModalOpen(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <ToastNotification toast={toast} />
    </div>
  );
}
