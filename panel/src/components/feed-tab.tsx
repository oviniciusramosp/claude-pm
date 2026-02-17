// panel/src/components/feed-tab.tsx

import React, { type RefObject, useLayoutEffect, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy01, CpuChip01, Send01, TerminalBrowser, Check, ChevronSelectorVertical } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from './base/tooltip/tooltip';
import { cx } from '@/utils/cx';
import {
  normalizeLogLevel,
  logLevelMeta,
  logSourceMeta,
  resolveLogSourceKey,
  logToneClasses,
  detectSpecialBubble,
  formatLiveFeedMessage,
  formatFeedTimestamp,
  parseClaudeTaskContract,
  formatClaudeTaskContract,
  extractModelFromMessage,
  formatModelLabel,
  parseValidationReport,
  isProgressiveLog,
  extractProgressiveMeta,
  type ProgressiveLogMeta
} from '../utils/log-helpers';
import { Icon } from './icon';
import { SourceAvatar } from './source-avatar';
import type { LogEntry, OrchestratorState, TaskContractData, ValidationReportData } from '../types';

/**
 * Groups progressive logs by their groupId
 * Returns an array of either individual logs or grouped progressive log arrays
 */
function groupProgressiveLogs(logs: LogEntry[]): Array<LogEntry | LogEntry[]> {
  const result: Array<LogEntry | LogEntry[]> = [];
  const progressiveGroups = new Map<string, LogEntry[]>();

  for (const log of logs) {
    if (isProgressiveLog(log)) {
      const meta = extractProgressiveMeta(log);
      if (meta && meta.groupId) {
        if (!progressiveGroups.has(meta.groupId)) {
          progressiveGroups.set(meta.groupId, []);
        }
        progressiveGroups.get(meta.groupId)!.push(log);
        continue;
      }
    }
    result.push(log);
  }

  // Insert grouped logs at the position of their first occurrence
  const insertedGroups = new Set<string>();
  const finalResult: Array<LogEntry | LogEntry[]> = [];

  for (const item of result) {
    if (!Array.isArray(item) && isProgressiveLog(item)) {
      const meta = extractProgressiveMeta(item);
      if (meta && meta.groupId && !insertedGroups.has(meta.groupId)) {
        const group = progressiveGroups.get(meta.groupId);
        if (group && group.length > 0) {
          finalResult.push(group);
          insertedGroups.add(meta.groupId);
        }
      }
    } else {
      finalResult.push(item);
    }
  }

  // Add any remaining groups that weren't inserted
  for (const [groupId, group] of progressiveGroups.entries()) {
    if (!insertedGroups.has(groupId)) {
      finalResult.push(group);
    }
  }

  return finalResult;
}

/**
 * Renders a progressive log group with loading states
 */
