// panel/src/utils/log-helpers.ts

import { InfoCircle } from '@untitledui/icons';
import { LOG_LEVEL_META, LOG_SOURCE_META, FEED_TIMESTAMP_FORMATTER } from '../constants';
import { normalizeText } from './config-helpers';
import type { LogEntry, LogLevelMeta, LogSourceMeta, TaskContractData } from '../types';

export function normalizeLogLevel(level: unknown): string {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'warning') return 'warn';
  if (normalized === 'warn') return 'warn';
  if (normalized === 'error' || normalized === 'danger') return 'error';
  if (normalized === 'success' || normalized === 'ok') return 'success';
  return 'info';
}

export function logLevelMeta(level: unknown): LogLevelMeta {
  const normalized = normalizeLogLevel(level);
  return LOG_LEVEL_META[normalized] || LOG_LEVEL_META.info;
}

export function normalizeSourceKey(source: unknown): string {
  return normalizeText(source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isClaudeTaskContractMessage(message: unknown): boolean {
  const text = normalizeText(message);
  if (!text || !text.startsWith('{') || !text.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const hasStatus = typeof parsed.status === 'string' && ['done', 'blocked'].includes(parsed.status.toLowerCase());
    if (!hasStatus) {
      return false;
    }

    return (
      typeof parsed.summary === 'string' ||
      typeof parsed.notes === 'string' ||
      typeof parsed.tests === 'string' ||
      Array.isArray(parsed.files)
    );
  } catch {
    return false;
  }
}

export function resolveLogSourceKey(source: unknown, message: unknown): string {
  const normalized = normalizeSourceKey(source);
  const aliasMap: Record<string, string> = {
    chatclaude: 'chat_claude',
    claudechat: 'chat_claude',
    claude_code: 'chat_claude',
    chatuser: 'chat_user',
    user: 'chat_user'
  };
  const resolved = aliasMap[normalized] || normalized;

  if (resolved === 'api' && isClaudeTaskContractMessage(message)) {
    return 'chat_claude';
  }

  if (resolved === 'claude' && !/^manual claude chat failed:/i.test(normalizeText(message))) {
    return 'chat_claude';
  }

  return resolved;
}

export function logSourceMeta(entry: LogEntry | string): LogSourceMeta {
  const sourceValue = typeof entry === 'string' ? entry : entry?.source;
  const messageValue = typeof entry === 'string' ? '' : entry?.message;
  const normalized = resolveLogSourceKey(sourceValue, messageValue);
  if (!normalized) {
    return { label: 'System', icon: InfoCircle, side: 'incoming', avatarInitials: 'SY', directClaude: false };
  }

  const fallbackLabel = normalized
    .split('_')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return LOG_SOURCE_META[normalized] || {
    label: fallbackLabel || normalized,
    icon: InfoCircle,
    side: 'incoming',
    avatarInitials: normalized.slice(0, 2).toUpperCase(),
    directClaude: false
  };
}

export type SpecialBubbleType = 'in-progress' | 'epic-done' | 'validation-report' | 'progressive-log' | null;

export function detectSpecialBubble(message: string): SpecialBubbleType {
  const text = (message || '').trim();
  if (/^\[VALIDATION_REPORT\]/i.test(text)) {
    return 'validation-report';
  }
  if (/^Moved to In Progress:/i.test(text)) {
    return 'in-progress';
  }
  if (/^Epic moved to Done/i.test(text)) {
    return 'epic-done';
  }
  return null;
}

/**
 * Progressive log metadata extracted from meta field
 */
export interface ProgressiveLogMeta {
  progressive: true;
  groupId: string;
  state: 'start' | 'progress' | 'complete' | 'error';
  expandableContent?: string | null;
  model?: string;
  duration?: string;
  [key: string]: any;
}

/**
 * Checks if a log entry has progressive metadata
 */
export function isProgressiveLog(entry: LogEntry): boolean {
  return Boolean(entry.meta && typeof entry.meta === 'object' && 'progressive' in entry.meta && entry.meta.progressive === true);
}

/**
 * Extracts progressive log metadata from a log entry
 */
export function extractProgressiveMeta(entry: LogEntry): ProgressiveLogMeta | null {
  if (!isProgressiveLog(entry)) {
    return null;
  }

  const meta = entry.meta as any;
  return {
    progressive: true,
    groupId: meta.groupId || '',
    state: meta.state || 'start',
    expandableContent: meta.expandableContent || null,
    model: meta.model,
    duration: meta.duration,
    ...meta
  };
}

export function logToneClasses(level: string, side = 'incoming', directClaude = false, specialBubble: SpecialBubbleType = null, isValid = true): string {
  if (specialBubble === 'validation-report') {
    if (isValid) {
      return 'bg-utility-success-50 text-success-primary';
    }
    return 'bg-utility-warning-50 text-warning-primary';
  }
  if (specialBubble === 'in-progress') {
    return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
  }
  if (specialBubble === 'epic-done') {
    return 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
  }
  if (level === 'success') {
    return 'bg-utility-success-50 text-success-primary';
  }
  if (level === 'warn') {
    return 'bg-utility-warning-50 text-warning-primary';
  }
  if (level === 'error') {
    return 'bg-utility-error-50 text-error-primary';
  }
  if (directClaude) {
    return 'bg-brand-secondary text-brand-primary';
  }
  if (side === 'outgoing') {
    return 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100';
  }
  return 'bg-primary text-secondary';
}

export function formatIntervalLabel(ms: number): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) {
    return 'a custom interval';
  }

  const totalSeconds = Math.max(1, Math.round(value / 1000));
  if (totalSeconds % 3600 === 0) {
    const hours = totalSeconds / 3600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
}

export function formatReasonToken(reasonToken: string): string {
  const token = normalizeText(reasonToken).toLowerCase();
  if (!token) {
    return '';
  }

  if (token === 'poll_interval') {
    return 'scheduled interval';
  }

  if (token === 'manual') {
    return 'manual trigger';
  }

  if (token === 'startup') {
    return 'startup trigger';
  }

  return token.replace(/_/g, ' ');
}

export function formatReconciliationReason(reasonRaw: string): string {
  const raw = normalizeText(reasonRaw);
  if (!raw) {
    return 'manual trigger';
  }

  const labels = raw
    .split(',')
    .map((token) => formatReasonToken(token))
    .filter(Boolean);

  if (labels.length === 0) {
    return 'manual trigger';
  }

  return labels.join(', ');
}

export interface ValidationReportData {
  valid: boolean;
  summary: {
    totalTasks: number;
    totalEpics: number;
  };
  errors: Array<{ message: string; suggestion?: string }>;
  warnings: Array<{ message: string }>;
  hasMoreErrors: boolean;
  hasMoreWarnings: boolean;
  totalErrors: number;
  totalWarnings: number;
}

export function parseValidationReport(message: unknown): ValidationReportData | null {
  const text = normalizeText(message);
  const match = text.match(/^\[VALIDATION_REPORT\]\s*(.+)$/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object' || parsed.type !== 'validation_report') {
      return null;
    }

    return {
      valid: Boolean(parsed.valid),
      summary: {
        totalTasks: Number(parsed.summary?.totalTasks || 0),
        totalEpics: Number(parsed.summary?.totalEpics || 0)
      },
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      hasMoreErrors: Boolean(parsed.hasMoreErrors),
      hasMoreWarnings: Boolean(parsed.hasMoreWarnings),
      totalErrors: Number(parsed.totalErrors || 0),
      totalWarnings: Number(parsed.totalWarnings || 0)
    };
  } catch {
    return null;
  }
}

