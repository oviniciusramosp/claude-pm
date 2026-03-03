// panel/src/components/changelog-modal.tsx
/// <reference path="../vite-env.d.ts" />

import { useEffect, useState } from 'react';
import { ArrowUpRight, Beaker01, ChevronDown, CpuChip01, Edit05, File03, GitCommit, RefreshCw01, Settings01, Stars01, Tool01, X, Zap } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { cx } from '@/utils/cx';
import { handleModalKeyDown } from '@/utils/modal-keyboard';

// ── Types ─────────────────────────────────────────────────────────────
interface ChangelogCommit {
  sha: string;
  fullSha: string;
  message: string;
  date: string;
  author: string;
  url: string;
  version: string | null;
}

interface DateGroup {
  key: string;           // local YYYY-M-D
  label: string;         // "Today", "Yesterday", "3d ago", …
  fullDate: string;      // "Mar 1, 2026"
  commits: ChangelogCommit[];
}

interface Conventional {
  type: string;
  scope: string | null;
  subject: string;
}

// ── Icon / colour maps ────────────────────────────────────────────────
const TYPE_ICON: Record<string, React.ComponentType<any>> = {
  feat:     Stars01,
  fix:      Tool01,
  docs:     File03,
  refactor: RefreshCw01,
  chore:    Settings01,
  perf:     Zap,
  test:     Beaker01,
  ci:       CpuChip01,
  build:    CpuChip01,
  style:    Edit05,
};

const TYPE_COLOR: Record<string, string> = {
  feat:     'text-violet-500',
  fix:      'text-red-500',
  docs:     'text-blue-500',
  refactor: 'text-purple-500',
  chore:    'text-gray-400 dark:text-gray-500',
  perf:     'text-orange-500',
  test:     'text-indigo-500',
  ci:       'text-slate-400',
  build:    'text-slate-400',
  style:    'text-pink-400',
};

// ── Helpers ──────────────────────────────────────────────────────────
function parseConventional(line: string): Conventional | null {
  const m = line.match(/^(\w+)(?:\(([^)]+)\))?!?: (.+)/);
  if (!m) return null;
  return { type: m[1], scope: m[2] || null, subject: m[3] };
}