function ProgressiveLogBubble({
  logs,
  onCopy
}: {
  logs: LogEntry[];
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Get the latest state from the group
  const latestLog = logs[logs.length - 1];
  const latestMeta = extractProgressiveMeta(latestLog);
  const firstMeta = extractProgressiveMeta(logs[0]);

  if (!latestMeta) return null;

  const isLoading = latestMeta.state === 'start' || latestMeta.state === 'progress';
  const isComplete = latestMeta.state === 'complete';
  const isError = latestMeta.state === 'error';

  const message = latestLog.message || '';
  const expandableContent = firstMeta?.expandableContent;
  const hasExpandable = expandableContent && expandableContent.length > 0;
  const lineCount = hasExpandable ? expandableContent.split('\n').length : 0;

  return (
    <div className="space-y-2">
      {/* Main message with loading/complete indicator */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          {isLoading ? (
            <svg className="size-4 animate-spin text-current" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : isComplete ? (
            <Icon icon={Check} className="size-4 text-success-primary" />
          ) : isError ? (
            <span className="text-error-primary">✗</span>
          ) : null}
        </div>
        <div className="flex-1">
          <p className="m-0 text-sm font-medium leading-5 text-current">{message}</p>
        </div>
      </div>

      {/* Model badge */}
      {latestMeta.model && (
        <div className="inline-flex items-center gap-1 rounded-sm bg-black/5 px-2 py-0.5 text-[11px] text-current/70 dark:bg-white/10">
          <Icon icon={CpuChip01} className="size-3 shrink-0" />
          <span>{formatModelLabel(latestMeta.model)}</span>
        </div>
      )}

      {/* Duration badge (shown when complete) */}
      {isComplete && latestMeta.duration && (
        <div className="inline-flex items-center gap-1 rounded-sm bg-success-50 px-2 py-0.5 text-[11px] text-success-700 dark:bg-success-900/30 dark:text-success-300">
          <Icon icon={Check} className="size-3 shrink-0" />
          <span>{latestMeta.duration}</span>
        </div>
      )}

      {/* Expandable prompt */}
      {hasExpandable && (
        <div>
          <button
            type="button"
            className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-sm font-medium leading-5 text-current hover:opacity-80"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-4 shrink-0" />
            <span>Prompt</span>
            {!expanded && lineCount > 0 ? (
              <span className="ml-1 text-[11px] font-normal text-tertiary">
                ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
              </span>
            ) : null}
          </button>

          {expanded ? (
            <div className="relative mt-2">
              <pre className="m-0 max-h-[400px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-sm bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3">
                {expandableContent}
              </pre>
              <Button
                size="sm"
                color="tertiary"
                className="absolute right-2 top-2 h-6 w-6 shrink-0 [&_svg]:!size-3"
                aria-label="Copy prompt"
                iconLeading={Copy01}
                onPress={() => onCopy(expandableContent || '')}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-2">
      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-sm font-medium leading-5 text-current hover:opacity-80"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-4 shrink-0" />
        <span>{title}</span>
        {!expanded && lineCount > 0 ? (
          <span className="ml-1 text-[11px] font-normal text-tertiary">
            ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="relative">
          <pre className="m-0 max-h-[400px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-sm bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3">
            {content}
          </pre>
          <Button
            size="sm"
            color="tertiary"
            className="absolute right-2 top-2 h-6 w-6 shrink-0 [&_svg]:!size-3"
            aria-label="Copy prompt"
            iconLeading={Copy01}
            onPress={() => onCopy(content)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExpandableTaskResult({
  contract,
  onCopy
}: {
  contract: TaskContractData;
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusLabel = contract.status === 'done' ? 'Task completed' : 'Task blocked';
  const badgeParts: string[] = [];
  if (contract.files.length > 0) {
    badgeParts.push(`${contract.files.length} file${contract.files.length === 1 ? '' : 's'}`);
  }
  if (contract.tests) {
    badgeParts.push('tests');
  }
  const badge = badgeParts.length > 0 ? ` \u2014 ${badgeParts.join(', ')}` : '';

  const hasDetails = Boolean(contract.summary || contract.notes || contract.files.length > 0 || contract.tests);

  const copyText = formatClaudeTaskContract(JSON.stringify({
    status: contract.status,
    summary: contract.summary,
    notes: contract.notes,
    files: contract.files,
    tests: contract.tests
  })) || '';

  if (!hasDetails) {
    return (
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-current">
        {statusLabel}{badge}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-sm font-medium leading-5 text-current hover:opacity-80"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-4 shrink-0" />
        <span>{statusLabel}{badge}</span>
        {!expanded ? (
          <span className="ml-1 text-[11px] font-normal text-tertiary">
            (click to expand)
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="relative">
          <div className="max-h-[400px] space-y-2 overflow-auto rounded-sm bg-primary/50 p-3 text-xs leading-relaxed text-current">
            {contract.summary ? (
              <p className="m-0">{contract.summary}</p>
            ) : null}
            {contract.notes ? (
              <p className="m-0 opacity-75">Notes: {contract.notes}</p>
            ) : null}
            {contract.files.length > 0 ? (
              <div>
                <p className="m-0 font-medium">Files ({contract.files.length}):</p>
                <ul className="m-0 list-none pl-2">
                  {contract.files.map((file, i) => (
                    <li key={i} className="opacity-75">{file}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {contract.tests ? (
              <p className="m-0 opacity-75">Tests: {contract.tests}</p>
            ) : null}
          </div>
          <Button
            size="sm"
            color="tertiary"
            className="absolute right-2 top-2 h-6 w-6 shrink-0 [&_svg]:!size-3"
            aria-label="Copy result"
            iconLeading={Copy01}
            onPress={() => onCopy(copyText)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExpandableValidationReport({
  report,
  onCopy
}: {
  report: ValidationReportData;
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusLabel = report.valid ? '✅ Board structure is valid' : '❌ Board structure has errors';
  const badge = !report.valid
    ? ` — ${report.totalErrors} error${report.totalErrors === 1 ? '' : 's'}${report.totalWarnings > 0 ? `, ${report.totalWarnings} warning${report.totalWarnings === 1 ? '' : 's'}` : ''}`
    : '';

  const hasDetails = !report.valid && (report.errors.length > 0 || report.warnings.length > 0);

  const copyText = `${statusLabel}

📊 Summary:
  - Total tasks: ${report.summary.totalTasks}
  - Total epics: ${report.summary.totalEpics}

${report.errors.length > 0 ? `🚨 Errors (${report.totalErrors}):
${report.errors.map(e => `  - ${e.message}${e.suggestion ? `\n    💡 ${e.suggestion}` : ''}`).join('\n')}
${report.hasMoreErrors ? `  ... and ${report.totalErrors - report.errors.length} more\n` : ''}` : ''}
${report.warnings.length > 0 ? `⚠️  Warnings (${report.totalWarnings}):
${report.warnings.map(w => `  - ${w.message}`).join('\n')}
${report.hasMoreWarnings ? `  ... and ${report.totalWarnings - report.warnings.length} more` : ''}` : ''}`.trim();

  if (!hasDetails) {
    return (
      <div className="space-y-2">
        <p className="m-0 text-sm font-medium leading-5 text-current">{statusLabel}</p>
        <p className="m-0 text-xs text-current/75">
          📊 {report.summary.totalTasks} task{report.summary.totalTasks === 1 ? '' : 's'}, {report.summary.totalEpics} epic{report.summary.totalEpics === 1 ? '' : 's'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-sm font-medium leading-5 text-current hover:opacity-80"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-4 shrink-0" />
        <span>{statusLabel}{badge}</span>
        {!expanded ? (
          <span className="ml-1 text-[11px] font-normal text-tertiary">
            (click to expand)
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="relative">
          <div className="max-h-[400px] space-y-3 overflow-auto rounded-sm bg-primary/50 p-3 text-xs leading-relaxed text-current">
            <div>
              <p className="m-0 font-medium">📊 Summary:</p>
              <ul className="m-0 mt-1 list-none pl-4">
                <li>Total tasks: {report.summary.totalTasks}</li>
                <li>Total epics: {report.summary.totalEpics}</li>
              </ul>
            </div>

            {report.errors.length > 0 ? (
              <div>
                <p className="m-0 font-medium">🚨 Errors ({report.totalErrors}):</p>
                <ul className="m-0 mt-1 list-none space-y-1 pl-4">
                  {report.errors.map((error, i) => (
                    <li key={i} className="space-y-0.5">
                      <div className="opacity-90">{error.message}</div>
                      {error.suggestion ? (
                        <div className="opacity-75 pl-2">💡 {error.suggestion}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {report.hasMoreErrors ? (
                  <p className="m-0 mt-1 pl-4 opacity-75">
                    ... and {report.totalErrors - report.errors.length} more
                  </p>
                ) : null}
              </div>
            ) : null}

            {report.warnings.length > 0 ? (
              <div>
                <p className="m-0 font-medium">⚠️  Warnings ({report.totalWarnings}):</p>
                <ul className="m-0 mt-1 list-none space-y-1 pl-4">
                  {report.warnings.map((warning, i) => (
                    <li key={i} className="opacity-90">{warning.message}</li>
                  ))}
                </ul>
                {report.hasMoreWarnings ? (
                  <p className="m-0 mt-1 pl-4 opacity-75">
                    ... and {report.totalWarnings - report.warnings.length} more
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <Button
            size="sm"
            color="tertiary"
            className="absolute right-2 top-2 h-6 w-6 shrink-0 [&_svg]:!size-3"
            aria-label="Copy report"
            iconLeading={Copy01}
            onPress={() => onCopy(copyText)}
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
  chatModel,
  setChatModel,
  sendClaudeChatMessage,
  copyLiveFeedMessage,
  busy,
  orchestratorState,
  fixingTaskId
}: {
  logs: LogEntry[];
  logFeedRef: RefObject<HTMLDivElement | null>;
  chatDraft: string;
  setChatDraft: (value: string) => void;
  chatModel: string;
  setChatModel: (value: string) => void;
  sendClaudeChatMessage: () => void;
  copyLiveFeedMessage: (message: string) => void;
  busy: Record<string, any>;
  orchestratorState: OrchestratorState | null;
  fixingTaskId?: string | null;
}) {
  const claudeWorking = orchestratorState?.active && orchestratorState.currentTaskId;
  const isChatDisabled = Boolean(busy.chat) || claudeWorking || Boolean(fixingTaskId);

  // Group progressive logs
  const groupedLogs = useMemo(() => groupProgressiveLogs(logs), [logs]);

  useLayoutEffect(() => {
    const el = logFeedRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [logs, logFeedRef]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden rounded-xl border border-secondary bg-primary p-3 shadow-sm sm:gap-4 sm:p-4">
      <div className="space-y-1">
        <h2 className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-primary sm:text-xl">
          <Icon icon={TerminalBrowser} className="size-5" />
          Live Feed
        </h2>
        <p className="m-0 hidden text-sm text-tertiary sm:block">Unified stream for panel, app and direct Claude chat.</p>
      </div>

      {/* Fix in progress banner */}
      {fixingTaskId && (
        <div className="flex items-center gap-3 rounded-lg border border-utility-brand-200 bg-utility-brand-50 px-4 py-3 shadow-sm animate-pulse">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-utility-brand-100">
            <Icon icon={CpuChip01} className="size-4 text-utility-brand-600 animate-spin" />
          </div>
          <div className="flex-1">
            <p className="m-0 text-sm font-medium text-utility-brand-900">
              Fixing Acceptance Criteria
            </p>
            <p className="m-0 text-xs text-utility-brand-700">
              Claude is verifying task: <span className="font-mono">{fixingTaskId}</span>
            </p>
          </div>
        </div>
      )}

      <div
        ref={logFeedRef}
        className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden rounded-lg border border-secondary bg-secondary p-2 sm:p-3"
      >
        {groupedLogs.map((item, index) => {
          // Check if this is a progressive log group
          const isProgressiveGroup = Array.isArray(item) && item.length > 0 && isProgressiveLog(item[0]);

          if (isProgressiveGroup) {
            const group = item as LogEntry[];
            const firstLog = group[0];
            const latestLog = group[group.length - 1];
            const timestamp = formatFeedTimestamp(latestLog.ts);
            const level = normalizeLogLevel(latestLog.level);
            const levelMeta = logLevelMeta(level);
            const sourceMeta = logSourceMeta(latestLog);
            const isOutgoing = sourceMeta.side === 'outgoing';
            const alignment = isOutgoing ? 'justify-end' : 'justify-start';

            // For progressive groups, we don't check source key continuity
            const isGroupContinuation = false;
            const isLastInGroup = true;

            return (
              <div
                key={`progressive-${extractProgressiveMeta(firstLog)?.groupId || index}`}
                className={cx('flex', alignment, isGroupContinuation ? '!mt-0.5' : '')}
              >
                <div
                  className={cx(
                    'flex w-full min-w-0 max-w-[min(95%,900px)] items-end gap-2',
                    isOutgoing ? 'justify-end' : 'justify-start'
                  )}
                >
                  {!isOutgoing ? (
                    isLastInGroup
                      ? <SourceAvatar sourceMeta={sourceMeta} />
                      : <span className="size-8 shrink-0" aria-hidden="true" />
                  ) : null}

                  <div
                    className={cx(
                      'group/msg min-w-0 max-w-[min(86%,760px)] rounded-xl px-3 py-2.5 shadow-xs sm:px-4 sm:py-3',
                      isOutgoing ? 'rounded-br-sm' : 'rounded-bl-sm',
                      logToneClasses(level, sourceMeta.side, sourceMeta.directClaude, 'progressive-log', true),
                      'ring-1 ring-brand/45'
                    )}
                  >
                    <ProgressiveLogBubble logs={group} onCopy={copyLiveFeedMessage} />

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-current/50">
                      <div className="inline-flex items-center gap-1">
                        <Icon icon={levelMeta.icon} className="size-3" />
                        <span>{levelMeta.label}</span>
                        <span className="mx-0.5 opacity-60">&bull;</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
                      </div>
                    </div>
                  </div>

                  {isOutgoing ? (
                    isLastInGroup
                      ? <SourceAvatar sourceMeta={sourceMeta} />
                      : <span className="size-8 shrink-0" aria-hidden="true" />
                  ) : null}
                </div>
              </div>
            );
          }

          // Regular log rendering
          const line = item as LogEntry;
          const timestamp = formatFeedTimestamp(line.ts);
          const level = normalizeLogLevel(line.level);
          const levelMeta = logLevelMeta(level);
          const sourceMeta = logSourceMeta(line);
          const taskContract = parseClaudeTaskContract(line.message);
          const validationReport = parseValidationReport(line.message);
          const displayMessage = formatLiveFeedMessage(line);
          const modelRaw = extractModelFromMessage(line.message);
          const modelLabel = modelRaw ? formatModelLabel(modelRaw) : null;
          const isOutgoing = sourceMeta.side === 'outgoing';
          const alignment = isOutgoing ? 'justify-end' : 'justify-start';

          const specialBubble = detectSpecialBubble(line.message || '');

          const currentSourceKey = resolveLogSourceKey(line.source, line.message);
          const prevItem = index > 0 ? groupedLogs[index - 1] : null;
          const prevLine = Array.isArray(prevItem) ? null : prevItem;
          const prevSourceKey = prevLine ? resolveLogSourceKey(prevLine.source, prevLine.message) : null;
          const nextItem = index < groupedLogs.length - 1 ? groupedLogs[index + 1] : null;
          const nextLine = Array.isArray(nextItem) ? null : nextItem;
          const nextSourceKey = nextLine ? resolveLogSourceKey(nextLine.source, nextLine.message) : null;
          const isGroupContinuation = currentSourceKey === prevSourceKey;
          const isLastInGroup = currentSourceKey !== nextSourceKey;

          return (
            <div
              key={line.id || `${line.ts || timestamp}-${line.source || 'system'}-${line.message || ''}`}
              className={cx('flex', alignment, isGroupContinuation ? '!mt-0.5' : '')}
            >
              <div
                className={cx(
                  'flex w-full min-w-0 max-w-[min(95%,900px)] items-end gap-2',
                  isOutgoing ? 'justify-end' : 'justify-start'
                )}
              >
                {!isOutgoing ? (
                  isLastInGroup
                    ? <SourceAvatar sourceMeta={sourceMeta} />
                    : <span className="size-8 shrink-0" aria-hidden="true" />
                ) : null}

                <div
                  className={cx(
                    'group/msg min-w-0 max-w-[min(86%,760px)] rounded-xl px-3 py-2.5 shadow-xs sm:px-4 sm:py-3',
                    isOutgoing ? 'rounded-br-sm' : 'rounded-bl-sm',
                    logToneClasses(level, sourceMeta.side, sourceMeta.directClaude, specialBubble, validationReport?.valid ?? true),
                    specialBubble === 'validation-report'
                      ? validationReport?.valid
                        ? 'ring-1 ring-green-400/50'
                        : 'ring-1 ring-yellow-400/50'
                      : specialBubble === 'in-progress'
                        ? 'ring-1 ring-blue-400/50'
                        : specialBubble === 'epic-done'
                          ? 'ring-1 ring-purple-400/50'
                          : sourceMeta.directClaude ? 'ring-1 ring-brand/45' : ''
                  )}
                >
                  {line.isPrompt ? (
                    <ExpandablePrompt
                      title={line.promptTitle || 'Prompt sent to Claude Code'}
                      content={displayMessage}
                      onCopy={copyLiveFeedMessage}
                    />
                  ) : validationReport ? (
                    <ExpandableValidationReport
                      report={validationReport}
                      onCopy={copyLiveFeedMessage}
                    />
                  ) : taskContract ? (
                    <ExpandableTaskResult
                      contract={taskContract}
                      onCopy={copyLiveFeedMessage}
                    />
                  ) : (
                    <p className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-current">{displayMessage}</p>
                  )}

                  {modelLabel ? (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-sm bg-black/5 px-2 py-0.5 text-[11px] text-current/70 dark:bg-white/10">
                      <Icon icon={CpuChip01} className="size-3 shrink-0" />
                      <span>{modelLabel}</span>
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-current/50">
                    <div className="inline-flex items-center gap-1">
                      <Icon icon={levelMeta.icon} className="size-3" />
                      <span>{levelMeta.label}</span>
                      <span className="mx-0.5 opacity-60">&bull;</span>
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
                  isLastInGroup
                    ? <SourceAvatar sourceMeta={sourceMeta} />
                    : <span className="size-8 shrink-0" aria-hidden="true" />
                ) : null}
              </div>
            </div>
          );
        })}

        {logs.length === 0 ? (
          <div className="rounded-xl bg-primary p-3 text-sm text-tertiary shadow-xs">
            No logs yet. Start App or click <strong>Run Queue Now</strong> to see messages here.
          </div>
        ) : null}

        {claudeWorking ? (
          <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-brand/30 bg-utility-brand-50 px-4 py-3 shadow-md backdrop-blur-xl dark:bg-utility-brand-100/20">
            <svg className="size-4 shrink-0 animate-spin text-brand-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-brand-primary">
              Claude is working on: &quot;{orchestratorState?.currentTaskName || orchestratorState?.currentTaskId}&quot;
            </span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div
          className={cx(
            'flex flex-col gap-2 rounded-lg bg-primary p-2 shadow-xs ring-1 ring-primary ring-inset transition-shadow duration-100 ease-linear sm:flex-row sm:items-end',
            'has-[:focus]:ring-2 has-[:focus]:ring-brand',
            isChatDisabled && 'bg-disabled_subtle ring-disabled'
          )}
        >
          <div className="flex items-end gap-2 sm:contents">
            <div className="relative shrink-0">
              <select
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                disabled={isChatDisabled}
                className={cx(
                  'h-9 appearance-none rounded-md border border-secondary bg-primary px-3 pr-8 text-sm text-primary outline-hidden transition-colors',
                  'hover:border-secondary_hover focus:border-brand focus:ring-2 focus:ring-brand/20',
                  isChatDisabled && 'cursor-not-allowed opacity-50'
                )}
                aria-label="Select Claude model"
              >
                <option value="claude-sonnet-4-5-20250929">Sonnet 4.5</option>
                <option value="claude-opus-4-6">Opus 4.6</option>
                <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <Icon icon={ChevronSelectorVertical} className="size-4 text-tertiary" />
              </div>
            </div>
            <div className="flex-1 sm:hidden">
              {/* spacer to push select left on mobile row */}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              aria-label="Chat prompt"
              placeholder={
                claudeWorking
                  ? 'Claude is working on a task...'
                  : fixingTaskId
                    ? 'Claude is fixing acceptance criteria...'
                    : 'Ask Claude about this project...'
              }
              value={chatDraft}
              disabled={isChatDisabled}
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
                  if (!isChatDisabled) {
                    sendClaudeChatMessage();
                  }
                }
              }}
              className={cx(
                'min-w-0 flex-1 resize-none bg-transparent py-1 pl-2 text-md text-primary outline-hidden placeholder:text-placeholder',
                isChatDisabled && 'cursor-not-allowed text-disabled'
              )}
            />
            {isChatDisabled ? (
              <Tooltip
                title="Claude is busy"
                description={
                  claudeWorking
                    ? `Currently executing: ${orchestratorState?.currentTaskName || orchestratorState?.currentTaskId}`
                    : fixingTaskId
                      ? `Fixing acceptance criteria for: ${fixingTaskId}`
                      : 'Processing a request...'
                }
                delay={200}
              >
                <TooltipTrigger className="shrink-0">
                  <span className="inline-flex rounded-xs bg-disabled p-2 shadow-xs cursor-not-allowed">
                    <Icon icon={Send01} className="size-4 text-fg-disabled" />
                  </span>
                </TooltipTrigger>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                color="primary"
                iconLeading={Send01}
                className="shrink-0 rounded-xs p-2! [&_svg]:!size-4"
                isLoading={Boolean(busy.chat)}
                isDisabled={!chatDraft.trim()}
                onPress={sendClaudeChatMessage}
                aria-label="Send"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
