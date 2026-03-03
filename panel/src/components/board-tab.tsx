// panel/src/components/board-tab.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, ChevronDown, Columns03, CpuChip01, Folder, FolderPlus, Lightbulb02, Plus, RefreshCw01, Stars01, Target02, Tool01, Users01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from './base/tooltip/tooltip';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import {
  BOARD_COLUMNS,
  BOARD_POLL_INTERVAL_MS
} from '../constants';
import { TaskDetailModal } from './task-detail-modal';
import { CreateTaskModal } from './create-task-modal';
import { IdeaToEpicsModal } from './idea-to-epics-modal';
import { EmptyBoardModal } from './empty-board-modal';
import { EpicsOnboardingModal } from './epics-onboarding-modal';
import { SetupRequiredBanner } from './setup-required-banner';
import type { BoardTask } from '../types';

const COLUMN_STATUS_MAP: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  done: 'Done'
};

interface BoardTabProps {
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  refreshTrigger: number;
  onShowErrorDetail: (title: string, message: string) => void;
  onError?: (message: string, details?: { stack?: string; exitCode?: number; stderr?: string; stdout?: string }) => void;
  setFixingTaskId?: (taskId: string | null) => void;
  setupComplete: boolean;
  onNavigateToSetup: () => void;
}

interface BoardError {
  message: string;
  code: string | null;
  details: Record<string, any> | null;
  httpStatus: number | null;
}


/**
 * Natural comparison: splits strings into text/number segments and compares
 * numbers numerically so that "s1-2" < "s1-10" instead of lexicographic order.
 */
function naturalCompare(a: string, b: string): number {
  const segA = a.match(/(\d+|\D+)/g) || [];
  const segB = b.match(/(\d+|\D+)/g) || [];
  const len = Math.min(segA.length, segB.length);

  for (let i = 0; i < len; i++) {
    const numA = Number(segA[i]);
    const numB = Number(segB[i]);
    const bothNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);

    if (bothNumeric) {
      if (numA !== numB) return numA - numB;
    } else {
      const cmp = segA[i].localeCompare(segB[i]);
      if (cmp !== 0) return cmp;
    }
  }

  return segA.length - segB.length;
}

function isEpic(task: BoardTask, allTasks: BoardTask[]): boolean {
  if (task.type?.toLowerCase() === 'epic') return true;
  return allTasks.some((t) => t.parentId === task.id);
}

function sortEpics(epics: BoardTask[]): BoardTask[] {
  return [...epics].sort((a, b) => {
    if (a.order != null && b.order != null) {
      if (a.order !== b.order) return a.order - b.order;
      return naturalCompare(a.name, b.name); // Tiebreaker
    }
    if (a.order != null) return -1; // a has order, comes first
    if (b.order != null) return 1;  // b has order, comes first
    return naturalCompare(a.name, b.name); // Both no order: natural sort
  });
}

function formatErrorForModal(err: BoardError): string {
  const lines: string[] = [];

  lines.push(err.message);
  lines.push('');

  if (err.code) lines.push(`Code:        ${err.code}`);
  if (err.httpStatus) lines.push(`HTTP Status: ${err.httpStatus}`);

  const d = err.details;
  if (d) {
    if (d.errorId) lines.push(`Error ID:      ${d.errorId}`);
    if (d.boardDir) lines.push(`Board Dir:     ${d.boardDir}`);
    if (d.contentType) lines.push(`Content-Type:  ${d.contentType}`);
    if (d.timestamp) lines.push(`Timestamp:     ${d.timestamp}`);
    if (d.hint) {
      lines.push('');
      lines.push(`Hint: ${d.hint}`);
    }
    if (d.raw && d.raw !== err.message) {
      lines.push('');
      lines.push('--- Raw Response ---');
      lines.push(d.raw);
    }
    if (d.stack) {
      lines.push('');
      lines.push('--- Stack Trace ---');
      lines.push(d.stack);
    }
  }

  return lines.join('\n');
}

function extractTaskCode(task: BoardTask): string | null {
  if (task.parentId) {
    const fileName = task.id.split('/').pop() || '';
    const match = fileName.match(/^s(\d+)-(\d+)/i);
    if (match) return `S${match[1]}.${match[2]}`;
  }
  const id = task.id.split('/')[0];
  const epicMatch = id.match(/^(E\d+)/i);
  if (epicMatch) return epicMatch[1].toUpperCase();
  // Standalone task: t{NN}
  const standaloneMatch = id.match(/^(t\d+)/i);
  if (standaloneMatch) return standaloneMatch[1].toUpperCase();
  return null;
}


function formatModelName(model: string): string {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return model;
}

const PRIORITY_INLINE_COLORS: Record<string, string> = {
  P0: 'text-utility-error-600',
  P1: 'text-utility-warning-600',
  P2: 'text-utility-yellow-600',
  P3: 'text-utility-gray-600',
};

function AcDonut({ done, total, label = 'ACs' }: { done: number; total: number; label?: string }) {
  const size = 20;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const dashOffset = circumference * (1 - progress);
  const allDone = done === total;
  const remaining = total - done;

  return (
    <Tooltip
      title={allDone ? `All ${total} ${label} completed` : `${done}/${total} ${label} completed`}
      description={allDone ? undefined : `${remaining} ${label} still pending`}
      placement="top"
    >
      <TooltipTrigger className="shrink-0 cursor-default">
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-quaternary/20" />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" className={allDone ? 'text-utility-success-500' : 'text-utility-brand-500'} />
        </svg>
      </TooltipTrigger>
    </Tooltip>
  );
}

function GenerateProgressDonut({ created, total }: { created: number; total: number }) {
  const size = 12;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? created / total : 0;
  const dashOffset = circumference * (1 - progress);
  const allDone = created === total && total > 0;

  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-current/20" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" className={allDone ? 'text-utility-success-500' : 'text-utility-brand-500'} />
    </svg>
  );
}

