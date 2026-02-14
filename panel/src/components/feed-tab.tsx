// panel/src/components/feed-tab.tsx

import React, { type RefObject, useState } from 'react';
import { ChevronDown, ChevronRight, Copy01, Send01, TerminalBrowser } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { cx } from '@/utils/cx';
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

export function FeedTab({
  logs,
  logFeedRef,
  chatDraft,
  setChatDraft,
  sendClaudeChatMessage,
  copyLiveFeedMessage,
  busy
}: {
  logs: LogEntry[];
  logFeedRef: RefObject<HTMLDivElement | null>;
  chatDraft: string;
  setChatDraft: (value: string) => void;
  sendClaudeChatMessage: () => void;
  copyLiveFeedMessage: (message: string) => void;
  busy: Record<string, any>;
}) {
  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl border border-secondary bg-primary p-4 shadow-sm">
      <div className="space-y-1">
        <h2 className="m-0 inline-flex items-center gap-2 text-xl font-semibold text-primary">
          <Icon icon={TerminalBrowser} className="size-5" />
          Live Feed
        </h2>
        <p className="m-0 text-sm text-tertiary">Unified stream for panel, app and direct Claude chat.</p>
      </div>

      <div
        ref={logFeedRef}
        className="min-h-[420px] flex-1 space-y-2 overflow-auto rounded-2xl border border-secondary bg-secondary p-3"
      >
        {logs.map((line, index) => {
          const timestamp = formatFeedTimestamp(line.ts);
          const level = normalizeLogLevel(line.level);
          const levelMeta = logLevelMeta(level);
          const sourceMeta = logSourceMeta(line);
          const displayMessage = formatLiveFeedMessage(line);
          const isOutgoing = sourceMeta.side === 'outgoing';
          const alignment = isOutgoing ? 'justify-end' : 'justify-start';

          const currentSourceKey = resolveLogSourceKey(line.source, line.message);
          const prevLine = index > 0 ? logs[index - 1] : null;
          const prevSourceKey = prevLine ? resolveLogSourceKey(prevLine.source, prevLine.message) : null;
          const isGroupContinuation = currentSourceKey === prevSourceKey;

          return (
            <div
              key={line.id || `${line.ts || timestamp}-${line.source || 'system'}-${line.message || ''}`}
              className={cx('flex', alignment, isGroupContinuation ? '!mt-0.5' : '')}
            >
              <div
                className={cx(
                  'flex w-full max-w-[min(95%,900px)] items-end gap-2',
                  isOutgoing ? 'justify-end' : 'justify-start'
                )}
              >
                {!isOutgoing ? (
                  isGroupContinuation
                    ? <span className="size-8 shrink-0" aria-hidden="true" />
                    : <SourceAvatar sourceMeta={sourceMeta} />
                ) : null}

                <div
                  className={cx(
                    'group/msg max-w-[min(86%,760px)] rounded-2xl px-3.5 py-2.5 shadow-xs',
                    isOutgoing ? 'rounded-br-md' : 'rounded-bl-md',
                    logToneClasses(level, sourceMeta.side, sourceMeta.directClaude),
                    sourceMeta.directClaude ? 'ring-1 ring-brand/45' : ''
                  )}
                >
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

                {isOutgoing ? (
                  isGroupContinuation
                    ? <span className="size-8 shrink-0" aria-hidden="true" />
                    : <SourceAvatar sourceMeta={sourceMeta} />
                ) : null}
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

      <div
        className={cx(
          'flex items-end gap-2 rounded-lg bg-primary p-1.5 shadow-xs ring-1 ring-primary ring-inset transition-shadow duration-100 ease-linear',
          'has-[:focus]:ring-2 has-[:focus]:ring-brand',
          Boolean(busy.chat) && 'bg-disabled_subtle ring-disabled'
        )}
      >
        <textarea
          aria-label="Chat prompt"
          placeholder="Ask Claude about this project..."
          value={chatDraft}
          disabled={Boolean(busy.chat)}
          rows={1}
          onChange={(e) => {
            setChatDraft(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              sendClaudeChatMessage();
            }
          }}
          className={cx(
            'min-w-0 flex-1 resize-none bg-transparent py-1 pl-2 text-md text-primary outline-hidden placeholder:text-placeholder',
            Boolean(busy.chat) && 'cursor-not-allowed text-disabled'
          )}
        />
        <Button
          size="sm"
          color="primary"
          iconLeading={Send01}
          className="shrink-0 rounded-md p-2! [&_svg]:!size-4"
          isLoading={Boolean(busy.chat)}
          isDisabled={!chatDraft.trim() || Boolean(busy.chat)}
          onPress={sendClaudeChatMessage}
          aria-label="Send"
        />
      </div>
    </section>
  );
}