export function parseClaudeTaskContract(message: unknown): TaskContractData | null {
  const text = normalizeText(message).trim();
  if (!text || !text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const status = String(parsed.status || '').toLowerCase();
  if (!['done', 'blocked'].includes(status)) {
    return null;
  }

  const hasSomeField =
    typeof parsed.summary === 'string' ||
    typeof parsed.notes === 'string' ||
    typeof parsed.tests === 'string' ||
    Array.isArray(parsed.files);

  if (!hasSomeField) {
    return null;
  }

  return {
    status: status as 'done' | 'blocked',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
    files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
    tests: typeof parsed.tests === 'string' ? parsed.tests.trim() : ''
  };
}

export function formatClaudeTaskContract(message: string): string | null {
  const text = message.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const status = String(parsed.status || '').toLowerCase();
  if (!['done', 'blocked'].includes(status)) {
    return null;
  }

  const lines: string[] = [];

  if (status === 'done') {
    lines.push('Task completed');
  } else {
    lines.push('Task blocked');
  }

  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    lines.push('');
    lines.push(parsed.summary.trim());
  }

  if (typeof parsed.notes === 'string' && parsed.notes.trim()) {
    lines.push('');
    lines.push(`Notes: ${parsed.notes.trim()}`);
  }

  if (Array.isArray(parsed.files) && parsed.files.length > 0) {
    lines.push('');
    lines.push(`Files (${parsed.files.length}):`);
    for (const file of parsed.files) {
      lines.push(`  - ${file}`);
    }
  }

  if (typeof parsed.tests === 'string' && parsed.tests.trim()) {
    lines.push('');
    lines.push(`Tests: ${parsed.tests.trim()}`);
  }

  return lines.join('\n');
}

