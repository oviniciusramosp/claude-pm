// panel/src/components/changelog-modal.tsx

import { useEffect, useState } from 'react';
import { ArrowUpRight, X } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { GIT_CONVENTIONAL_TYPE_COLORS } from '../constants';
import { handleModalKeyDown } from '@/utils/modal-keyboard';

interface ChangelogCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
  url: string;
}

interface Conventional {
  type: string;
  scope: string | null;
  subject: string;
}

function parseConventional(line: string): Conventional | null {
  const match = line.match(/^(\w+)(?:\(([^)]+)\))?!?: (.+)/);
  if (!match) return null;
  return { type: match[1], scope: match[2] || null, subject: match[3] };
}

function formatRelativeDate(isoDate: string): string {
  const diffDays = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function ChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [commits, setCommits] = useState<ChangelogCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch('/api/changelog')
      .then((res) => res.json())
      .then((data) => {
        setCommits(data.commits || []);
        if (data.error && !data.commits?.length) setError(data.error);
      })
      .catch((err) => setError(err.message))
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
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-secondary px-6 py-4">
              <div>
                <h3 className="m-0 text-lg font-semibold text-primary">Changelog</h3>
                <p className="m-0 text-sm text-tertiary">Recent updates to PM Automation</p>
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

              {!loading && error && commits.length === 0 && (
                <div className="rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-4 text-center text-sm text-error-primary">
                  {error}
                </div>
              )}

              {!loading && commits.length === 0 && !error && (
                <p className="py-8 text-center text-sm text-quaternary">No commits found.</p>
              )}

              {commits.length > 0 && (
                <div className="space-y-0.5">
                  {commits.map((commit) => {
                    const firstLine = commit.message.split('\n')[0];
                    const conventional = parseConventional(firstLine);
                    const subject = conventional?.subject ?? firstLine;
                    const typeColor = conventional
                      ? (GIT_CONVENTIONAL_TYPE_COLORS[conventional.type] || 'gray')
                      : 'gray';

                    return (
                      <div
                        key={commit.sha}
                        className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition hover:bg-primary_hover"
                      >
                        <div className="mt-0.5 shrink-0">
                          <Badge
                            size="sm"
                            color={typeColor as any}
                            className="ring-0 font-mono text-[10px]"
                          >
                            {conventional
                              ? `${conventional.type}${conventional.scope ? `(${conventional.scope})` : ''}`
                              : 'commit'}
                          </Badge>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-sm text-primary">{subject}</p>
                          <p className="m-0 mt-0.5 text-[11px] text-quaternary">
                            <span className="font-mono">{commit.sha}</span>
                            <span className="mx-1">·</span>
                            <span title={formatDate(commit.date)}>{formatRelativeDate(commit.date)}</span>
                          </p>
                        </div>

                        <a
                          href={commit.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded p-1 text-quaternary opacity-0 transition hover:bg-secondary hover:text-secondary group-hover:opacity-100"
                          aria-label="View on GitHub"
                          title="View on GitHub"
                        >
                          <Icon icon={ArrowUpRight} className="size-3.5" />
                        </a>
                      </div>
                    );
                  })}
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
