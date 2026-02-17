// panel/src/components/board-tab.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Columns03, CpuChip01, Folder, FolderPlus, Plus, RefreshCw01, Tool01, Users01 } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import {
  BOARD_COLUMNS,
  BOARD_PRIORITY_COLORS,
  BOARD_TYPE_COLORS,
  BOARD_POLL_INTERVAL_MS
} from '../constants';
import { TaskDetailModal } from './task-detail-modal';
import { CreateTaskModal } from './create-task-modal';
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
  setFixingTaskId?: (taskId: string | null) => void;
}

interface BoardError {
  message: string;
  code: string | null;
  details: Record<string, any> | null;
  httpStatus: number | null;
}

const COLUMN_HEADER_COLORS: Record<string, string> = {
  missing_status: 'bg-utility-warning-50 text-utility-warning-700',
  not_started: 'bg-utility-gray-50 text-utility-gray-700',
  in_progress: 'bg-utility-brand-50 text-utility-brand-700',
  done: 'bg-utility-success-50 text-utility-success-700'
};

function isEpic(task: BoardTask, allTasks: BoardTask[]): boolean {
  if (task.type?.toLowerCase() === 'epic') return true;
  return allTasks.some((t) => t.parentId === task.id);
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

function formatModelName(model: string): string | null {
  if (!model) return null;
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    return `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}`;
  }
  return model;
}