function AddStatusDropdown({ taskId, onAddStatus, disabled }: { taskId: string; onAddStatus: (taskId: string, status: string) => void; disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (dropdownRef.current && !(dropdownRef.current as any).contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const statusOptions = [
    { value: 'Not Started', label: 'Not Started', color: 'text-utility-gray-700' },
    { value: 'In Progress', label: 'In Progress', color: 'text-utility-brand-700' },
    { value: 'Done', label: 'Done', color: 'text-utility-success-700' }
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip
        title={disabled ? "Adding status..." : "Add status"}
        description={disabled ? "Please wait while the status is being updated" : "Choose a status for this task"}
      >
        <button
          type="button"
          onClick={(e: any) => {
            e.stopPropagation();
            if (!disabled) setIsOpen(!isOpen);
          }}
          disabled={disabled}
          className={cx(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
            disabled
              ? 'bg-utility-gray-100 text-utility-gray-400 cursor-not-allowed'
              : 'bg-utility-brand-50 text-utility-brand-700 hover:bg-utility-brand-100 border border-utility-brand-200'
          )}
        >
          <Plus className="size-3" />
          <span>Add Status</span>
        </button>
      </Tooltip>
      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-40 rounded-lg border border-secondary bg-primary shadow-lg">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={(e: any) => {
                e.stopPropagation();
                onAddStatus(taskId, option.value);
                setIsOpen(false);
              }}
              className={cx(
                'w-full px-3 py-2 text-left text-sm transition hover:bg-primary_hover first:rounded-t-lg last:rounded-b-lg',
                option.color
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Epic Fix Dropdown ───────────────────────────────────────────────

const EPIC_FIX_OPTIONS = [
  { key: 'all', label: 'Fix All', description: 'Run all fixes sequentially', icon: Tool01 },
  { key: 'models', label: 'Fix Models', description: 'Assign models based on complexity', icon: CpuChip01 },
  { key: 'agents', label: 'Fix Agents', description: 'Assign agents based on task content', icon: Users01 },
  { key: 'status', label: 'Fix Status', description: 'Sync status with AC completion', icon: CheckCircle },
  { key: 'stories', label: 'Fix Stories', description: 'Restructure and reorder stories', icon: Stars01 },
  { key: 'acs', label: 'Verify ACs', description: 'Verify ACs against codebase', icon: Target02 },
] as const;

const TASK_FIX_OPTIONS = [
  { key: 'all', label: 'Fix All', description: 'Run all fixes sequentially', icon: Tool01 },
  { key: 'model', label: 'Fix Model', description: 'Assign model based on complexity', icon: CpuChip01 },
  { key: 'agents', label: 'Fix Agents', description: 'Assign agents based on task content', icon: Users01 },
  { key: 'status', label: 'Fix Status', description: 'Sync status with AC completion', icon: CheckCircle },
  { key: 'acs', label: 'Verify ACs', description: 'Verify ACs against codebase', icon: Target02 },
] as const;

function EpicFixDropdown({
  epicId,
  onFix,
  isFixing,
  isAnyOperationRunning,
  currentFixType,
}: {
  epicId: string;
  onFix: (epicId: string, fixType: string) => void;
  isFixing: boolean;
  isAnyOperationRunning: boolean;
  currentFixType: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const runningLabel = EPIC_FIX_OPTIONS.find((o) => o.key === currentFixType)?.label || currentFixType;

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip
        title={isFixing ? `${runningLabel}...` : 'Fix tasks'}
        description={isFixing ? 'Fix operation in progress' : 'Open fix options menu'}
      >
        <TooltipTrigger
          onPress={() => { if (!isAnyOperationRunning) setIsOpen(!isOpen); }}
          isDisabled={isAnyOperationRunning}
          className={cx(
            'flex h-6 items-center gap-0.5 rounded-sm px-2 text-xs transition',
            isFixing
              ? 'text-utility-warning-600 bg-utility-warning-50'
              : isAnyOperationRunning
                ? 'text-quaternary cursor-not-allowed'
                : 'text-tertiary hover:text-utility-warning-600 hover:bg-utility-warning-50'
          )}
        >
          {isFixing
            ? <RefreshCw01 className="size-3 animate-spin" />
            : <Tool01 className="size-3" />}
          <ChevronDown className={cx('size-2.5 transition-transform', isOpen && 'rotate-180')} />
        </TooltipTrigger>
      </Tooltip>
      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-secondary bg-primary shadow-lg py-1">
          {EPIC_FIX_OPTIONS.map((option) => {
            const isRunning = isFixing && currentFixType === option.key;
            const OptionIcon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onFix(epicId, option.key);
                  setIsOpen(false);
                }}
                disabled={isFixing}
                className={cx(
                  'w-full flex items-start gap-2.5 px-3 py-2 text-left transition',
                  isFixing && !isRunning
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-primary_hover',
                  isRunning && 'bg-utility-warning-50'
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {isRunning
                    ? <RefreshCw01 className="size-3.5 text-utility-warning-600 animate-spin" />
                    : <OptionIcon className="size-3.5 text-tertiary" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-primary">{option.label}</div>
                  <div className="text-[10px] text-tertiary leading-tight">{option.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Task Fix Dropdown ───────────────────────────────────────────────

function TaskFixDropdown({
  taskId,
  onFix,
  isFixing,
  isAnyOperationRunning,
  currentFixType,
}: {
  taskId: string;
  onFix: (taskId: string, fixType: string) => void;
  isFixing: boolean;
  isAnyOperationRunning: boolean;
  currentFixType: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const runningLabel = TASK_FIX_OPTIONS.find((o) => o.key === currentFixType)?.label || currentFixType;

  return (
    <div className="relative" ref={dropdownRef} onClick={(e: any) => e.stopPropagation()}>
      <Tooltip
        title={isFixing ? `${runningLabel}...` : 'Fix task'}
        description={isFixing ? 'Fix operation in progress' : 'Open fix options menu'}
      >
        <TooltipTrigger
          onPress={() => { if (!isAnyOperationRunning) setIsOpen(!isOpen); }}
          isDisabled={isAnyOperationRunning}
          className={cx(
            'flex h-6 items-center gap-0.5 rounded-sm px-2 text-xs transition',
            isFixing
              ? 'text-utility-warning-600 bg-utility-warning-50'
              : isAnyOperationRunning
                ? 'text-quaternary cursor-not-allowed'
                : 'text-tertiary hover:text-utility-warning-600 hover:bg-utility-warning-50',
            isFixing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {isFixing
            ? <RefreshCw01 className="size-3 animate-spin" />
            : <Tool01 className="size-3" />}
          <ChevronDown className={cx('size-2.5 transition-transform', isOpen && 'rotate-180')} />
        </TooltipTrigger>
      </Tooltip>
      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-secondary bg-primary shadow-lg py-1">
          {TASK_FIX_OPTIONS.map((option) => {
            const isRunning = isFixing && currentFixType === option.key;
            const OptionIcon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                onClick={(e: any) => {
                  e.stopPropagation();
                  onFix(taskId, option.key);
                  setIsOpen(false);
                }}
                disabled={isFixing}
                className={cx(
                  'w-full flex items-start gap-2.5 px-3 py-2 text-left transition',
                  isFixing && !isRunning
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-primary_hover',
                  isRunning && 'bg-utility-warning-50'
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {isRunning
                    ? <RefreshCw01 className="size-3.5 text-utility-warning-600 animate-spin" />
                    : <OptionIcon className="size-3.5 text-tertiary" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-primary">{option.label}</div>
                  <div className="text-[10px] text-tertiary leading-tight">{option.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface BoardCardProps {
  key?: React.Key;
  task: BoardTask;
  epic: boolean;
  allTasks: BoardTask[];
  onClick: () => void;
  onFix?: (taskId: string, fixType: string) => void;
  fixStatus?: { status: string; startedAt?: string; completedAt?: string; error?: string };
  allFixStatuses?: Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>;
  showAddStatus?: boolean;
  onAddStatus?: (taskId: string, status: string) => void;
  addingStatus?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  fixingTaskType?: string | null;
  isGlobalOperationRunning?: boolean;
  footer?: ReactNode;
}

function BoardCard({ task, epic, allTasks, onClick, onFix, fixStatus, allFixStatuses, showAddStatus, onAddStatus, addingStatus, onDragStart, onDragEnd, dragging, fixingTaskType, isGlobalOperationRunning, footer }: BoardCardProps) {
  const taskCode = extractTaskCode(task);
  const parentEpic = task.parentId ? allTasks.find((t) => t.id === task.parentId) : null;
  const parentEpicCode = parentEpic ? extractTaskCode(parentEpic) : null;

  const isFixing = fixStatus?.status === 'running';

  // For epics, calculate progress based on child tasks with status "Done"
  const progressDone = epic
    ? allTasks.filter((t) => t.parentId === task.id && t.status?.toLowerCase() === 'done').length
    : task.acDone;
  const progressTotal = epic
    ? allTasks.filter((t) => t.parentId === task.id).length
    : task.acTotal;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={() => onDragEnd?.()}
      style={{ borderRadius: 'var(--board-card-radius)' }}
      className={cx(
        'group relative cursor-pointer bg-primary dark:bg-secondary p-4 shadow-sm transition-all duration-200 ease-out hover:shadow-lg',
        dragging && 'opacity-50'
      )}
    >
      {/* Epic gradient overlay — radial from outside top-left corner, opacity differs by theme */}
      {epic && (
        <>
          <div
            className="absolute inset-0 pointer-events-none dark:hidden"
            style={{ borderRadius: 'inherit', background: 'radial-gradient(circle at -15% -25%, rgba(168, 85, 247, 0.1) 0%, transparent 65%)' }}
          />
          <div
            className="absolute inset-0 pointer-events-none hidden dark:block"
            style={{ borderRadius: 'inherit', background: 'radial-gradient(circle at -15% -25%, rgba(168, 85, 247, 0.1) 0%, transparent 65%)' }}
          />
        </>
      )}
      {/* Donut chart — absolute top-right, does not affect row height */}
      {progressTotal > 0 && (
        <div className="absolute top-4 right-4">
          <AcDonut done={progressDone} total={progressTotal} label={epic ? 'tasks' : 'ACs'} />
        </div>
      )}

      {/* Row 1: code / priority — all card types */}
      {epic && taskCode && (
        /* Epic card */
        <div className="flex items-center gap-1 mb-2 text-[11px] text-quaternary font-mono tracking-wide">
          <Icon icon={Folder} className="size-3 shrink-0 text-utility-purple-600" />
          <span className="text-utility-purple-600">{taskCode}</span>
          {task.priority && (
            <>
              <span className="opacity-40">·</span>
              <span className={PRIORITY_INLINE_COLORS[task.priority] || ''}>{task.priority}</span>
            </>
          )}
        </div>
      )}
      {parentEpic && (
        /* Child task card */
        <div className="mb-2">
          <Tooltip title={parentEpic.name} placement="top">
            <TooltipTrigger className="flex items-center gap-1 text-[11px] text-quaternary font-mono tracking-wide cursor-default">
              <Icon icon={Folder} className="size-3 shrink-0" />
              {parentEpicCode && <span>{parentEpicCode}</span>}
              {taskCode && (
                <>
                  <span className="opacity-40">/</span>
                  <span>{taskCode}</span>
                </>
              )}
              {task.priority && (
                <>
                  <span className="opacity-40">·</span>
                  <span className={PRIORITY_INLINE_COLORS[task.priority] || ''}>{task.priority}</span>
                </>
              )}
            </TooltipTrigger>
          </Tooltip>
        </div>
      )}
      {!epic && !parentEpic && (taskCode || task.priority) && (
        /* Standalone task card */
        <div className="flex items-center gap-1 mb-2 text-[11px] text-quaternary font-mono tracking-wide">
          {taskCode && <span>{taskCode}</span>}
          {taskCode && task.priority && <span className="opacity-40">·</span>}
          {task.priority && (
            <span className={PRIORITY_INLINE_COLORS[task.priority] || ''}>{task.priority}</span>
          )}
        </div>
      )}

      {/* Row 2: Title + Fix button */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-primary">
            {task.name}
          </p>
          {/* Divider */}
          {(task.agents?.length > 0 || task.model) && (
            <div className="mt-2 border-t border-secondary/40" />
          )}
          {/* Agents row */}
          {task.agents?.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-quaternary w-full">
              <Icon icon={Users01} className="size-3 shrink-0" />
              <span>{task.agents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')}</span>
            </div>
          )}
          {/* Model row */}
          {task.model && (
            <div className={cx(task.agents?.length > 0 ? 'mt-0.5' : 'mt-2', 'flex items-center gap-1.5 text-[11px] text-quaternary w-full')}>
              <Icon icon={CpuChip01} className="size-3 shrink-0" />
              <span>{formatModelName(task.model)}</span>
            </div>
          )}
        </div>
      </div>
      {onFix && !epic && (
        <div className="absolute bottom-4 right-4">
          <TaskFixDropdown
            taskId={task.id}
            onFix={onFix}
            isFixing={isFixing}
            isAnyOperationRunning={!!isGlobalOperationRunning}
            currentFixType={isFixing ? (fixingTaskType || null) : null}
          />
        </div>
      )}

      {/* Row 2.5: Add Status button (only in Missing Status column) */}
      {showAddStatus && onAddStatus && (
        <div className="mt-2">
          <AddStatusDropdown taskId={task.id} onAddStatus={onAddStatus} disabled={addingStatus} />
        </div>
      )}


      {/* Footer: Epic actions bar (expand toggle, add, generate, fix) */}
      {footer && (
        <div
          className="mt-3 pt-2.5 border-t border-secondary/40"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      )}

    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse bg-primary dark:bg-secondary p-4 shadow-sm" style={{ borderRadius: 'var(--board-card-radius)' }}>
      <div className="h-4 w-3/4 rounded bg-quaternary" />
      <div className="mt-3 flex gap-2">
        <div className="h-5 w-8 rounded-full bg-quaternary" />
      </div>
    </div>
  );
}

export function BoardTab({ apiBaseUrl, showToast, refreshTrigger, onShowErrorDetail, onError, setFixingTaskId: setFixingTaskIdProp, setupComplete, onNavigateToSetup }: BoardTabProps) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState<BoardError | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixStatus, setFixStatus] = useState<Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>>({});
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [expandedEpics, setExpandedEpics] = useState(() => new Set<string>());
  const [addingStatus, setAddingStatus] = useState(false);
  const [draggedTask, setDraggedTask] = useState<BoardTask | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedEpicId, setDraggedEpicId] = useState(null as string | null);
  const [epicDropBeforeId, setEpicDropBeforeId] = useState(null as string | null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDefaultEpicId, setCreateDefaultEpicId] = useState<string | undefined>(undefined);
  const [createDefaultType, setCreateDefaultType] = useState<string | undefined>(undefined);
  const [ideaModalOpen, setIdeaModalOpen] = useState(false);
  const [emptyBoardModalOpen, setEmptyBoardModalOpen] = useState(false);
  const [epicsOnboardingModalOpen, setEpicsOnboardingModalOpen] = useState(false);
  const [generatingEpicIds, setGeneratingEpicIds] = useState(new Set<string>());
  const [generateProgressMap, setGenerateProgressMap] = useState(new Map<string, { created: number; total: number; phase: string | null }>());
  const generatePollRefs = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [fixingEpicId, setFixingEpicId] = useState(null as string | null);
  const [fixingEpicType, setFixingEpicType] = useState(null as string | null);
  const [fixingTaskId, setFixingTaskId] = useState(null as string | null);
  const [fixingTaskType, setFixingTaskType] = useState(null as string | null);
  const [boardExists, setBoardExists] = useState<boolean | null>(null);
  const [boardDir, setBoardDir] = useState<string | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const mountedRef = useRef(true);

  const checkBoardExists = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/exists`);
      if (!response.ok) return true;
      const data = await response.json();
      if (mountedRef.current) {
        setBoardExists(data.exists);
        setBoardDir(data.boardDir || null);
      }
      return data.exists;
    } catch {
      return true; // assume exists on error, fall through to normal fetch
    }
  }, [apiBaseUrl]);

  const toggleEpic = useCallback((epicId: string) => {
    setExpandedEpics(prev => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }, []);

  const fetchFixStatus = useCallback(
    async () => {
      try {
        const url = `${apiBaseUrl}/api/board/fix-status`;
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (!mountedRef.current) return;

        if (response.ok) {
          const payload = await response.json().catch(() => ({}));
          if (payload.ok && payload.fixStatus) {
            setFixStatus(payload.fixStatus);
          }
        }
      } catch {
        // Silently fail - fix status is not critical
      }
    },
    [apiBaseUrl]
  );

  const fetchBoard = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const url = `${apiBaseUrl}/api/board`;
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (!mountedRef.current) return;

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (!isJson) {
          const rawBody = await response.text().catch(() => '');
          const isDev = window.location.port === '5174';
          const err: BoardError = {
            message: isDev
              ? 'Panel server is not running. In dev mode, both the Vite dev server and the panel server must be running. Start it with: npm run panel'
              : 'Could not connect to the panel server API.',
            code: 'NOT_JSON',
            details: {
              errorId: `board-${Date.now()}`,
              httpStatus: response.status,
              contentType,
              hint: isDev
                ? 'You are using panel:dev (Vite on port 5174) which proxies /api requests to localhost:4100. The panel server is not running on port 4100. Run "npm run panel" in a separate terminal.'
                : 'Make sure the panel server is running (npm run panel).',
              raw: rawBody.slice(0, 2000),
              timestamp: new Date().toISOString()
            },
            httpStatus: response.status
          };
          setBoardError(err);
          if (!silent) showToast(err.message, 'danger');

          // Report to debug errors
          onError?.(err.message, {
            stderr: err.details?.raw || rawBody,
            stdout: err.details?.hint
          });
          return;
        }

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const err: BoardError = {
            message: payload?.message || `HTTP ${response.status}`,
            code: payload?.code || null,
            details: payload?.details || null,
            httpStatus: response.status
          };
          setBoardError(err);
          if (!silent) showToast(err.message, 'danger');

          // Report to debug errors
          onError?.(err.message, {
            stderr: JSON.stringify(payload, null, 2)
          });
          return;
        }

        setTasks(payload.tasks || []);
        setLastRefreshed(new Date());
        setBoardError(null);

        // Fetch fix status after loading tasks
        await fetchFixStatus();
      } catch (err: any) {
        if (!mountedRef.current) return;
        const isDev = window.location.port === '5174';
        const networkError: BoardError = {
          message: err instanceof TypeError
            ? (isDev
              ? 'Panel server is not running. In dev mode, run "npm run panel" in a separate terminal.'
              : 'Could not reach the panel server. Is it running?')
            : (err.message || 'Unknown error'),
          code: 'NETWORK_ERROR',
          details: {
            errorId: `board-${Date.now()}`,
            hint: isDev
              ? 'You are using panel:dev (Vite on port 5174) which proxies /api requests to localhost:4100. The panel server is not running on port 4100.'
              : 'Make sure the panel server is running (npm run panel).',
            raw: err.message,
            stack: err.stack?.split('\n').slice(0, 4).join('\n'),
            timestamp: new Date().toISOString()
          },
          httpStatus: null
        };
        setBoardError(networkError);
        if (!silent) showToast(networkError.message, 'danger');

        // Report to debug errors
        onError?.(networkError.message, {
          stack: err.stack,
          stderr: networkError.details?.raw || err.message,
          stdout: networkError.details?.hint
        });
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [apiBaseUrl, showToast]
  );

  const createBoardDirectory = useCallback(async () => {
    setCreatingBoard(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/create-directory`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(data.message || 'Failed to create Board directory', 'danger');
        return;
      }
      setBoardExists(true);
      showToast('Board directory created successfully', 'success');
      await fetchBoard();
    } catch (err: any) {
      showToast(err.message || 'Failed to create Board directory', 'danger');
    } finally {
      if (mountedRef.current) setCreatingBoard(false);
    }
  }, [apiBaseUrl, showToast, fetchBoard]);

  const fixBoardOrder = useCallback(async () => {
    setFixing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/fix-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Fix order failed', 'danger');
        return;
      }
      const totalFixes = (payload.fixed?.length || 0) + (payload.fixedChildren?.length || 0);
      if (totalFixes > 0) {
        const parts: string[] = [];
        if (payload.fixed?.length > 0) {
          parts.push(`${payload.fixed.length} epic(s)`);
        }
        if (payload.fixedChildren?.length > 0) {
          parts.push(`${payload.fixedChildren.length} child task(s)`);
        }
        showToast(`Fixed ${parts.join(' and ')}. API restarted.`, 'success');
      } else {
        showToast('Board order is already correct', 'neutral');
      }
      await fetchBoard(true);
    } catch (err: any) {
      showToast(err.message || 'Fix order failed', 'danger');
    } finally {
      if (mountedRef.current) setFixing(false);
    }
  }, [apiBaseUrl, showToast, fetchBoard]);

  const handleFixTask = useCallback(async (taskId: string, fixType: string) => {
    // Update local state optimistically
    setFixStatus((prev: Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>) => ({
      ...prev,
      [taskId]: { status: 'running', startedAt: new Date().toISOString() }
    }));
    setFixingTaskIdProp?.(taskId);
    setFixingTaskId(taskId);
    setFixingTaskType(fixType);

    try {
      const response = await fetch(`${apiBaseUrl}/api/board/fix-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, fixType })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Fix task failed', 'danger');
        await fetchFixStatus();
        setFixingTaskIdProp?.(null);
        setFixingTaskId(null);
        setFixingTaskType(null);
        return;
      }
      const typeLabel = TASK_FIX_OPTIONS.find((o) => o.key === fixType)?.label || fixType;
      showToast(`${typeLabel} completed: ${taskId}`, 'success');
      setFixingTaskIdProp?.(null);
      setFixingTaskId(null);
      setFixingTaskType(null);
      await fetchBoard(true);
    } catch (err: any) {
      showToast(err.message || 'Fix task failed', 'danger');
      await fetchFixStatus();
      setFixingTaskIdProp?.(null);
      setFixingTaskId(null);
      setFixingTaskType(null);
    } finally {
      if (mountedRef.current) {
        setFixingTaskIdProp?.(null);
        setFixingTaskId(null);
        setFixingTaskType(null);
      }
    }
  }, [apiBaseUrl, showToast, fetchBoard, fetchFixStatus, setFixingTaskIdProp]);

  const handleAddStatus = useCallback(async (taskId: string, status: string) => {
    setAddingStatus(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Failed to update task status', 'danger');
        return;
      }
      showToast(`Status updated to "${status}"`, 'success');
      await fetchBoard(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to update task status', 'danger');
    } finally {
      if (mountedRef.current) {
        setAddingStatus(false);
      }
    }
  }, [apiBaseUrl, showToast, fetchBoard]);

  const handleDrop = useCallback(async (targetColumnKey: string) => {
    setDragOverColumn(null);
    if (!draggedTask) return;

    const targetStatus = COLUMN_STATUS_MAP[targetColumnKey];
    if (!targetStatus) return;
    if (draggedTask.status?.toLowerCase() === targetStatus.toLowerCase()) {
      setDraggedTask(null);
      return;
    }

    const movedTask = draggedTask;
    setDraggedTask(null);

    // Optimistic update
    setTasks((prev) => prev.map((t) =>
      t.id === movedTask.id ? { ...t, status: targetStatus } : t
    ));

    try {
      const response = await fetch(`${apiBaseUrl}/api/board/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: movedTask.id, status: targetStatus })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Failed to move task', 'danger');
        await fetchBoard(true);
        return;
      }
      showToast(`Moved "${movedTask.name}" to ${targetStatus}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to move task', 'danger');
      await fetchBoard(true);
    }
  }, [draggedTask, apiBaseUrl, showToast, fetchBoard]);

  const handleEpicDragStart = useCallback((e: any, epicId: string) => {
    e.stopPropagation(); // Don't trigger status column drag
    setDraggedEpicId(epicId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleEpicDragOver = useCallback((e: any, targetEpicId: string, status: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedEpicId || draggedEpicId === targetEpicId) return;

    // Only allow reordering within same status column
    const draggedTask = tasks.find((t: BoardTask) => t.id === draggedEpicId);
    if (draggedTask?.status !== status) return;

    // Determine if dropping above or below target
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const isAbove = e.clientY < midpoint;

    setEpicDropBeforeId(isAbove ? targetEpicId : null);
  }, [draggedEpicId, tasks]);

  const handleEpicDragEnd = useCallback(() => {
    setDraggedEpicId(null);
    setEpicDropBeforeId(null);
  }, []);

  const handleEpicDrop = useCallback(async (e: any, targetEpicId: string, status: string) => {
    e.preventDefault();
    e.stopPropagation();

    const draggedId = draggedEpicId;
    if (!draggedId || draggedId === targetEpicId) {
      handleEpicDragEnd();
      return;
    }

    // Get all epics in same status, sorted
    const epicsInStatus = sortEpics(
      tasks.filter((t: BoardTask) => isEpic(t, tasks) && t.status === status)
    );

    const draggedIndex = epicsInStatus.findIndex((e: BoardTask) => e.id === draggedId);
    const targetIndex = epicsInStatus.findIndex((e: BoardTask) => e.id === targetEpicId);

    if (draggedIndex === -1 || targetIndex === -1) {
      handleEpicDragEnd();
      return;
    }

    // Reorder: remove dragged, insert at target position
    const reordered = [...epicsInStatus];
    const [draggedEpic] = reordered.splice(draggedIndex, 1);

    // Determine insert position based on drop zone
    // After splice, indices shift down by 1 when dragged item was before target
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const adjustedTarget = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertIndex = e.clientY < midpoint ? adjustedTarget : adjustedTarget + 1;

    reordered.splice(insertIndex, 0, draggedEpic);

    // Extract epic IDs in new order
    const epicIds = reordered.map((e: BoardTask) => e.id);

    // Optimistic update
    const updatedTasks = tasks.map((t: BoardTask) => {
      const newOrderIndex = epicIds.indexOf(t.id);
      if (newOrderIndex !== -1) {
        return { ...t, order: newOrderIndex + 1 }; // 1-based
      }
      return t;
    });
    setTasks(updatedTasks);

    handleEpicDragEnd();

    // API call
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/reorder-epics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epicIds, status })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(payload?.message || 'Failed to reorder epics', 'danger');
        await fetchBoard(true); // Revert
        return;
      }

      showToast('Epics reordered successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to reorder epics', 'danger');
      await fetchBoard(true); // Revert
    }
  }, [draggedEpicId, tasks, apiBaseUrl, showToast, fetchBoard, handleEpicDragEnd]);

  // Cleanup all polls on unmount
  useEffect(() => {
    return () => {
      generatePollRefs.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Helpers to add/remove a single epicId from the Set/Map states
  const addGenerating = useCallback((epicId: string, progress: { created: number; total: number; phase: string | null }) => {
    setGeneratingEpicIds((prev) => new Set([...prev, epicId]));
    setGenerateProgressMap((prev) => { const next = new Map(prev); next.set(epicId, progress); return next; });
  }, []);

  const removeGenerating = useCallback((epicId: string) => {
    setGeneratingEpicIds((prev) => { const next = new Set(prev); next.delete(epicId); return next; });
    setGenerateProgressMap((prev) => { const next = new Map(prev); next.delete(epicId); return next; });
  }, []);

  // Poll generation status for a specific epic until completion
  const startPollingGeneration = useCallback((epicId: string) => {
    const pollStatus = async () => {
      try {
        const statusRes = await fetch(`${apiBaseUrl}/api/board/generate-stories/status?epicId=${encodeURIComponent(epicId)}`);
        const status = await statusRes.json().catch(() => ({}));
        setGenerateProgressMap((prev) => {
          const next = new Map(prev);
          next.set(epicId, { created: status.created || 0, total: status.total || 0, phase: status.phase || null });
          return next;
        });

        if (status.running) {
          generatePollRefs.current.set(epicId, setTimeout(pollStatus, 1500));
        } else {
          const failed = status.failed || 0;
          const created = status.created || 0;
          const total = status.total || 0;
          const msg = failed > 0
            ? `Generated ${created} of ${total} stories (${failed} failed)`
            : `Generated ${created} stories`;
          showToast(msg, failed > 0 ? 'warning' : 'success');
          setExpandedEpics((prev) => { const next = new Set(prev); next.add(epicId); return next; });
          await fetchBoard(true);
          removeGenerating(epicId);
        }
      } catch {
        removeGenerating(epicId);
      }
    };

    pollStatus();
  }, [apiBaseUrl, showToast, fetchBoard, setExpandedEpics, removeGenerating]);

  // On mount: resume progress UI for any generations already running on the server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/board/generate-stories/status`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const sessions: any[] = data.sessions || (data.running && data.epicId ? [data] : []);
        for (const s of sessions) {
          if (s.running && s.epicId) {
            addGenerating(s.epicId, { created: s.created || 0, total: s.total || 0, phase: s.phase || null });
            startPollingGeneration(s.epicId);
          }
        }
      } catch {
        // ignore — server may not be reachable yet
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateStories = useCallback(async (epicId: string) => {
    addGenerating(epicId, { created: 0, total: 0, phase: 'planning' });

    try {
      const response = await fetch(`${apiBaseUrl}/api/board/generate-stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epicId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Failed to generate stories', 'danger');
        removeGenerating(epicId);
        return;
      }

      // Backend responds immediately; poll status until done
      startPollingGeneration(epicId);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate stories', 'danger');
      removeGenerating(epicId);
    }
  }, [apiBaseUrl, showToast, startPollingGeneration, addGenerating, removeGenerating]);

  const handleFixEpic = useCallback(async (epicId: string, fixType: string) => {
    setFixingEpicId(epicId);
    setFixingEpicType(fixType);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/fix-epic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epicId, fixType })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || `Failed to fix ${fixType}`, 'danger');
        return;
      }
      const typeLabel = EPIC_FIX_OPTIONS.find((o) => o.key === fixType)?.label || fixType;
      if (payload.changes === 0 && payload.total === 0) {
        showToast(payload.message || `${typeLabel}: nothing to fix`, 'neutral');
        return;
      }
      showToast(
        payload.message || `${typeLabel}: fixed ${payload.changes} of ${payload.total}`,
        payload.failed > 0 ? 'warning' : 'success'
      );
      setExpandedEpics((prev) => {
        const next = new Set(prev);
        next.add(epicId);
        return next;
      });
      await fetchBoard(true);
    } catch (err: any) {
      showToast(err.message || `Fix ${fixType} failed`, 'danger');
    } finally {
      setFixingEpicId(null);
      setFixingEpicType(null);
    }
  }, [apiBaseUrl, showToast, fetchBoard]);

  // Initial load + polling (check board existence first)
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const exists = await checkBoardExists();
      if (exists) {
        fetchBoard();
      } else {
        setLoading(false);
      }
    })();
    const interval = setInterval(async () => {
      if (boardExists !== false) {
        fetchBoard(true);
      }
    }, BOARD_POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchBoard, checkBoardExists]);

  // SSE-triggered refresh
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchBoard(true);
    }
  }, [refreshTrigger, fetchBoard]);

  const columns = useMemo(() => {
    const allColumns = BOARD_COLUMNS.map((col) => ({
      ...col,
      tasks: col.statusMatch === null
        ? tasks.filter((t: BoardTask) => !t.status || t.status.trim() === '')
        : tasks.filter((t: BoardTask) => t.status && t.status.toLowerCase() === col.statusMatch)
    }));

    // Hide Missing Status column when empty
    return allColumns.filter((col) => {
      if (col.key === 'missing_status') {
        return col.tasks.length > 0;
      }
      return true;
    });
  }, [tasks]);

  const totalCount = tasks.length;
  const showBoardMissing = boardExists === false && !loading;
  const showErrorBanner = boardError && !loading && tasks.length === 0 && !showBoardMissing;
  const showBoard = !showBoardMissing && (tasks.length > 0 || (loading && !showErrorBanner) || (!boardError && !loading));
  const isBoardEmpty = !loading && !boardError && !showBoardMissing && boardExists === true && tasks.length === 0 && setupComplete;

  const hasOnlyEmptyEpics = useMemo(() => {
    if (loading || boardError || !boardExists || !setupComplete || tasks.length === 0) return false;
    const epics = tasks.filter((t: BoardTask) => isEpic(t, tasks) && !t.parentId);
    if (epics.length === 0) return false;
    const nonEpicTasks = tasks.filter((t: BoardTask) => !isEpic(t, tasks) && !t.parentId);
    if (nonEpicTasks.length > 0) return false;
    return !tasks.some((t: BoardTask) => t.parentId);
  }, [loading, boardError, boardExists, setupComplete, tasks]);

  useEffect(() => {
    if (isBoardEmpty) {
      setEmptyBoardModalOpen(true);
    }
  }, [isBoardEmpty]);

  useEffect(() => {
    if (hasOnlyEmptyEpics && !localStorage.getItem('epicsOnboardingDismissed')) {
      setEpicsOnboardingModalOpen(true);
    }
  }, [hasOnlyEmptyEpics]);

  const handleEpicsOnboardingClose = useCallback(() => {
    setEpicsOnboardingModalOpen(false);
    localStorage.setItem('epicsOnboardingDismissed', '1');
  }, []);

  const handleViewDetails = useCallback(() => {
    if (!boardError) return;
    const title = boardError.code
      ? `Board Error — ${boardError.code}`
      : 'Board Error';
    onShowErrorDetail(title, formatErrorForModal(boardError));
  }, [boardError, onShowErrorDetail]);

  return (
    <section className="flex min-h-0 flex-1 min-w-0 flex-col gap-5">
      {/* Setup required banner */}
      {!setupComplete && <SetupRequiredBanner onNavigateToSetup={onNavigateToSetup} />}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Icon icon={Columns03} className="size-5 shrink-0 text-tertiary" />
          <h2 className="truncate text-2xl font-bold text-primary tracking-tight">Board</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0 sm:gap-3">
          <Tooltip title="Idea to Epics" description="Brainstorm product ideas with Claude and generate Epics">
            <TooltipTrigger
              onPress={() => setIdeaModalOpen(true)}
              aria-label="Idea to Epics"
              className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            >
              <Lightbulb02 className="size-3.5" />
              <span>Plan</span>
            </TooltipTrigger>
          </Tooltip>
          <Tooltip title="Create task" description="Create a new task or epic">
            <TooltipTrigger
              onPress={() => { setCreateDefaultEpicId(undefined); setCreateModalOpen(true); }}
              aria-label="Create new task"
              className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            >
              <Plus className="size-3.5" />
              <span>Task</span>
            </TooltipTrigger>
          </Tooltip>
          <Tooltip title="Fix board order" description="Fix epic and story numbering to ensure sequential ordering">
            <TooltipTrigger
              onPress={fixBoardOrder}
              isDisabled={fixing}
              aria-label="Fix board order"
              className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            >
              <Tool01 className={cx('size-4', fixing && 'animate-spin')} />
            </TooltipTrigger>
          </Tooltip>
          <Tooltip
            title="Refresh board"
            description={lastRefreshed ? `Updated at ${lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Refresh the board to see the latest task updates'}
          >
            <TooltipTrigger
              onPress={() => fetchBoard()}
              isDisabled={refreshing}
              aria-label="Refresh board"
              className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            >
              <RefreshCw01 className={cx('size-4', refreshing && 'animate-spin')} />
            </TooltipTrigger>
          </Tooltip>
        </div>
      </div>

      {/* Board directory missing state */}
      {showBoardMissing && (
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-xl border border-dashed border-secondary bg-secondary p-10 text-center max-w-md">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-utility-warning-50">
              <Icon icon={FolderPlus} className="size-6 text-warning-primary" />
            </div>
            <h3 className="text-base font-semibold text-primary">Board directory not found</h3>
            <p className="mt-2 text-sm text-tertiary">
              The target project does not have a <code className="rounded bg-quaternary px-1 py-0.5 text-xs">Board/</code> folder. Create it to start managing tasks.
            </p>
            {boardDir && (
              <p className="mt-1 text-xs text-quaternary font-mono truncate" title={boardDir}>
                {boardDir}
              </p>
            )}
            <div className="mt-5">
              <Button
                size="md"
                color="primary"
                iconLeading={FolderPlus}
                isLoading={creatingBoard}
                onPress={createBoardDirectory}
              >
                Create Board Folder
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {showErrorBanner && (
        <div className="rounded-xl bg-utility-error-50 p-8 text-center">
          <p className="text-sm font-medium text-error-primary">{boardError.message}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="sm" color="secondary" onPress={() => fetchBoard()}>
              Retry
            </Button>
            <Button size="sm" color="tertiary" onPress={handleViewDetails}>
              View Details
            </Button>
          </div>
        </div>
      )}

      {/* Board columns */}
      {showBoard && (
        <div className={cx('flex min-h-0 flex-1 snap-x snap-mandatory gap-5 overflow-x-auto pb-4 sm:snap-none sm:grid sm:overflow-x-visible sm:pb-0', columns.length >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-3')}>
          {columns.map((col) => (
            <div
              key={col.key}
              className="relative flex w-[85vw] shrink-0 snap-center flex-col bg-secondary_hover dark:bg-primary overflow-hidden sm:w-auto sm:shrink"
              style={{ borderRadius: 'var(--board-col-radius)' }}
            >
              {/* Frosted glass header — outside scroll container so backdrop-filter blurs cards */}
              <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none backdrop-blur-md">
                <div className="absolute inset-0 bg-gradient-to-b from-secondary_hover to-secondary_hover/40 dark:from-primary dark:to-primary/40" />
                <div className="relative flex items-center justify-between px-4 py-3 pointer-events-auto">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: col.key === 'not_started' ? '#9CA3AF'
                          : col.key === 'in_progress' ? 'rgb(239 104 32)'
                          : col.key === 'done' ? '#22C55E'
                          : '#F59E0B'
                      }}
                    />
                    <span className="text-sm font-semibold text-primary">{col.label}</span>
                    <span className="text-sm text-quaternary font-normal">{col.tasks.length}</span>
                  </div>
                </div>
              </div>
              {/* Cards - scrollable (drop zone) with bottom fade mask */}
              <div
                className={cx(
                  'flex-1 overflow-y-auto scrollbar-hide transition-colors',
                  dragOverColumn === col.key && col.statusMatch !== null && 'bg-tertiary/40'
                )}
                style={{
                  maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 2.5rem), transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 2.5rem), transparent 100%)',
                }}
                onDragOver={(e) => {
                  if (col.statusMatch === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverColumn(col.key);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(col.key);
                }}
              >
                {/* padding-top = header height (2.75rem) + card gap (0.75rem) = 3.5rem */}
                <div className="flex flex-col gap-3" style={{ padding: '3.5rem var(--board-col-padding) 2.5rem' }}>
                  {loading && tasks.length === 0 ? (
                    <>
                      <SkeletonCard />
                      <SkeletonCard />
                    </>
                  ) : col.tasks.length === 0 ? (
                    <div className="py-8 text-center text-sm text-quaternary">
                      No tasks
                    </div>
                  ) : (
                    (() => {
                      const isCollapsible = col.key === 'not_started' || col.key === 'done';
                      const isMissingStatus = col.key === 'missing_status';

                      if (!isCollapsible) {
                        return col.tasks.map((task) => {
                          const taskIsEpic = isEpic(task, tasks);
                          const showAddButton = isMissingStatus && taskIsEpic;
                          const card = (
                            <BoardCard
                              key={showAddButton ? undefined : task.id}
                              task={task}
                              epic={taskIsEpic}
                              allTasks={tasks}
                              onClick={() => setSelectedTask(task)}
                              onFix={handleFixTask}
                              fixStatus={fixStatus[task.id]}
                              allFixStatuses={fixStatus}
                              fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                              isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                              showAddStatus={isMissingStatus}
                              onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                              addingStatus={addingStatus}
                              onDragStart={() => setDraggedTask(task)}
                              onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                              dragging={draggedTask?.id === task.id}
                            />
                          );
                          if (showAddButton) {
                            return (
                              <div
                                key={task.id}
                                draggable={taskIsEpic}
                                onDragStart={taskIsEpic ? (e) => handleEpicDragStart(e, task.id) : undefined}
                                onDragOver={taskIsEpic ? (e) => handleEpicDragOver(e, task.id, task.status) : undefined}
                                onDrop={taskIsEpic ? (e) => handleEpicDrop(e, task.id, task.status) : undefined}
                                onDragEnd={taskIsEpic ? handleEpicDragEnd : undefined}
                                className={cx(
                                  'relative',
                                  taskIsEpic && draggedEpicId === task.id && 'opacity-50 cursor-grabbing'
                                )}
                              >
                                {taskIsEpic && epicDropBeforeId === task.id && (
                                  <div className="absolute -top-1 left-0 right-0 h-0.5 bg-utility-brand-500 z-10 rounded-full" />
                                )}
                                <BoardCard
                                  task={task}
                                  epic={taskIsEpic}
                                  allTasks={tasks}
                                  onClick={() => setSelectedTask(task)}
                                  onFix={handleFixTask}
                                  fixStatus={fixStatus[task.id]}
                                  allFixStatuses={fixStatus}
                                  fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                                  isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                                  showAddStatus={isMissingStatus}
                                  onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                  addingStatus={addingStatus}
                                  onDragStart={() => setDraggedTask(task)}
                                  onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                  dragging={draggedTask?.id === task.id}
                                  footer={
                                    <div className="flex items-center gap-1">
                                      <Tooltip title="Add task" description={`Create a new task in ${task.name}`}>
                                        <TooltipTrigger
                                          onPress={() => { setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                                        >
                                          <Plus className="size-3.5" />
                                        </TooltipTrigger>
                                      </Tooltip>
                                      <div className="flex-1" />
                                      <Tooltip
                                        title={generatingEpicIds.has(task.id) ? "Generating tasks..." : "Generate tasks"}
                                        description={generatingEpicIds.has(task.id) ? "Using Claude AI to create tasks" : "Auto-generate tasks with Claude AI"}
                                      >
                                        <TooltipTrigger
                                          onPress={() => handleGenerateStories(task.id)}
                                          isDisabled={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                          className={cx(
                                            'flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-all duration-200',
                                            generatingEpicIds.has(task.id)
                                              ? 'text-brand-secondary bg-utility-brand-50'
                                              : (generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null)
                                                ? 'text-quaternary cursor-not-allowed'
                                                : 'text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10'
                                          )}
                                        >
                                          {generatingEpicIds.has(task.id)
                                            ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                              ? <GenerateProgressDonut created={generateProgressMap.get(task.id)!.created} total={generateProgressMap.get(task.id)!.total} />
                                              : <div className="size-3 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current" />)
                                            : <Stars01 className="size-3" />}
                                          <span className="hidden min-[961px]:inline">{generatingEpicIds.has(task.id)
                                            ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                              ? (generateProgressMap.get(task.id)?.phase === 'planning' ? 'Planning...' : `${generateProgressMap.get(task.id)!.created}/${generateProgressMap.get(task.id)!.total}`)
                                              : 'Planning...')
                                            : 'Generate'}</span>
                                        </TooltipTrigger>
                                      </Tooltip>
                                      <EpicFixDropdown
                                        epicId={task.id}
                                        onFix={handleFixEpic}
                                        isFixing={fixingEpicId === task.id}
                                        isAnyOperationRunning={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                        currentFixType={fixingEpicId === task.id ? fixingEpicType : null}
                                      />
                                    </div>
                                  }
                                />
                              </div>
                            );
                          }

                          // Wrap Epic cards in draggable container
                          if (taskIsEpic) {
                            return (
                              <div
                                key={task.id}
                                draggable
                                onDragStart={(e) => handleEpicDragStart(e, task.id)}
                                onDragOver={(e) => handleEpicDragOver(e, task.id, task.status)}
                                onDrop={(e) => handleEpicDrop(e, task.id, task.status)}
                                onDragEnd={handleEpicDragEnd}
                                className={cx(
                                  'relative',
                                  draggedEpicId === task.id && 'opacity-50 cursor-grabbing'
                                )}
                              >
                                {/* Drop indicator line */}
                                {epicDropBeforeId === task.id && (
                                  <div className="absolute -top-1 left-0 right-0 h-0.5 bg-utility-brand-500 z-10 rounded-full" />
                                )}
                                {card}
                              </div>
                            );
                          }

                          return card;
                        });
                      }

                      // Sort by execution order: group by epic root, parent before children
                      const sorted = [...col.tasks].sort((a, b) => {
                        const groupA = a.parentId || a.id.split('/')[0];
                        const groupB = b.parentId || b.id.split('/')[0];

                        if (groupA !== groupB) {
                          // Different groups - check if they're epics and have order field
                          const taskA = tasks.find((t: BoardTask) => t.id === groupA);
                          const taskB = tasks.find((t: BoardTask) => t.id === groupB);

                          if (taskA?.order != null && taskB?.order != null) {
                            if (taskA.order !== taskB.order) return taskA.order - taskB.order;
                          }
                          if (taskA?.order != null) return -1;
                          if (taskB?.order != null) return 1;

                          return naturalCompare(groupA, groupB);
                        }

                        // Same group - epic parent comes before its children
                        if (!a.parentId && b.parentId) return -1;
                        if (a.parentId && !b.parentId) return 1;
                        return naturalCompare(a.id, b.id);
                      });

                      // Group epic children under their parent when both are in the same column
                      const epicChildMap = new Map<string, BoardTask[]>();
                      const groupedChildIds = new Set<string>();

                      for (const t of sorted) {
                        if (t.parentId && sorted.some((p) => p.id === t.parentId)) {
                          if (!epicChildMap.has(t.parentId)) epicChildMap.set(t.parentId, []);
                          epicChildMap.get(t.parentId)!.push(t);
                          groupedChildIds.add(t.id);
                        }
                      }

                      return sorted
                        .filter((t) => !groupedChildIds.has(t.id))
                        .map((task) => {
                          const children = epicChildMap.get(task.id);
                          if (children && children.length > 0) {
                            const expanded = expandedEpics.has(task.id);
                            return (
                              <div
                                key={task.id}
                                draggable
                                onDragStart={(e) => handleEpicDragStart(e, task.id)}
                                onDragOver={(e) => handleEpicDragOver(e, task.id, task.status)}
                                onDrop={(e) => handleEpicDrop(e, task.id, task.status)}
                                onDragEnd={handleEpicDragEnd}
                                className={cx('relative flex flex-col isolate overflow-hidden', draggedEpicId === task.id && 'opacity-50 cursor-grabbing')}
                              >
                                {epicDropBeforeId === task.id && (
                                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-utility-brand-500 z-10 rounded-full" />
                                )}
                                {/* Epic card with action footer inside — always on top of children stack */}
                                <div className="relative" style={{ zIndex: 2 }}>
                                  <BoardCard
                                    task={task}
                                    epic
                                    allTasks={tasks}
                                    onClick={() => setSelectedTask(task)}
                                    onFix={handleFixTask}
                                    fixStatus={fixStatus[task.id]}
                                    allFixStatuses={fixStatus}
                                    fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                                    isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                                    showAddStatus={isMissingStatus}
                                    onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                    addingStatus={addingStatus}
                                    onDragStart={() => setDraggedTask(task)}
                                    onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                    dragging={draggedTask?.id === task.id}
                                    footer={
                                      <div className="flex items-center gap-1">
                                        <Tooltip title={expanded ? "Collapse stories" : "Expand stories"} description={expanded ? "Hide child tasks" : "Show child tasks"}>
                                          <TooltipTrigger
                                            onPress={() => toggleEpic(task.id)}
                                            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                                          >
                                            <ChevronDown className={cx('size-3 shrink-0 transition-transform duration-200', !expanded && '-rotate-90')} />
                                            <span className="whitespace-nowrap">{children.length} {children.length === 1 ? 'task' : 'tasks'}</span>
                                          </TooltipTrigger>
                                        </Tooltip>
                                        {(col.key === 'not_started' || col.key === 'missing_status') && (
                                          <>
                                            <Tooltip title="Add task" description={`Create a new task in ${task.name}`}>
                                              <TooltipTrigger
                                                onPress={() => { setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                                className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                                              >
                                                <Plus className="size-3.5" />
                                              </TooltipTrigger>
                                            </Tooltip>
                                            <div className="flex-1" />
                                            <Tooltip
                                              title={generatingEpicIds.has(task.id) ? "Generating tasks..." : "Generate tasks"}
                                              description={generatingEpicIds.has(task.id) ? "Using Claude AI to create tasks" : "Auto-generate tasks with Claude AI"}
                                            >
                                              <TooltipTrigger
                                                onPress={() => handleGenerateStories(task.id)}
                                                isDisabled={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                                className={cx(
                                                  'flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-all duration-200',
                                                  generatingEpicIds.has(task.id)
                                                    ? 'text-brand-secondary bg-utility-brand-50'
                                                    : (generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null)
                                                      ? 'text-quaternary cursor-not-allowed'
                                                      : 'text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10'
                                                )}
                                              >
                                                {generatingEpicIds.has(task.id)
                                                  ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                                    ? <GenerateProgressDonut created={generateProgressMap.get(task.id)!.created} total={generateProgressMap.get(task.id)!.total} />
                                                    : <div className="size-3 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current" />)
                                                  : <Stars01 className="size-3" />}
                                                <span className="hidden min-[961px]:inline">{generatingEpicIds.has(task.id)
                                                  ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                                    ? (generateProgressMap.get(task.id)?.phase === 'planning' ? 'Planning...' : `${generateProgressMap.get(task.id)!.created}/${generateProgressMap.get(task.id)!.total}`)
                                                    : 'Planning...')
                                                  : 'Generate'}</span>
                                              </TooltipTrigger>
                                            </Tooltip>
                                            <EpicFixDropdown
                                              epicId={task.id}
                                              onFix={handleFixEpic}
                                              isFixing={fixingEpicId === task.id}
                                              isAnyOperationRunning={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                              currentFixType={fixingEpicId === task.id ? fixingEpicType : null}
                                            />
                                          </>
                                        )}
                                      </div>
                                    }
                                  />
                                </div>
                                {/* Children — stacking deck (collapsed) / normal list (expanded) */}
                                <div
                                  className="flex flex-col"
                                  style={{ marginTop: expanded ? 8 : 0, transition: 'margin-top 300ms ease' }}
                                >
                                  {children.map((child, i) => {
                                    const isPeek = !expanded && i < 2;
                                    const isHidden = !expanded && i >= 2;
                                    return (
                                      <div
                                        key={child.id}
                                        style={{
                                          position: 'relative',
                                          zIndex: expanded ? undefined : -(i + 1),
                                          maxHeight: expanded ? 300 : isPeek ? 8 : 0,
                                          overflow: isHidden ? 'hidden' : 'visible',
                                          opacity: expanded ? 1 : isHidden ? 0 : 1,
                                          marginTop: expanded ? (i === 0 ? 0 : 8) : 0,
                                          pointerEvents: expanded ? 'auto' : 'none',
                                          transition: expanded
                                            ? 'max-height 350ms ease, opacity 250ms ease, margin-top 300ms ease'
                                            : isHidden
                                              ? 'max-height 0ms, opacity 0ms, margin-top 0ms'
                                              : 'max-height 250ms ease, opacity 200ms ease, margin-top 250ms ease',
                                          transitionDelay: expanded
                                            ? `${i * 60}ms`
                                            : `${Math.max(0, 2 - i) * 30}ms`,
                                        }}
                                      >
                                        <div style={{
                                          transform: expanded
                                            ? 'scale(1) translateY(0)'
                                            : isPeek
                                              ? `scale(${0.95 - i * 0.05}) translateY(calc(-100% + 8px))`
                                              : 'scale(0.85) translateY(-100%)',
                                          transformOrigin: 'center top',
                                          transition: expanded
                                            ? 'transform 350ms ease'
                                            : isHidden
                                              ? 'transform 0ms'
                                              : 'transform 250ms ease',
                                          transitionDelay: expanded
                                            ? `${i * 60}ms`
                                            : `${Math.max(0, 2 - i) * 30}ms`,
                                        }}>
                                          <BoardCard
                                            task={child}
                                            epic={false}
                                            allTasks={tasks}
                                            onClick={() => setSelectedTask(child)}
                                            onFix={handleFixTask}
                                            fixStatus={fixStatus[child.id]}
                                            allFixStatuses={fixStatus}
                                            fixingTaskType={fixingTaskId === child.id ? fixingTaskType : null}
                                            isGlobalOperationRunning={!expanded || fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                                            showAddStatus={isMissingStatus}
                                            onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                            addingStatus={addingStatus}
                                            onDragStart={() => setDraggedTask(child)}
                                            onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                            dragging={draggedTask?.id === child.id}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          const taskIsEpic = isEpic(task, tasks);
                          const showAddButton = (col.key === 'not_started' || col.key === 'missing_status') && taskIsEpic;
                          if (showAddButton) {
                            const card = (
                              <BoardCard
                                key={taskIsEpic ? undefined : task.id}
                                task={task}
                                epic={taskIsEpic}
                                allTasks={tasks}
                                onClick={() => setSelectedTask(task)}
                                onFix={handleFixTask}
                                fixStatus={fixStatus[task.id]}
                                allFixStatuses={fixStatus}
                                fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                                isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                                showAddStatus={isMissingStatus}
                                onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                addingStatus={addingStatus}
                                onDragStart={() => setDraggedTask(task)}
                                onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                dragging={draggedTask?.id === task.id}
                                footer={
                                  <div className="flex items-center gap-1">
                                    <Tooltip title="Add task" description={`Create a new task in ${task.name}`}>
                                      <TooltipTrigger
                                        onPress={() => { setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                        className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                                      >
                                        <Plus className="size-3.5" />
                                      </TooltipTrigger>
                                    </Tooltip>
                                    <div className="flex-1" />
                                    <Tooltip
                                      title={generatingEpicIds.has(task.id) ? "Generating tasks..." : "Generate tasks"}
                                      description={generatingEpicIds.has(task.id) ? "Using Claude AI to create tasks" : "Auto-generate tasks with Claude AI"}
                                    >
                                      <TooltipTrigger
                                        onPress={() => handleGenerateStories(task.id)}
                                        isDisabled={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                        className={cx(
                                          'flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-all duration-200',
                                          generatingEpicIds.has(task.id)
                                            ? 'text-brand-secondary bg-utility-brand-50'
                                            : (generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null)
                                              ? 'text-quaternary cursor-not-allowed'
                                              : 'text-tertiary hover:text-secondary hover:bg-black/5 dark:hover:bg-white/10'
                                        )}
                                      >
                                        {generatingEpicIds.has(task.id)
                                          ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                            ? <GenerateProgressDonut created={generateProgressMap.get(task.id)!.created} total={generateProgressMap.get(task.id)!.total} />
                                            : <div className="size-3 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current" />)
                                          : <Stars01 className="size-3" />}
                                        <span className="hidden min-[961px]:inline">{generatingEpicIds.has(task.id)
                                          ? ((generateProgressMap.get(task.id)?.total ?? 0) > 0
                                            ? (generateProgressMap.get(task.id)?.phase === 'planning' ? 'Planning...' : `${generateProgressMap.get(task.id)!.created}/${generateProgressMap.get(task.id)!.total}`)
                                            : 'Planning...')
                                          : 'Generate'}</span>
                                      </TooltipTrigger>
                                    </Tooltip>
                                    <EpicFixDropdown
                                      epicId={task.id}
                                      onFix={handleFixEpic}
                                      isFixing={fixingEpicId === task.id}
                                      isAnyOperationRunning={generatingEpicIds.has(task.id) || fixingEpicId !== null || fixingTaskId !== null}
                                      currentFixType={fixingEpicId === task.id ? fixingEpicType : null}
                                    />
                                  </div>
                                }
                              />
                            );
                            if (taskIsEpic) {
                              return (
                                <div
                                  key={task.id}
                                  draggable
                                  onDragStart={(e) => handleEpicDragStart(e, task.id)}
                                  onDragOver={(e) => handleEpicDragOver(e, task.id, task.status)}
                                  onDrop={(e) => handleEpicDrop(e, task.id, task.status)}
                                  onDragEnd={handleEpicDragEnd}
                                  className={cx(
                                    'relative',
                                    draggedEpicId === task.id && 'opacity-50 cursor-grabbing'
                                  )}
                                >
                                  {epicDropBeforeId === task.id && (
                                    <div className="absolute -top-1 left-0 right-0 h-0.5 bg-utility-brand-500 z-10 rounded-full" />
                                  )}
                                  {card}
                                </div>
                              );
                            }
                            return card;
                          }
                          if (taskIsEpic) {
                            return (
                              <div
                                key={task.id}
                                draggable
                                onDragStart={(e) => handleEpicDragStart(e, task.id)}
                                onDragOver={(e) => handleEpicDragOver(e, task.id, task.status)}
                                onDrop={(e) => handleEpicDrop(e, task.id, task.status)}
                                onDragEnd={handleEpicDragEnd}
                                className={cx(
                                  'relative',
                                  draggedEpicId === task.id && 'opacity-50 cursor-grabbing'
                                )}
                              >
                                {epicDropBeforeId === task.id && (
                                  <div className="absolute -top-1 left-0 right-0 h-0.5 bg-utility-brand-500 z-10 rounded-full" />
                                )}
                                <BoardCard
                                  key={task.id}
                                  task={task}
                                  epic
                                  allTasks={tasks}
                                  onClick={() => setSelectedTask(task)}
                                  onFix={handleFixTask}
                                  fixStatus={fixStatus[task.id]}
                                  allFixStatuses={fixStatus}
                                  fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                                  isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                                  showAddStatus={isMissingStatus}
                                  onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                  addingStatus={addingStatus}
                                  onDragStart={() => setDraggedTask(task)}
                                  onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                  dragging={draggedTask?.id === task.id}
                                />
                              </div>
                            );
                          }
                          return (
                            <BoardCard
                              key={task.id}
                              task={task}
                              epic={taskIsEpic}
                              allTasks={tasks}
                              onClick={() => setSelectedTask(task)}
                              onFix={handleFixTask}
                              fixStatus={fixStatus[task.id]}
                              allFixStatuses={fixStatus}
                              fixingTaskType={fixingTaskId === task.id ? fixingTaskType : null}
                              isGlobalOperationRunning={fixingTaskId !== null || fixingEpicId !== null || generatingEpicIds.size > 0}
                              showAddStatus={isMissingStatus}
                              onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                              addingStatus={addingStatus}
                              onDragStart={() => setDraggedTask(task)}
                              onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                              dragging={draggedTask?.id === task.id}
                            />
                          );
                        });
                    })()
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <TaskDetailModal
        open={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
        onSaved={() => fetchBoard(true)}
        onDeleted={() => { setSelectedTask(null); fetchBoard(true); }}
        onShowErrorDetail={onShowErrorDetail}
      />
      <CreateTaskModal
        open={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setCreateDefaultEpicId(undefined); setCreateDefaultType(undefined); }}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
        onCreated={() => fetchBoard(true)}
        tasks={tasks}
        defaultEpicId={createDefaultEpicId}
        defaultType={createDefaultType}
        onShowErrorDetail={onShowErrorDetail}
      />

      <IdeaToEpicsModal
        open={ideaModalOpen}
        onClose={() => setIdeaModalOpen(false)}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
        onCreated={() => fetchBoard(true)}
        onShowErrorDetail={onShowErrorDetail}
      />

      <EmptyBoardModal
        open={emptyBoardModalOpen}
        onClose={() => setEmptyBoardModalOpen(false)}
        onIdeaToEpics={() => { setEmptyBoardModalOpen(false); setIdeaModalOpen(true); }}
        onNewEpic={() => { setEmptyBoardModalOpen(false); setCreateDefaultEpicId(undefined); setCreateDefaultType('Epic'); setCreateModalOpen(true); }}
      />

      <EpicsOnboardingModal
        open={epicsOnboardingModalOpen}
        onClose={handleEpicsOnboardingClose}
      />
    </section>
  );
}
