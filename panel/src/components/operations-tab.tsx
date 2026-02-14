// panel/src/components/operations-tab.tsx

import React, { type RefObject, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy01,
  Flash,
  PlayCircle,
  Send01,
  Server01,
  Settings01,
  StopCircle,
  TerminalBrowser,
  Toggle01Right
} from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { cx } from '@/utils/cx';
import { PROCESS_ACTION_BUTTON_CLASS } from '../constants';
import {
  normalizeLogLevel,
  logLevelMeta,
  logSourceMeta,
  resolveLogSourceKey,
  logToneClasses,
  formatLiveFeedMessage,
  formatFeedTimestamp
} from '../utils/log-helpers';
import { Icon } from './icon';
import { StatusBadge } from './status-badge';
import { SourceAvatar } from './source-avatar';
import type { LogEntry } from '../types';

function ExpandablePrompt({
  title,
  content,
  onCopy
}: {
  title: string;
  content: string;
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-sm font-medium leading-5 text-current hover:opacity-80"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-3.5 shrink-0" />
        <span>{title}</span>
        {!expanded && lineCount > 0 ? (
          <span className="ml-1 text-[11px] font-normal text-tertiary">
            ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="relative">
          <pre className="m-0 max-h-[400px] overflow-auto rounded-lg bg-primary/50 p-3 text-xs leading-relaxed text-current">
            {content}
          </pre>
          <Button
            size="sm"
            color="tertiary"
            className="absolute right-1.5 top-1.5 h-6 w-6 shrink-0 [&_svg]:!size-3"
            aria-label="Copy prompt"
            iconLeading={Copy01}
            onPress={() => onCopy(content)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function OperationsTab({
  apiRunning,
  apiHealthStatus,
  busy,
  runAction,
  logs,
  logFeedRef,
  chatDraft,
  setChatDraft,
  sendClaudeChatMessage,
  onChatDraftKeyDown,
  copyLiveFeedMessage,
  setRuntimeSettingsModalOpen,
  appError,
  apiError,
  onAppBadgeClick,
  onApiBadgeClick
}: {
  apiRunning: boolean;
  apiHealthStatus: { label: string; color: string; connectionState: string };
  busy: Record<string, any>;
  runAction: (key: string, endpoint: string, successMessage: string) => void;
  logs: LogEntry[];
  logFeedRef: RefObject<HTMLDivElement | null>;
  chatDraft: string;
  setChatDraft: (value: string) => void;
  sendClaudeChatMessage: () => void;
  onChatDraftKeyDown: (event: React.KeyboardEvent) => void;
  copyLiveFeedMessage: (message: string) => void;
  setRuntimeSettingsModalOpen: (open: boolean) => void;
  appError: string | null;
  apiError: string | null;
  onAppBadgeClick: () => void;
  onApiBadgeClick: () => void;
}) {
  return (
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

              <StatusBadge
                color={appError ? 'error' : apiRunning ? 'success' : 'gray'}
                connectionState={apiRunning ? 'active' : 'inactive'}
                onClick={appError ? onAppBadgeClick : undefined}
              >
                App
              </StatusBadge>

              <StatusBadge
                color={apiError ? 'error' : apiHealthStatus.connectionState === 'active' ? 'success' : 'gray'}
                connectionState={apiHealthStatus.connectionState === 'active' ? 'active' : 'inactive'}
                onClick={apiError ? onApiBadgeClick : undefined}
              >
                API
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
                      'group/msg max-w-[min(86%,760px)] rounded-2xl px-3.5 py-2.5 shadow-xs',
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

                    {line.isPrompt ? (
                      <ExpandablePrompt
                        title={line.promptTitle || 'Prompt sent to Claude Code'}
                        content={displayMessage}
                        onCopy={copyLiveFeedMessage}
                      />
                    ) : (
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-current">{displayMessage}</p>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-tertiary">
                      <div className="inline-flex items-center gap-1">
                        <Icon icon={levelMeta.icon} className="size-3" />
                        <span>{levelMeta.label}</span>
                        <span className="mx-0.5 text-quaternary">&bull;</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
                      </div>
                      {!line.isPrompt ? (
                        <Button
                          size="sm"
                          color="tertiary"
                          className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover/msg:opacity-100 [&_svg]:!size-3.5"
                          aria-label="Copy message"
                          iconLeading={Copy01}
                          onPress={() => {
                            copyLiveFeedMessage(displayMessage);
                          }}
                        />
                      ) : null}
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
  );
}
