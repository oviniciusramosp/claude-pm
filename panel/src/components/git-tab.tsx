// panel/src/components/git-tab.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { Asterisk02, Clock, GitBranch02, GitCommit, RefreshCw01, User01 } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import { GIT_CONVENTIONAL_TYPE_COLORS, GIT_POLL_INTERVAL_MS } from '../constants';
import { CommitDetailModal } from './commit-detail-modal';
import type { GitCommit as GitCommitType } from '../types';

interface GitTabProps {
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  refreshTrigger: number;
}

const PAGE_SIZE = 50;

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(diffDay > 365 ? { year: 'numeric' } : {})
  });
}

function SkeletonCommit() {
  return (
    <div className="animate-pulse rounded-lg border border-secondary bg-primary p-3">
      <div className="h-4 w-3/4 rounded bg-quaternary" />
      <div className="mt-2 flex gap-3">
        <div className="h-3 w-16 rounded bg-quaternary" />
        <div className="h-3 w-24 rounded bg-quaternary" />
        <div className="h-3 w-16 rounded bg-quaternary" />
      </div>
    </div>
  );
}

function CommitRow({ commit, onClick }: { commit: GitCommitType; onClick: () => void }) {
  const typeColor = commit.conventional
    ? GIT_CONVENTIONAL_TYPE_COLORS[commit.conventional.type] || 'gray'
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cx(
        'cursor-pointer rounded-lg border bg-primary p-3 shadow-xs transition hover:shadow-md hover:border-brand-solid',
        commit.isAutomation
          ? 'border-l-4 border-l-utility-brand-500 border-secondary'
          : 'border-secondary'
      )}
    >
      {/* Row 1: Subject + Automation badge */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">
            {commit.conventional && (
              <Badge size="sm" color={(typeColor || 'gray') as any} className="mr-2 align-middle">
                {commit.conventional.type}
                {commit.conventional.scope ? `(${commit.conventional.scope})` : ''}
              </Badge>
            )}
            {commit.conventional ? commit.conventional.description : commit.subject}
          </p>
        </div>
        {commit.isAutomation && (
          <Badge size="sm" color="brand" className="shrink-0">
            <Icon icon={Asterisk02} className="mr-1 inline size-3" />
            Automation
          </Badge>
        )}
      </div>

      {/* Row 2: Hash + Author + Date + Task ID */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-tertiary">
        <span className="font-mono text-quaternary">{commit.shortHash}</span>
        <div className="flex items-center gap-1">
          <Icon icon={User01} className="size-3 shrink-0" />
          <span>{commit.authorName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Icon icon={Clock} className="size-3 shrink-0" />
          <span>{formatRelativeDate(commit.date)}</span>
        </div>
        {commit.taskId && (
          <Badge size="sm" color="gray">{commit.taskId}</Badge>
        )}
      </div>

      {/* Row 3: Branch/tag refs */}
      {commit.refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {commit.refs.map((ref, i) => (
            <Badge key={i} size="sm" color={ref.startsWith('tag:') ? 'orange' : 'indigo'}>
              {ref}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function GitTab({ apiBaseUrl, showToast, refreshTrigger }: GitTabProps) {
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [loading, setLoading] = useState(true);
  const [gitError, setGitError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<GitCommitType | null>(null);
  const mountedRef = useRef(true);

  const fetchGitLog = useCallback(
    async (silent = false, append = false) => {
      if (!silent && !append) setRefreshing(true);
      if (append) setLoadingMore(true);

      try {
        const offset = append ? commits.length : 0;
        const url = `${apiBaseUrl}/api/git/log?limit=${PAGE_SIZE}&offset=${offset}`;
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (!mountedRef.current) return;

        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          setGitError(payload.message || 'Failed to load git history.');
          if (!append) setCommits([]);
          return;
        }

        const newCommits = payload.commits || [];

        if (append) {
          setCommits((prev) => [...prev, ...newCommits]);
        } else {
          setCommits(newCommits);
        }

        setCurrentBranch(payload.branch || '');
        setHasMore(newCommits.length === PAGE_SIZE);
        setLastRefreshed(new Date());
        setGitError(null);
      } catch (err: any) {
        if (!mountedRef.current) return;
        setGitError(err.message || 'Failed to connect to panel API.');
        if (!append) setCommits([]);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [apiBaseUrl, commits.length]
  );

  // Initial load + polling
  useEffect(() => {
    mountedRef.current = true;
    fetchGitLog();

    const interval = setInterval(() => {
      fetchGitLog(true);
    }, GIT_POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl]);

  // SSE-triggered refresh
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchGitLog(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const automationCount = commits.filter((c) => c.isAutomation).length;

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Icon icon={GitCommit} className="size-6 text-tertiary" />
          <h2 className="m-0 text-xl font-semibold text-primary">Git History</h2>
        </div>

        {commits.length > 0 && (
          <Badge size="sm" color="gray">{commits.length} commits</Badge>
        )}

        {automationCount > 0 && (
          <Badge size="sm" color="brand">
            <Icon icon={Asterisk02} className="mr-1 inline size-3" />
            {automationCount} by automation
          </Badge>
        )}

        {currentBranch && (
          <div className="flex items-center gap-1.5 text-sm text-tertiary">
            <Icon icon={GitBranch02} className="size-4" />
            <span className="font-mono">{currentBranch}</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {lastRefreshed && (
            <span className="text-xs text-quaternary">
              {formatRelativeDate(lastRefreshed.toISOString())}
            </span>
          )}
          <Button
            size="sm"
            color="tertiary"
            iconLeading={RefreshCw01}
            isLoading={refreshing}
            onPress={() => fetchGitLog()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {gitError && !loading && (
        <div className="mb-6 rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-4 text-center text-sm text-error-primary">
          {gitError}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCommit key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !gitError && commits.length === 0 && (
        <div className="rounded-lg border border-dashed border-secondary p-8 text-center">
          <Icon icon={GitCommit} className="mx-auto mb-3 size-8 text-quaternary" />
          <p className="text-sm font-medium text-secondary">No commits yet</p>
          <p className="mt-1 text-xs text-quaternary">
            Commits from the working directory will appear here.
          </p>
        </div>
      )}

      {/* Commit list */}
      {!loading && commits.length > 0 && (
        <div className="space-y-2">
          {commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              onClick={() => setSelectedCommit(commit)}
            />
          ))}

          {hasMore && (
            <div className="pt-2 text-center">
              <Button
                size="sm"
                color="secondary"
                isLoading={loadingMore}
                onPress={() => fetchGitLog(false, true)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Commit detail modal */}
      <CommitDetailModal
        open={selectedCommit !== null}
        onClose={() => setSelectedCommit(null)}
        commit={selectedCommit}
        apiBaseUrl={apiBaseUrl}
        showToast={showToast}
      />
    </>
  );
}