function AcDonut({ done, total }: { done: number; total: number }) {
  const size = 20;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const dashOffset = circumference * (1 - progress);
  const allDone = done === total;

  return (
    <div className="shrink-0" title={`${done}/${total} ACs completed`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-quaternary/40" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" className={allDone ? 'text-utility-success-500' : 'text-utility-brand-500'} />
      </svg>
    </div>
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
        title="Add status to this task"
      >
        <Plus className="size-3" />
        <span>Add Status</span>
      </button>
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

interface BoardCardProps {
  key?: React.Key;
  task: BoardTask;
  epic: boolean;
  allTasks: BoardTask[];
  onClick: () => void;
  onFix?: (taskId: string) => void;
  fixStatus?: { status: string; startedAt?: string; completedAt?: string; error?: string };
  allFixStatuses?: Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>;
  showAddStatus?: boolean;
  onAddStatus?: (taskId: string, status: string) => void;
  addingStatus?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}

function BoardCard({ task, epic, allTasks, onClick, onFix, fixStatus, allFixStatuses, showAddStatus, onAddStatus, addingStatus, onDragStart, onDragEnd, dragging }: BoardCardProps) {
  const priorityColor = BOARD_PRIORITY_COLORS[task.priority] as any;
  const typeColor = BOARD_TYPE_COLORS[task.type] as any;
  const taskCode = extractTaskCode(task);
  const modelLabel = formatModelName(task.model);
  const parentEpic = task.parentId ? allTasks.find((t) => t.id === task.parentId) : null;
  const parentEpicCode = parentEpic ? extractTaskCode(parentEpic) : null;
  const parentEpicInProgress = parentEpic && parentEpic.status.toLowerCase() === 'in progress';

  const isFixing = fixStatus?.status === 'running';
  const isAnyFixing = allFixStatuses && Object.values(allFixStatuses).some((s) => s.status === 'running');

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={() => onDragEnd?.()}
      className={cx(
        'group relative cursor-pointer rounded-lg border bg-primary p-3 shadow-xs transition hover:shadow-md hover:border-brand-solid',
        epic ? 'border-l-4 border-l-utility-purple-500 border-secondary'
          : parentEpicInProgress ? 'border-utility-brand-200'
          : 'border-secondary',
        dragging && 'opacity-50'
      )}
    >
      {/* Row 1: Epic reference (only for child tasks) */}
      {parentEpic && (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 text-xs text-tertiary truncate min-w-0">
            <Icon icon={Folder} className="size-3 shrink-0" />
            <span className="truncate">
              {parentEpicCode && <span className="font-mono mr-1">{parentEpicCode}</span>}
              {parentEpic.name}
            </span>
          </div>
        </div>
      )}

      {/* Row 2: Title + AC chart + Fix button */}
      <div className="flex items-start gap-2">
        <p className="text-sm font-medium text-primary flex-1 min-w-0">
          {taskCode && <span className="text-tertiary font-mono mr-2">{taskCode}</span>}
          {task.name}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {onFix && (
            <button
              type="button"
              onClick={(e: any) => {
                e.stopPropagation();
                if (!isAnyFixing) {
                  onFix(task.id);
                }
              }}
              disabled={isAnyFixing}
              className={cx(
                'transition-opacity rounded-md p-1.5 shadow-sm',
                isAnyFixing
                  ? 'bg-utility-gray-100 border border-utility-gray-200 cursor-not-allowed opacity-60'
                  : 'bg-utility-brand-50 hover:bg-utility-brand-100 border border-utility-brand-200',
                isFixing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              title={
                isAnyFixing
                  ? (isFixing ? 'Fixing this task...' : 'Another task is being fixed')
                  : 'Fix ACs with Claude'
              }
              aria-label="Fix acceptance criteria"
            >
              {isFixing ? (
                <RefreshCw01 className="size-3.5 text-utility-brand-600 animate-spin" />
              ) : (
                <Tool01 className={cx('size-3.5', isAnyFixing ? 'text-utility-gray-400' : 'text-utility-brand-600')} />
              )}
            </button>
          )}
          {task.acTotal > 0 && <AcDonut done={task.acDone} total={task.acTotal} />}
        </div>
      </div>

      {/* Row 2.5: Add Status button (only in Missing Status column) */}
      {showAddStatus && onAddStatus && (
        <div className="mt-2">
          <AddStatusDropdown taskId={task.id} onAddStatus={onAddStatus} disabled={addingStatus} />
        </div>
      )}

      {/* Row 3: Type + Priority */}
      {(task.type || task.priority) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {task.type && (
            <Badge size="sm" color={typeColor || 'gray'}>
              {task.type}
            </Badge>
          )}
          {task.priority && (
            <Badge size="sm" color={priorityColor || 'gray'}>
              {task.priority}
            </Badge>
          )}
        </div>
      )}

      {/* Row 4: Agents + Model (only for non-Epic tasks) */}
      {!epic && (task.agents.length > 0 || modelLabel) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-tertiary">
          {task.agents.length > 0 && (
            <div className="flex items-center gap-1 min-w-0">
              <Icon icon={Users01} className="size-3 shrink-0" />
              <span className="truncate">{task.agents.join(', ')}</span>
            </div>
          )}
          {modelLabel && (
            <div className="flex items-center gap-1 min-w-0">
              <Icon icon={CpuChip01} className="size-3 shrink-0" />
              <span className="truncate">{modelLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-secondary bg-primary p-3">
      <div className="h-4 w-3/4 rounded bg-quaternary" />
      <div className="mt-2 flex gap-2">
        <div className="h-5 w-8 rounded-full bg-quaternary" />
        <div className="h-5 w-16 rounded-full bg-quaternary" />
      </div>
    </div>
  );
}

export function BoardTab({ apiBaseUrl, showToast, refreshTrigger, onShowErrorDetail, setFixingTaskId: setFixingTaskIdProp }: BoardTabProps) {
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDefaultEpicId, setCreateDefaultEpicId] = useState<string | undefined>(undefined);
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
    setExpandedEpics((prev) => {
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

  const handleFixTask = useCallback(async (taskId: string) => {
    // Update local state optimistically
    setFixStatus((prev: Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>) => ({
      ...prev,
      [taskId]: { status: 'running', startedAt: new Date().toISOString() }
    }));
    setFixingTaskIdProp?.(taskId);

    try {
      const response = await fetch(`${apiBaseUrl}/api/board/fix-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Fix task failed', 'danger');
        // Fetch updated status from server
        await fetchFixStatus();
        // Clear fixing state on error
        setFixingTaskIdProp?.(null);
        return;
      }
      showToast(`Task fix completed: ${taskId}`, 'success');
      // Clear fixing state immediately on success (before board refresh)
      setFixingTaskIdProp?.(null);
      await fetchBoard(true);
    } catch (err: any) {
      showToast(err.message || 'Fix task failed', 'danger');
      // Fetch updated status from server
      await fetchFixStatus();
      // Clear fixing state on exception
      setFixingTaskIdProp?.(null);
    } finally {
      // Safety net: ensure fixing state is always cleared
      if (mountedRef.current) {
        setFixingTaskIdProp?.(null);
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
    return BOARD_COLUMNS.map((col) => ({
      ...col,
      tasks: col.statusMatch === null
        ? tasks.filter((t: BoardTask) => !t.status || t.status.trim() === '')
        : tasks.filter((t: BoardTask) => t.status && t.status.toLowerCase() === col.statusMatch)
    }));
  }, [tasks]);

  const totalCount = tasks.length;
  const showBoardMissing = boardExists === false && !loading;
  const showErrorBanner = boardError && !loading && tasks.length === 0 && !showBoardMissing;
  const showBoard = !showBoardMissing && (tasks.length > 0 || (loading && !showErrorBanner) || (!boardError && !loading));

  const handleViewDetails = useCallback(() => {
    if (!boardError) return;
    const title = boardError.code
      ? `Board Error — ${boardError.code}`
      : 'Board Error';
    onShowErrorDetail(title, formatErrorForModal(boardError));
  }, [boardError, onShowErrorDetail]);

  return (
    <section className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Icon icon={Columns03} className="size-5 text-tertiary" />
          <h2 className="text-lg font-semibold text-primary">Board Preview</h2>
          {totalCount > 0 && (
            <Badge size="sm" color="gray">{totalCount}</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-quaternary">
              Updated {lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            onClick={() => { setCreateDefaultEpicId(undefined); setCreateModalOpen(true); }}
            aria-label="Create new task"
            title="Create new task"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            onClick={fixBoardOrder}
            disabled={fixing}
            aria-label="Fix board order"
            title="Fix epic ordering"
          >
            <Tool01 className={cx('size-4', fixing && 'animate-spin')} />
          </button>
          <button
            type="button"
            className="rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            onClick={() => fetchBoard()}
            disabled={refreshing}
            aria-label="Refresh board"
          >
            <RefreshCw01 className={cx('size-4', refreshing && 'animate-spin')} />
          </button>
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
        <div className="rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-8 text-center">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" style={{ height: 'calc(100vh - 220px)' }}>
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex flex-col rounded-lg border border-secondary bg-primary shadow-xs overflow-hidden"
            >
              {/* Column header - fixed */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-secondary shrink-0">
                <span
                  className={cx(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
                    COLUMN_HEADER_COLORS[col.key]
                  )}
                >
                  {col.label}
                </span>
                <span className="text-xs font-medium text-quaternary">{col.tasks.length}</span>
              </div>

              {/* Cards - scrollable (drop zone) */}
              <div
                className={cx(
                  'flex-1 overflow-y-auto p-4 transition-colors',
                  dragOverColumn === col.key && col.statusMatch !== null && 'bg-utility-brand-50/30 ring-2 ring-inset ring-brand-solid rounded-b-lg'
                )}
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
                <div className="flex flex-col gap-2">
                  {loading && tasks.length === 0 ? (
                    <>
                      <SkeletonCard />
                      <SkeletonCard />
                    </>
                  ) : col.tasks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-secondary p-4 text-center text-sm text-quaternary">
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
                              <div key={task.id} className="flex flex-col gap-1">
                                {card}
                                <button
                                  type="button"
                                  onClick={() => { setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                  className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-tertiary hover:text-brand-secondary hover:bg-utility-brand-50 transition"
                                  title={`Add task to ${task.name}`}
                                >
                                  <Plus className="size-3" />
                                  <span>Add task</span>
                                </button>
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
                        if (groupA !== groupB) return groupA.localeCompare(groupB);
                        // Epic parent comes before its children
                        if (!a.parentId && b.parentId) return -1;
                        if (a.parentId && !b.parentId) return 1;
                        return a.id.localeCompare(b.id);
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
                              <div key={task.id} className="flex flex-col gap-2">
                                <BoardCard
                                  task={task}
                                  epic
                                  allTasks={tasks}
                                  onClick={() => setSelectedTask(task)}
                                  onFix={handleFixTask}
                                  fixStatus={fixStatus[task.id]}
                                  allFixStatuses={fixStatus}
                                  showAddStatus={isMissingStatus}
                                  onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                  addingStatus={addingStatus}
                                  onDragStart={() => setDraggedTask(task)}
                                  onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                  dragging={draggedTask?.id === task.id}
                                />
                                <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleEpic(task.id)}
                                  className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-tertiary hover:text-secondary hover:bg-primary_hover transition"
                                >
                                  <ChevronDown className={cx('size-3 transition-transform', !expanded && '-rotate-90')} />
                                  <span>{children.length} {children.length === 1 ? 'story' : 'stories'}</span>
                                </button>
                                {(col.key === 'not_started' || col.key === 'missing_status') && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                    className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-tertiary hover:text-brand-secondary hover:bg-utility-brand-50 transition"
                                    title={`Add task to ${task.name}`}
                                  >
                                    <Plus className="size-3" />
                                  </button>
                                )}
                              </div>
                                {expanded && (
                                  <div className="ml-2 border-l-2 border-utility-purple-200 pl-2 flex flex-col gap-2">
                                    {children.map((child) => (
                                      <BoardCard
                                        key={child.id}
                                        task={child}
                                        epic={false}
                                        allTasks={tasks}
                                        onClick={() => setSelectedTask(child)}
                                        onFix={handleFixTask}
                                        fixStatus={fixStatus[child.id]}
                                        allFixStatuses={fixStatus}
                                        showAddStatus={isMissingStatus}
                                        onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                        addingStatus={addingStatus}
                                        onDragStart={() => setDraggedTask(child)}
                                        onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                        dragging={draggedTask?.id === child.id}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          const taskIsEpic = isEpic(task, tasks);
                          const showAddButton = (col.key === 'not_started' || col.key === 'missing_status') && taskIsEpic;
                          if (showAddButton) {
                            return (
                              <div key={task.id} className="flex flex-col gap-1">
                                <BoardCard
                                  task={task}
                                  epic={taskIsEpic}
                                  allTasks={tasks}
                                  onClick={() => setSelectedTask(task)}
                                  onFix={handleFixTask}
                                  fixStatus={fixStatus[task.id]}
                                  allFixStatuses={fixStatus}
                                  showAddStatus={isMissingStatus}
                                  onAddStatus={isMissingStatus ? handleAddStatus : undefined}
                                  addingStatus={addingStatus}
                                  onDragStart={() => setDraggedTask(task)}
                                  onDragEnd={() => { setDraggedTask(null); setDragOverColumn(null); }}
                                  dragging={draggedTask?.id === task.id}
                                />
                                <button
                                  type="button"
                                  onClick={() => { setCreateDefaultEpicId(task.id); setCreateModalOpen(true); }}
                                  className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-tertiary hover:text-brand-secondary hover:bg-utility-brand-50 transition"
                                  title={`Add task to ${task.name}`}
                                >
                                  <Plus className="size-3" />
                                  <span>Add task</span>
                                </button>
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
        onClose={() => { setCreateModalOpen(false); setCreateDefaultEpicId(undefined); }}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
        onCreated={() => fetchBoard(true)}
        tasks={tasks}
        defaultEpicId={createDefaultEpicId}
        onShowErrorDetail={onShowErrorDetail}
      />
    </section>
  );
}
