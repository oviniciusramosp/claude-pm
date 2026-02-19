// panel/src/components/feed-tab.tsx

import React, { type RefObject, useLayoutEffect, useState, useMemo, useCallback, useEffect } from 'react';
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
  parseCollapsibleLines,
  isProgressiveLog,
  extractProgressiveMeta,
  extractTaskIdFromMessage,
  type ProgressiveLogMeta,
  type CollapsibleLine
} from '../utils/log-helpers';
import { Icon } from './icon';
import { SourceAvatar } from './source-avatar';
import { TaskDetailModal } from './task-detail-modal';
import { SetupRequiredBanner } from './setup-required-banner';
import type { LogEntry, OrchestratorState, TaskContractData, ValidationReportData, BoardTask } from '../types';

/**
 * Copy button with visual feedback (check icon on success)
 */
function CopyButton({
  text,
  onCopy,
  className,
  inExpandable = false
}: {
  text: string;
  onCopy: (text: string) => void;
  className?: string;
  inExpandable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <Button
      size="sm"
      color="tertiary"
      className={cx(
        inExpandable ? 'h-6 w-6 shrink-0 [&_svg]:!size-3' : 'h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover/msg:opacity-100 [&_svg]:!size-3.5',
        inExpandable && 'absolute right-2 top-2',
        className
      )}
      aria-label={copied ? 'Copied' : 'Copy'}
      iconLeading={copied ? Check : Copy01}
      onPress={() => {
        onCopy(text);
        setCopied(true);
      }}
    />
  );
}

function getStartupGroupId(log: LogEntry): string | null {
  return log.meta?.startupGroupId || null;
}

/**
 * Groups progressive logs and startup logs by their groupId.
 * Returns an array of either individual logs or grouped log arrays.
 * - Progressive groups: first element has isProgressiveLog() true
 * - Startup groups: first element has meta.startupGroupId set
 */
function groupFeedLogs(logs: LogEntry[]): Array<LogEntry | LogEntry[]> {
  const result: Array<LogEntry | LogEntry[]> = [];
  const progressiveGroups = new Map<string, LogEntry[]>();
  const startupGroups = new Map<string, LogEntry[]>();

  for (const log of logs) {
    // Progressive logs
    if (isProgressiveLog(log)) {
      const meta = extractProgressiveMeta(log);
      if (meta && meta.groupId) {
        if (!progressiveGroups.has(meta.groupId)) {
          progressiveGroups.set(meta.groupId, []);
          // Push a placeholder to mark position
          result.push(log);
        }
        progressiveGroups.get(meta.groupId)!.push(log);
        continue;
      }
    }

    // Startup logs
    const startupId = getStartupGroupId(log);
    if (startupId) {
      if (!startupGroups.has(startupId)) {
        startupGroups.set(startupId, []);
        // Push a placeholder to mark position
        result.push(log);
      }
      startupGroups.get(startupId)!.push(log);
      continue;
    }

    result.push(log);
  }

  // Replace placeholders with their groups
  const finalResult: Array<LogEntry | LogEntry[]> = [];
  const insertedProgressive = new Set<string>();
  const insertedStartup = new Set<string>();

  for (const item of result) {
    if (Array.isArray(item)) {
      finalResult.push(item);
      continue;
    }

    // Check if this is a progressive placeholder
    if (isProgressiveLog(item)) {
      const meta = extractProgressiveMeta(item);
      if (meta?.groupId && !insertedProgressive.has(meta.groupId)) {
        const group = progressiveGroups.get(meta.groupId);
        if (group && group.length > 0) {
          finalResult.push(group);
          insertedProgressive.add(meta.groupId);
          continue;
        }
      }
    }

    // Check if this is a startup placeholder
    const startupId = getStartupGroupId(item);
    if (startupId && !insertedStartup.has(startupId)) {
      const group = startupGroups.get(startupId);
      if (group && group.length > 0) {
        finalResult.push(group);
        insertedStartup.add(startupId);
        continue;
      }
    }

    finalResult.push(item);
  }

  return finalResult;
}

/**
 * Renders a clickable task name that opens the task detail modal
 */
function TaskLink({
  taskId,
  taskName,
  onClick
}: {
  taskId: string;
  taskName: string;
  onClick?: (taskId: string) => void;
}) {
  if (!onClick) {
    return <span>&quot;{taskName}&quot;</span>;
  }

  return (
    <button
      type="button"
      className="m-0 cursor-pointer border-none bg-transparent p-0 font-medium text-current underline decoration-current/30 underline-offset-2 transition-colors hover:decoration-current"
      onClick={(e) => {
        e.preventDefault();
        onClick(taskId);
      }}
    >
      &quot;{taskName}&quot;
    </button>
  );
}

