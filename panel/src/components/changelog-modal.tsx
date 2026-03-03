// panel/src/components/changelog-modal.tsx
/// <reference path="../vite-env.d.ts" />

import { useEffect, useState } from 'react';
import { ArrowUpRight, Beaker01, CpuChip01, Edit05, File03, GitCommit, RefreshCw01, Settings01, Stars01, Tool01, X, Zap } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { cx } from '@/utils/cx';
import { handleModalKeyDown } from '@/utils/modal-keyboard';

interface ChangelogCommit {
  sha: string;
  fullSha: string;
  message: string;
  date: string;
  author: string;
  url: string;
}

interface ChangelogTag {
  name: string; // semver without 'v'
  sha: string;  // full commit SHA
}

interface VersionGroup {
  version: string | null; // null = unreleased
  commits: ChangelogCommit[];
  isNew: boolean;
}

interface Conventional {
  type: string;
  scope: string | null;
  subject: string;
}

// ── Icon map per conventional commit type ────────────────────────────
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
  const match = line.match(/^(\w+)(?:\(([^)]+)\))?!?: (.+)/);
  if (!match) return null;
  return { type: match[1], scope: match[2] || null, subject: match[3] };
}

function parseSemver(v: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = v.split('.').map(Number);
  return [a, b, c];
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
}

function groupByVersion(commits: ChangelogCommit[], tags: ChangelogTag[]): VersionGroup[] {
  const shaToVersion = new Map<string, string>(tags.map((t) => [t.sha, t.name]));

  const groups: VersionGroup[] = [];
  let currentGroup: VersionGroup = { version: null, commits: [], isNew: false };

  for (const commit of commits) {
    const version = shaToVersion.get(commit.fullSha);
    if (version !== undefined) {
      if (currentGroup.commits.length > 0) groups.push(currentGroup);
      currentGroup = { version, commits: [commit], isNew: false };
    } else {
      currentGroup.commits.push(commit);
    }
  }
  if (currentGroup.commits.length > 0) groups.push(currentGroup);

  const currentVer = __APP_VERSION__;
  for (const group of groups) {
    group.isNew = group.version !== null && compareSemver(group.version, currentVer) > 0;
  }

  return groups;
}

function formatRelativeDate(isoDate: string): string {
  const diffDays = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────
export function ChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<VersionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch('/api/changelog')
      .then((res) => res.json())
      .then((data) => {
        const commits: ChangelogCommit[] = data.commits || [];
        const tags: ChangelogTag[] = data.tags || [];
        if (data.error && !commits.length) {
          setError(data.error);
        } else {
          setGroups(groupByVersion(commits, tags));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const hasNewGroups = groups.some((g) => g.isNew);

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
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-secondary px-6 py-4">
              <div>
                <h3 className="m-0 text-lg font-semibold text-primary">Changelog</h3>
                <p className="m-0 text-sm text-tertiary">
                  {hasNewGroups
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

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="size-6 animate-spin rounded-full border-2 border-brand-solid border-t-transparent" />
                </div>
              )}

              {!loading && error && groups.length === 0 && (
                <div className="rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-4 text-center text-sm text-error-primary">
                  {error}
                </div>
              )}

              {!loading && groups.length === 0 && !error && (
                <p className="py-8 text-center text-sm text-quaternary">No commits found.</p>
              )}

              {groups.length > 0 && (
                <div className="space-y-5">
                  {groups.map((group) => (
                    <div key={group.version ?? 'unreleased'} className="flex gap-4">
                      {/* Version column */}
                      <div className="w-[68px] shrink-0 pt-2 text-right">
                        {group.version ? (
                          <>
                            <span className={cx(
                              'font-mono text-xs font-bold',
                              group.isNew ? 'text-brand-primary' : 'text-primary'
                            )}>
                              v{group.version}
                            </span>
                            {group.isNew && (
                              <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-brand-primary">
                                New
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="font-mono text-xs text-quaternary">···</span>
                        )}
                      </div>

                      {/* Commits column */}
                      <div className={cx(
                        'flex-1 space-y-0.5 border-l pl-4',
                        group.isNew ? 'border-brand-primary/40' : 'border-secondary'
                      )}>
                        {group.commits.map((commit) => {
                          const firstLine = commit.message.split('\n')[0];
                          const conventional = parseConventional(firstLine);
                          const subject = conventional?.subject ?? firstLine;
                          const CommitIcon = conventional
                            ? (TYPE_ICON[conventional.type] ?? GitCommit)
                            : GitCommit;
                          const iconColor = conventional
                            ? (TYPE_COLOR[conventional.type] ?? 'text-quaternary')
                            : 'text-quaternary';

                          return (
                            <div
                              key={commit.sha}
                              className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-primary_hover"
                            >
                              <Icon
                                icon={CommitIcon}
                                className={cx('size-4 shrink-0', iconColor)}
                              />

                              <p className="m-0 min-w-0 flex-1 truncate text-sm text-primary">
                                {subject}
                              </p>

                              <span
                                className="shrink-0 font-mono text-[10px] text-quaternary"
                                title={formatDate(commit.date)}
                              >
                                {formatRelativeDate(commit.date)}
                              </span>

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
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
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
