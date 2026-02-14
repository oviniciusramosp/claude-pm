// panel/src/components/board-tab.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns03, Folder, RefreshCw01, Tool01, Users01 } from '@untitledui/icons';
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
import type { BoardTask } from '../types';

interface BoardTabProps {
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  refreshTrigger: number;
  onShowErrorDetail: (title: string, message: string) => void;
}

interface BoardError {
  message: string;
  code: string | null;
  details: Record<string, any> | null;
  httpStatus: number | null;
}

const COLUMN_HEADER_COLORS: Record<string, string> = {
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
  const match = id.match(/^(E\d+)/i);
  if (match) return match[1].toUpperCase();
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
  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const dashOffset = circumference * (1 - progress);
  const allDone = done === total;

  return (
    <div className="relative flex items-center gap-1.5" title={`${done}/${total} ACs completed`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-quaternary/40"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className={allDone ? 'text-utility-success-500' : 'text-utility-brand-500'}
        />
      </svg>
      <span className={cx('text-[11px] font-medium tabular-nums', allDone ? 'text-utility-success-700' : 'text-tertiary')}>
        {done}/{total}
      </span>
    </div>
  );
}

function BoardCard({ task, epic, allTasks, onClick }: { task: BoardTask; epic: boolean; allTasks: BoardTask[]; onClick: () => void }) {
  const priorityColor = BOARD_PRIORITY_COLORS[task.priority] as any;
  const typeColor = BOARD_TYPE_COLORS[task.type] as any;
  const taskCode = extractTaskCode(task);
  const modelLabel = formatModelName(task.model);
  const parentEpic = task.parentId ? allTasks.find((t) => t.id === task.parentId) : null;
  const parentEpicCode = parentEpic ? extractTaskCode(parentEpic) : null;
  const parentEpicInProgress = parentEpic && parentEpic.status.toLowerCase() === 'in progress';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cx(
        'cursor-pointer rounded-xl border bg-primary p-3 shadow-xs transition hover:shadow-md hover:border-brand-solid',
        epic ? 'border-l-4 border-l-utility-purple-500'
          : parentEpicInProgress ? 'border-brand-primary/30'
          : 'border-secondary'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-primary truncate">
          {taskCode && <span className="text-tertiary font-mono mr-1.5">{taskCode}</span>}
          {task.name}
        </p>
        {task.acTotal > 0 && (
          <AcDonut done={task.acDone} total={task.acTotal} />
        )}
      </div>

      {(task.priority || task.type || modelLabel) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.priority && (
            <Badge size="sm" color={priorityColor || 'gray'}>
              {task.priority}
            </Badge>
          )}
          {task.type && (
            <Badge size="sm" color={typeColor || 'gray'}>
              {task.type}
            </Badge>
          )}
          {modelLabel && (
            <Badge size="sm" color="gray">
              {modelLabel}
            </Badge>
          )}
        </div>
      )}

      {parentEpic && (
        <div className="mt-2 flex items-center gap-1 text-xs text-tertiary truncate">
          <Icon icon={Folder} className="size-3 shrink-0" />
          <span className="truncate">
            {parentEpicCode && <span className="font-mono mr-1">{parentEpicCode}</span>}
            {parentEpic.name}
          </span>
        </div>
      )}

      {task.agents.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-tertiary">
          <Icon icon={Users01} className="size-3" />
          <span className="truncate">{task.agents.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-secondary bg-primary p-3">
      <div className="h-4 w-3/4 rounded bg-quaternary" />
      <div className="mt-2 flex gap-1.5">
        <div className="h-5 w-8 rounded-full bg-quaternary" />
        <div className="h-5 w-16 rounded-full bg-quaternary" />
      </div>
    </div>
  );
}

export function BoardTab({ apiBaseUrl, showToast, refreshTrigger, onShowErrorDetail }: BoardTabProps) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState<BoardError | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null as BoardTask | null);
  const mountedRef = useRef(true);

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

  // Initial load + polling
  useEffect(() => {
    mountedRef.current = true;
    fetchBoard();
    const interval = setInterval(() => fetchBoard(true), BOARD_POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchBoard]);

  // SSE-triggered refresh
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchBoard(true);
    }
  }, [refreshTrigger, fetchBoard]);

  const columns = useMemo(() => {
    return BOARD_COLUMNS.map((col) => ({
      ...col,
      tasks: tasks.filter((t) => t.status.toLowerCase() === col.statusMatch)
    }));
  }, [tasks]);

  const totalCount = tasks.length;
  const showErrorBanner = boardError && !loading && tasks.length === 0;
  const showBoard = tasks.length > 0 || (loading && !showErrorBanner) || (!boardError && !loading);

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
            className="rounded-lg p-1.5 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            onClick={fixBoardOrder}
            disabled={fixing}
            aria-label="Fix board order"
            title="Fix epic ordering"
          >
            <Tool01 className={cx('size-4', fixing && 'animate-spin')} />
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
            onClick={() => fetchBoard()}
            disabled={refreshing}
            aria-label="Refresh board"
          >
            <RefreshCw01 className={cx('size-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {showErrorBanner && (
        <div className="rounded-xl border border-dashed border-error-primary bg-utility-error-50 p-8 text-center">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" style={{ height: 'calc(100vh - 220px)' }}>
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex flex-col rounded-xl border border-secondary bg-primary shadow-xs overflow-hidden"
            >
              {/* Column header - fixed */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-secondary shrink-0">
                <span
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                    COLUMN_HEADER_COLORS[col.key]
                  )}
                >
                  {col.label}
                </span>
                <span className="text-xs font-medium text-quaternary">{col.tasks.length}</span>
              </div>

              {/* Cards - scrollable */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-2">
                  {loading && tasks.length === 0 ? (
                    <>
                      <SkeletonCard />
                      <SkeletonCard />
                    </>
                  ) : col.tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-secondary p-4 text-center text-sm text-quaternary">
                      No tasks
                    </div>
                  ) : (
                    col.tasks.map((task) => (
                      <BoardCard key={task.id} task={task} epic={isEpic(task, tasks)} allTasks={tasks} onClick={() => setSelectedTask(task)} />
                    ))
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
      />
    </section>
  );
}