export function formatLiveFeedMessage(entry: LogEntry): string {
  const rawMessage = String(entry?.message || '');
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return rawMessage;
  }

  const contractFormatted = formatClaudeTaskContract(trimmed);
  if (contractFormatted) {
    return contractFormatted;
  }

  const periodicEnabledMatch = trimmed.match(/^Periodic reconciliation enabled \(QUEUE_POLL_INTERVAL_MS=(\d+)\)$/i);
  if (periodicEnabledMatch) {
    return `Automatic reconciliation is enabled every ${formatIntervalLabel(Number(periodicEnabledMatch[1]))}.`;
  }

  if (/^Periodic reconciliation disabled \(QUEUE_POLL_INTERVAL_MS=0\)$/i.test(trimmed)) {
    return 'Automatic reconciliation is disabled.';
  }

  const startupDisabledMatch = trimmed.match(/^Startup reconciliation disabled \(QUEUE_RUN_ON_STARTUP=false\)$/i);
  if (startupDisabledMatch) {
    return 'Startup reconciliation is disabled.';
  }

  if (/^API auto-start is disabled \(PANEL_AUTO_START_API=false\)\.?$/i.test(trimmed)) {
    return 'Automation App auto-start is disabled. Click "Start" to begin.';
  }

  const reconciliationStartMatch = trimmed.match(/^Starting board reconciliation \(reason:\s*(.+)\)$/i);
  if (reconciliationStartMatch) {
    return `Starting board reconciliation (${formatReconciliationReason(reconciliationStartMatch[1])}).`;
  }

  const reconciliationEndMatch = trimmed.match(/^Reconciliation finished \(processed:\s*(\d+),\s*reason:\s*(.+)\)$/i);
  if (reconciliationEndMatch) {
    const processed = Number(reconciliationEndMatch[1]);
    const reason = formatReconciliationReason(reconciliationEndMatch[2]);
    return `Reconciliation finished. ${processed} task${processed === 1 ? '' : 's'} processed (${reason}).`;
  }

  const workingMatch = trimmed.match(/^(Claude is working on|Opus is reviewing|Opus is reviewing epic): "(.+)" \| model: (.+)$/i);
  if (workingMatch) {
    return `${workingMatch[1]}: "${workingMatch[2]}"`;
  }

  return rawMessage;
}

export function extractModelFromMessage(message: unknown): string | null {
  const text = normalizeText(message).trim();
  if (!text) return null;
  const match = text.match(/\| model: (.+)$/i);
  if (!match) return null;
  return match[1].trim();
}

export function formatModelLabel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (m) {
    return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  }
  return model;
}

export function formatFeedTimestamp(value: unknown): string {
  const parsedDate = new Date(value as string || Date.now());
  if (Number.isNaN(parsedDate.getTime())) {
    return FEED_TIMESTAMP_FORMATTER.format(new Date());
  }

  return FEED_TIMESTAMP_FORMATTER.format(parsedDate);
}