/** Calendar-day key in local timezone (not UTC) */
function localDateKey(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Relative label using local calendar days so timezone doesn't skew "2d ago" */
function formatRelativeDate(isoDate: string): string {
  const now  = new Date();
  const d    = new Date(isoDate);
  const nowDay    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const commitDay = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
  const diffDays  = Math.round((nowDay.getTime() - commitDay.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)   return `${diffDays}d ago`;
  if (diffDays < 30)  return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function parseSemver(v: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = v.split('.').map(Number);
  return [a, b, c];
}

function semverGt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

/** Group flat commit list into calendar-day buckets (local timezone) */
function groupByDate(commits: ChangelogCommit[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const commit of commits) {
    const key = localDateKey(commit.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.commits.push(commit);
    } else {
      groups.push({
        key,
        label:    formatRelativeDate(commit.date),
        fullDate: formatDate(commit.date),
        commits:  [commit],
      });
    }
  }
  return groups;
}

// ── Component ────────────────────────────────────────────────────────
export function ChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [groups, setGroups]       = useState<DateGroup[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hasNew, setHasNew]       = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  function toggleBody(sha: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(sha) ? next.delete(sha) : next.add(sha);
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch('/api/changelog')
      .then((r) => r.json())
      .then((data) => {
        const commits: ChangelogCommit[] = data.commits || [];
        if (data.error && !commits.length) { setError(data.error); return; }
        const currentVer = __APP_VERSION__;
        setHasNew(commits.some((c) => c.version && semverGt(c.version, currentVer)));
        setGroups(groupByDate(commits));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      isDismissable
    >
      <Modal className="sm:max-w-2xl">
        <Dialog>
          <div
            className="w-full rounded-2xl bg-primary shadow-2xl"
            onKeyDown={(e) => handleModalKeyDown(e, onClose)}
          >
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 border-b border-secondary px-6 py-4">
              <div>
                <h3 className="m-0 text-lg font-semibold text-primary">Changelog</h3>
                <p className="m-0 text-sm text-tertiary">
                  {hasNew
                    ? 'New updates available — you are running an older version'
                    : 'Recent updates to PM Automation'}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full bg-secondary p-1.5 text-tertiary transition hover:bg-tertiary hover:text-secondary"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* ── Body ───────────────────────────────────────────── */}
            <div className="max-h-[60vh] overflow-y-auto px-6 pb-2">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="size-6 animate-spin rounded-full border-2 border-brand-solid border-t-transparent" />
                </div>
              )}

              {!loading && error && groups.length === 0 && (
                <div className="my-4 rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-4 text-center text-sm text-error-primary">
                  {error}
                </div>
              )}

              {!loading && groups.length === 0 && !error && (
                <p className="py-8 text-center text-sm text-quaternary">No commits found.</p>
              )}

              {groups.map((group) => (
                <div key={group.key}>
                  {/* Sticky date separator */}
                  <div className="sticky top-0 z-10 -mx-6 bg-primary px-6 pb-2">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-secondary" />
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wide text-quaternary"
                        title={group.fullDate}
                      >
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-secondary" />
                    </div>
                  </div>

                  {/* Commits for this date */}
                  <div className="pb-2">
                    {group.commits.map((commit) => {
                      const firstLine   = commit.message.split('\n')[0];
                      // Skip subject (line 0) and the conventional blank separator (line 1)
                      const body = commit.message.split('\n').slice(2).join('\n').trim();
                      const conv        = parseConventional(firstLine);
                      const subject     = conv?.subject ?? firstLine;
                      const CommitIcon  = conv ? (TYPE_ICON[conv.type] ?? GitCommit) : GitCommit;
                      const iconColor   = conv ? (TYPE_COLOR[conv.type] ?? 'text-quaternary') : 'text-quaternary';
                      const isNew       = Boolean(commit.version && semverGt(commit.version, __APP_VERSION__));

                      return (
                        <div
                          key={commit.sha}
                          className={cx(
                            'group flex gap-4 rounded-lg px-2 py-2 transition hover:bg-primary_hover',
                            isNew && 'bg-brand-primary/5'
                          )}
                        >
                          {/* Version column */}
                          <div className="w-[68px] shrink-0 pt-0.5 text-right">
                            {commit.version ? (
                              <span className={cx(
                                'font-mono text-[10px] font-semibold',
                                isNew ? 'text-brand-primary' : 'text-tertiary'
                              )}>
                                v{commit.version}
                              </span>
                            ) : (
                              <span className="font-mono text-[10px] text-quaternary">···</span>
                            )}
                          </div>

                          {/* Content column */}
                          <div className={cx(
                            'min-w-0 flex-1 border-l pl-4',
                            isNew ? 'border-brand-primary/40' : 'border-secondary'
                          )}>
                            <div className="flex items-center gap-2">
                              <Icon
                                icon={CommitIcon}
                                className={cx('size-4 shrink-0', iconColor)}
                              />
                              <p className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-primary">
                                {subject}
                              </p>
                              <a
                                href={commit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded p-0.5 text-quaternary opacity-0 transition hover:bg-secondary hover:text-secondary group-hover:opacity-100"
                                aria-label="View on GitHub"
                                title={`${commit.sha} · View on GitHub`}
                              >
                                <Icon icon={ArrowUpRight} className="size-3.5" />
                              </a>
                            </div>

                            {body && (
                              <div className="pl-6">
                                <button
                                  type="button"
                                  className="flex items-center gap-1 text-[10px] text-quaternary transition hover:text-secondary"
                                  onClick={() => toggleBody(commit.sha)}
                                >
                                  <Icon
                                    icon={ChevronDown}
                                    className={cx('size-3 transition-transform', !expanded.has(commit.sha) && '-rotate-90')}
                                  />
                                  <span>{expanded.has(commit.sha) ? 'Hide' : 'Show'} description</span>
                                </button>
                                {expanded.has(commit.sha) && (
                                  <p className="m-0 mt-1 whitespace-pre-wrap text-xs text-tertiary">
                                    {body}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-t border-secondary px-6 py-4">
              <a
                href="https://github.com/oviniciusramosp/claude-pm/commits"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-brand-primary transition hover:underline"
              >
                <span>View all on GitHub</span>
                <Icon icon={ArrowUpRight} className="size-4" />
              </a>
              <button
                type="button"
                className="rounded-lg border border-secondary bg-secondary px-4 py-2 text-sm font-medium text-secondary transition hover:bg-tertiary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
