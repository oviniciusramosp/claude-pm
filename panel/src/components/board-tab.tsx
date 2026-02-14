// panel/src/components/board-tab.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns03, Database01, RefreshCw01, Users01 } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
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
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  refreshTrigger: number;
  savedConfig: Record<string, any>;
  onSaveDatabaseId: (id: string) => void;
  onShowErrorDetail: (title: string, message: string) => void;
  busy: Record<string, any>;
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
    if (d.databaseId) lines.push(`Database ID:   ${d.databaseId}`);
    if (d.notionStatus) lines.push(`Notion Status: ${d.notionStatus}`);
    if (d.notionCode) lines.push(`Notion Code:   ${d.notionCode}`);
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

function MissingDatabaseIdCard({
  showToast,
  onSaveDatabaseId,
  busy
}: {
  showToast: BoardTabProps['showToast'];
  onSaveDatabaseId: BoardTabProps['onSaveDatabaseId'];
  busy: BoardTabProps['busy'];
}) {
  const [draftId, setDraftId] = useState('');

  const handleSave = useCallback(() => {
    const id = draftId.trim();
    if (!id) {
      showToast('Please enter a Database ID.', 'warning');
      return;
    }
    onSaveDatabaseId(id);
  }, [draftId, onSaveDatabaseId, showToast]);

  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-warning-primary bg-utility-warning-50 p-6">
      <div className="flex items-center gap-2">
        <Icon icon={Database01} className="size-5 text-warning-primary" />
        <h3 className="text-sm font-semibold text-warning-primary">Database ID Required</h3>
      </div>
      <p className="mt-2 text-sm text-tertiary">
        Enter your Notion Database ID to connect. You can find it in the database URL after the workspace name.
      </p>
      <div className="mt-4 flex gap-2">
        <div className="flex-1">
          <Input
            size="sm"
            placeholder="e.g. a1b2c3d4e5f6..."
            icon={Database01}
            value={draftId}
            onChange={(value) => setDraftId(value)}
          />
        </div>
        <Button
          size="sm"
          color="primary"
          isLoading={Boolean(busy.saveBoardDbId)}
          onPress={handleSave}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

export function BoardTab({ apiBaseUrl, showToast, refreshTrigger, savedConfig, onSaveDatabaseId, onShowErrorDetail, busy }: BoardTabProps) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState<BoardError | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const hasDatabaseId = Boolean(savedConfig.NOTION_DATABASE_ID?.trim());

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

  const errorCode = boardError?.code || null;
  const totalCount = tasks.length;
  const showMissingDbId = errorCode === 'MISSING_DATABASE_ID' || (!hasDatabaseId && !loading && tasks.length === 0 && !errorCode);
  const showErrorBanner = boardError && !loading && tasks.length === 0 && !showMissingDbId;
  const showBoard = tasks.length > 0 || (loading && !showMissingDbId && !showErrorBanner) || (!boardError && !loading);

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
            onClick={() => fetchBoard()}
            disabled={refreshing}
            aria-label="Refresh board"
          >
            <RefreshCw01 className={cx('size-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Missing Database ID */}
      {showMissingDbId && (
        <MissingDatabaseIdCard
          showToast={showToast}
          onSaveDatabaseId={onSaveDatabaseId}
          busy={busy}
        />
      )}

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
      )}
    </section>
  );
}