/**
 * Renders a message with clickable task links when task info is detected
 */
function MessageWithTaskLink({
  message,
  taskInfo,
  onTaskClick
}: {
  message: string;
  taskInfo: { taskId: string; taskName: string } | null;
  onTaskClick?: (taskId: string) => void;
}) {
  if (!taskInfo || !onTaskClick) {
    return <p className="m-0 whitespace-pre-wrap break-words text-xs leading-4 text-current sm:text-sm sm:leading-5">{message}</p>;
  }

  // Split message by the task name pattern to insert the clickable link
  const parts = message.split(`"${taskInfo.taskName}"`);

  if (parts.length === 1) {
    // Task name not found in formatted message, render as plain text
    return <p className="m-0 whitespace-pre-wrap break-words text-xs leading-4 text-current sm:text-sm sm:leading-5">{message}</p>;
  }

  return (
    <p className="m-0 whitespace-pre-wrap break-words text-xs leading-4 text-current sm:text-sm sm:leading-5">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <TaskLink
              taskId={taskInfo.taskId}
              taskName={taskInfo.taskName}
              onClick={onTaskClick}
            />
          )}
        </span>
      ))}
    </p>
  );
}

/**
 * Renders a progressive log group with loading states
 */
function ProgressiveLogBubble({
  logs,
  onCopy,
  onTaskClick
}: {
  logs: LogEntry[];
  onCopy: (text: string) => void;
  onTaskClick?: (taskId: string) => void;
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

  // Detect if expandableContent is an array of {level, text} (startup details)
  const isDetailsArray = Array.isArray(expandableContent) && expandableContent.every(
    (item: any) => item && typeof item === 'object' && 'level' in item && 'text' in item
  );

  const hasExpandable = expandableContent && (isDetailsArray || expandableContent.length > 0);
  const lineCount = hasExpandable
    ? (isDetailsArray ? expandableContent.length : expandableContent.split('\n').length)
    : 0;

  // Extract task info from meta if available
  const taskInfo = (latestMeta as any).taskId && (latestMeta as any).taskName
    ? { taskId: (latestMeta as any).taskId, taskName: (latestMeta as any).taskName }
    : null;

  // Full text to copy (message + expandable if exists)
  const fullText = hasExpandable ? `${message}\n\nPrompt:\n${expandableContent}` : message;

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
          <MessageWithTaskLink
            message={message}
            taskInfo={taskInfo}
            onTaskClick={onTaskClick}
          />
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

      {/* Expandable details/prompt */}
      {hasExpandable && (
        <div>
          <button
            type="button"
            className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs font-medium leading-4 text-current hover:opacity-80 sm:text-sm sm:leading-5"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-4 shrink-0" />
            <span>{isDetailsArray ? 'Details' : 'Prompt'}</span>
            {!expanded && lineCount > 0 ? (
              <span className="ml-1 text-[11px] font-normal text-tertiary">
                ({lineCount} {lineCount === 1 ? (isDetailsArray ? 'configuration' : 'line') : (isDetailsArray ? 'configurations' : 'lines')})
              </span>
            ) : null}
          </button>

          {expanded ? (
            <div className="relative mt-2">
              {isDetailsArray ? (
                <div className="max-h-[400px] overflow-auto rounded-sm bg-primary/50 p-2 sm:p-3 pr-10">
                  {expandableContent.map((item: any, idx: number) => {
                    const levelMeta = logLevelMeta(item.level);
                    return (
                      <div key={idx} className="mb-1.5 flex items-start gap-2 text-xs leading-relaxed last:mb-0">
                        <Icon icon={levelMeta.icon} className="mt-0.5 size-3.5 shrink-0" />
                        <span>{item.text}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <pre className="m-0 max-h-[400px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-sm bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3 pr-12">
                  {expandableContent}
                </pre>
              )}
              <CopyButton
                text={isDetailsArray ? expandableContent.map((item: any) => item.text).join('\n') : (expandableContent || '')}
                onCopy={onCopy}
                inExpandable={true}
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
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs font-medium leading-4 text-current hover:opacity-80 sm:text-sm sm:leading-5"
        onClick={() => setExpanded(!expanded)}
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
          <pre className="m-0 max-h-[400px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-sm bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3 pr-12">
            {content}
          </pre>
          <CopyButton
            text={content}
            onCopy={onCopy}
            inExpandable={true}
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
      <p className="m-0 whitespace-pre-wrap break-words text-xs leading-4 text-current sm:text-sm sm:leading-5">
        {statusLabel}{badge}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs font-medium leading-4 text-current hover:opacity-80 sm:text-sm sm:leading-5"
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
          <CopyButton
            text={copyText}
            onCopy={onCopy}
            inExpandable={true}
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
        <p className="m-0 text-xs font-medium leading-4 text-current sm:text-sm sm:leading-5">{statusLabel}</p>
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
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs font-medium leading-4 text-current hover:opacity-80 sm:text-sm sm:leading-5"
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
          <CopyButton
            text={copyText}
            onCopy={onCopy}
            inExpandable={true}
          />
        </div>
      ) : null}
    </div>
  );
}

function CollapsibleLogBubble({
  mainMessage,
  lines,
  onCopy
}: {
  mainMessage: string;
  lines: CollapsibleLine[];
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const copyText = `${mainMessage}\n\n${lines.map((l) => `[${l.level.toUpperCase()}] ${formatLiveFeedMessage({ message: l.text } as LogEntry)}`).join('\n')}`;

  return (
    <div className="space-y-2">
      <p className="m-0 whitespace-pre-wrap break-words text-xs font-medium leading-4 text-current sm:text-sm sm:leading-5">{mainMessage}</p>

      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-xs font-medium leading-4 text-current/70 hover:text-current/90 hover:opacity-80 sm:text-sm sm:leading-5"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-3.5 shrink-0" />
        <span>{lines.length} detail{lines.length === 1 ? '' : 's'}</span>
      </button>

      {expanded ? (
        <div className="relative">
          <div className="max-h-[300px] space-y-1 overflow-auto rounded-sm bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3">
            {lines.map((line, i) => {
              const level = normalizeLogLevel(line.level);
              const meta = logLevelMeta(level);
              const text = formatLiveFeedMessage({ message: line.text } as LogEntry);
              return (
                <div key={i} className="flex items-start gap-1.5">
                  <Icon icon={meta.icon} className="mt-0.5 size-3 shrink-0 opacity-60" />
                  <span className="opacity-85">{text}</span>
                </div>
              );
            })}
          </div>
          <CopyButton
            text={copyText}
            onCopy={onCopy}
            inExpandable={true}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders all startup messages in a single bubble.
 * Shows main "started" line and expandable details.
 */
function StartupBubble({
  logs,
  onCopy
}: {
  logs: LogEntry[];
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const detailLines = logs.map((l) => ({
    level: normalizeLogLevel(l.level),
    text: formatLiveFeedMessage(l)
  }));

  const copyText = detailLines.map((d) => d.text).join('\n');

  return (
    <div className="space-y-1.5">
      <p className="m-0 whitespace-pre-wrap break-words text-xs font-medium leading-4 text-current sm:text-sm sm:leading-5">
        Automation App started.
      </p>

      <button
        type="button"
        className="m-0 flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-xs leading-4 text-current/60 hover:text-current/80 sm:text-sm sm:leading-5"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Icon icon={expanded ? ChevronDown : ChevronRight} className="size-3.5 shrink-0" />
        <span>{detailLines.length} detail{detailLines.length === 1 ? '' : 's'}</span>
      </button>

      {expanded ? (
        <div className="relative">
          <div className="max-h-[300px] space-y-1 overflow-auto rounded-md bg-primary/50 p-2 text-xs leading-relaxed text-current sm:p-3">
            {detailLines.map((detail, i) => {
              const meta = logLevelMeta(detail.level);
              return (
                <div key={i} className="flex items-start gap-1.5">
                  <Icon icon={meta.icon} className="mt-0.5 size-3 shrink-0 opacity-60" />
                  <span className="opacity-85">{detail.text}</span>
                </div>
              );
            })}
          </div>
          <CopyButton
            text={copyText}
            onCopy={onCopy}
            inExpandable={true}
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
  fixingTaskId,
  apiBaseUrl,
  showToast,
  onShowErrorDetail,
  refreshTrigger,
  setupComplete,
  onNavigateToSetup
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
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onShowErrorDetail: (title: string, message: string) => void;
  refreshTrigger: number;
  setupComplete: boolean;
  onNavigateToSetup: () => void;
}) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [loadingTask, setLoadingTask] = useState(false);

  const claudeWorking = orchestratorState?.active && orchestratorState.currentTaskId;
  const isChatDisabled = Boolean(busy.chat) || claudeWorking || Boolean(fixingTaskId);

  // Fetch task by ID
  const fetchTaskById = useCallback(async (taskId: string) => {
    setLoadingTask(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board`);
      if (!response.ok) {
        showToast('Failed to load tasks', 'danger');
        return;
      }
      const data = await response.json();
      const task = data.tasks?.find((t: BoardTask) => t.id === taskId);
      if (task) {
        setSelectedTask(task);
      } else {
        showToast(`Task "${taskId}" not found`, 'warning');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load task', 'danger');
    } finally {
      setLoadingTask(false);
    }
  }, [apiBaseUrl, showToast]);

  // Handle task click
  const handleTaskClick = useCallback((taskId: string) => {
    fetchTaskById(taskId);
  }, [fetchTaskById]);

  // Group progressive logs
  const groupedLogs = useMemo(() => groupFeedLogs(logs), [logs]);

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

      {/* Setup required banner */}
      {!setupComplete && <SetupRequiredBanner onNavigateToSetup={onNavigateToSetup} />}

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
                      logToneClasses(level, sourceMeta.side, sourceMeta.directClaude, 'progressive-log', true)
                    )}
                  >
                    <ProgressiveLogBubble logs={group} onCopy={copyLiveFeedMessage} onTaskClick={handleTaskClick} />

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

          // Check if this is a startup log group
          const isStartupGroup = Array.isArray(item) && item.length > 0 && getStartupGroupId(item[0]);

          if (isStartupGroup) {
            const group = item as LogEntry[];
            const latestLog = group[group.length - 1];
            const timestamp = formatFeedTimestamp(latestLog.ts);
            const sourceMeta = logSourceMeta(latestLog);

            return (
              <div
                key={`startup-${getStartupGroupId(group[0]) || index}`}
                className="flex justify-start"
              >
                <div className="flex w-full min-w-0 max-w-[min(95%,900px)] items-end gap-2 justify-start">
                  <SourceAvatar sourceMeta={sourceMeta} />

                  <div
                    className={cx(
                      'group/msg min-w-0 max-w-[min(86%,760px)] rounded-xl rounded-bl-sm px-3 py-2.5 shadow-xs sm:px-4 sm:py-3',
                      'bg-utility-success-50 text-success-primary'
                    )}
                  >
                    <StartupBubble logs={group} onCopy={copyLiveFeedMessage} />

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-current/50">
                      <div className="inline-flex items-center gap-1">
                        <Icon icon={logLevelMeta('success').icon} className="size-3" />
                        <span>Success</span>
                        <span className="mx-0.5 opacity-60">&bull;</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
                      </div>
                    </div>
                  </div>
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
          const collapsibleLines = parseCollapsibleLines(line);
          const displayMessage = formatLiveFeedMessage(line);
          const modelRaw = extractModelFromMessage(line.message);
          const modelLabel = modelRaw ? formatModelLabel(modelRaw) : null;
          const taskInfo = extractTaskIdFromMessage(line.message);
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
                          : ''
                  )}
                >
                  {line.isPrompt ? (
                    <ExpandablePrompt
                      title={line.promptTitle || 'Prompt sent to Claude Code'}
                      content={displayMessage}
                      onCopy={copyLiveFeedMessage}
                    />
                  ) : collapsibleLines ? (
                    <CollapsibleLogBubble
                      mainMessage={displayMessage}
                      lines={collapsibleLines}
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
                    <MessageWithTaskLink
                      message={displayMessage}
                      taskInfo={taskInfo}
                      onTaskClick={handleTaskClick}
                    />
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
            <span className="text-xs font-medium text-brand-primary sm:text-sm">
              Claude is working on: <TaskLink
                taskId={orchestratorState?.currentTaskId || ''}
                taskName={orchestratorState?.currentTaskName || orchestratorState?.currentTaskId || ''}
                onClick={handleTaskClick}
              />
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
          <div className="flex w-full items-end gap-2">
            {isChatDisabled ? (
              <Tooltip
                title="Chat unavailable"
                description={
                  claudeWorking
                    ? `Claude is currently executing: ${orchestratorState?.currentTaskName || orchestratorState?.currentTaskId}`
                    : fixingTaskId
                      ? `Claude is fixing acceptance criteria for: ${fixingTaskId}`
                      : 'Please wait for the current operation to complete'
                }
                delay={200}
              >
                <TooltipTrigger className="min-w-0 flex-1">
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
                      'min-w-0 w-full flex-1 resize-none bg-transparent py-1 pl-2 text-sm text-primary outline-hidden placeholder:text-placeholder sm:text-md',
                      isChatDisabled && 'cursor-not-allowed text-disabled'
                    )}
                  />
                </TooltipTrigger>
              </Tooltip>
            ) : (
              <textarea
                aria-label="Chat prompt"
                placeholder="Ask Claude about this project..."
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
                  'min-w-0 flex-1 resize-none bg-transparent py-1 pl-2 text-sm text-primary outline-hidden placeholder:text-placeholder sm:text-md',
                  isChatDisabled && 'cursor-not-allowed text-disabled'
                )}
              />
            )}
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

      <TaskDetailModal
        open={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
        onSaved={() => {
          setSelectedTask(null);
        }}
        onDeleted={() => {
          setSelectedTask(null);
        }}
        onShowErrorDetail={onShowErrorDetail}
      />
    </section>
  );
}
