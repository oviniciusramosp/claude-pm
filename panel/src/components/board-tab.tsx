// panel/src/components/board-tab.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns03, RefreshCw01, Users01 } from '@untitledui/icons';
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
import type { BoardTask } from '../types';

interface BoardTabProps {
  callApi: (path: string, options?: RequestInit) => Promise<any>;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  refreshTrigger: number;
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

function BoardCard({ task, epic }: { task: BoardTask; epic: boolean }) {
  const priorityColor = BOARD_PRIORITY_COLORS[task.priority] as any;
  const typeColor = BOARD_TYPE_COLORS[task.type] as any;

  return (
    <a
      href={task.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <div
        className={cx(
          'rounded-xl border bg-primary p-3 shadow-xs transition hover:shadow-md hover:border-brand-solid',
          epic ? 'border-l-4 border-l-utility-purple-500' : 'border-secondary'
        )}
      >
        <p className="text-sm font-medium text-primary truncate">{task.name}</p>

        {(task.priority || task.type) && (
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
          </div>
        )}

        {task.agents.length > 0 && (
          <div className="mt-2 flex items-center gap-1 text-xs text-tertiary">
            <Icon icon={Users01} className="size-3" />
            <span className="truncate">{task.agents.join(', ')}</span>
          </div>
        )}
      </div>
    </a>
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

export function BoardTab({ callApi, showToast, refreshTrigger }: BoardTabProps) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const fetchBoard = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const payload = await callApi('/api/automation/board');
        if (!mountedRef.current) return;
        setTasks(payload.tasks || []);
        setLastRefreshed(new Date());
        setError(null);
      } catch (err: any) {
        if (!mountedRef.current) return;
        setError(err.message || 'Failed to fetch board');
        if (!silent) showToast(`Board fetch failed: ${err.message}`, 'danger');
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [callApi, showToast]
  );

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

  return (
    <section className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Icon icon={Columns03} className="size-5 text-tertiary" />
          <h2 className="text-lg font-semibold text-primary">Board</h2>
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
          <Button
            size="sm"
            color="secondary"
            onClick={() => fetchBoard()}
            disabled={refreshing}
          >
            <RefreshCw01 className={cx('size-4', refreshing && 'animate-spin')} data-icon />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-error-primary bg-utility-error-50 p-8 text-center">
          <p className="text-sm text-error-primary">{error}</p>
          <p className="mt-1 text-xs text-tertiary">Make sure the Automation App is running.</p>
          <Button size="sm" color="secondary" className="mt-3" onClick={() => fetchBoard()}>
            Retry
          </Button>
        </div>
      )}

      {/* Board columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {columns.map((col) => (
          <div key={col.key} className="flex flex-col gap-3">
            {/* Column header */}
            <div className="flex items-center justify-between">
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

            {/* Cards */}
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
                  <BoardCard key={task.id} task={task} epic={isEpic(task, tasks)} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
