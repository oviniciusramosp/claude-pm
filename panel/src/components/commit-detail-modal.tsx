// panel/src/components/commit-detail-modal.tsx

import { useCallback, useEffect, useState } from 'react';
import { Clock, Copy01, GitCommit, User01, X } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { GIT_CONVENTIONAL_TYPE_COLORS } from '../constants';
import { handleModalKeyDown } from '@/utils/modal-keyboard';
import type { GitCommit as GitCommitType } from '../types';

interface CommitDetailModalProps {
  open: boolean;
  onClose: () => void;
  commit: GitCommitType | null;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
}

function formatFullDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function CommitDetailModal({ open, onClose, commit, apiBaseUrl, showToast }: CommitDetailModalProps) {
  const [stat, setStat] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStat = useCallback(async (hash: string) => {
    setLoading(true);
    setError(null);
    setStat('');

    try {
      const url = `${apiBaseUrl}/api/git/diff?hash=${encodeURIComponent(hash)}`;
      const response = await fetch(url);
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(payload.message || 'Failed to load commit details.');
        return;
      }

      setStat(payload.stat || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load commit details.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (open && commit) {
      fetchStat(commit.hash);
    }
  }, [open, commit, fetchStat]);

  const copyHash = useCallback(async () => {
    if (!commit) return;
    try {
      await navigator.clipboard.writeText(commit.hash);
      showToast('Commit hash copied');
    } catch {
      showToast('Failed to copy hash', 'danger');
    }
  }, [commit, showToast]);

  const typeColor = commit?.conventional
    ? GIT_CONVENTIONAL_TYPE_COLORS[commit.conventional.type] || 'gray'
    : undefined;

  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable>
      <Modal className="sm:max-w-2xl">
        <Dialog>
          <div
            className="w-full rounded-xl border border-secondary bg-primary shadow-2xl"
            onKeyDown={(e) => handleModalKeyDown(e, onClose)}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-secondary px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon icon={GitCommit} className="size-5 shrink-0 text-tertiary" />
                  <h3 className="m-0 truncate text-lg font-semibold text-primary">
                    {commit?.subject || 'Commit'}
                  </h3>
                </div>
                {commit && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {commit.conventional && (
                      <Badge size="sm" color={(typeColor || 'gray') as any}>
                        {commit.conventional.type}
                        {commit.conventional.scope ? `(${commit.conventional.scope})` : ''}
                      </Badge>
                    )}
                    {commit.isAutomation && (
                      <Badge size="sm" color="brand">Automation</Badge>
                    )}
                    {commit.taskId && (
                      <Badge size="sm" color="gray">{commit.taskId}</Badge>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              {commit && (
                <div className="space-y-4">
                  {/* Metadata */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-sm font-mono text-xs text-tertiary transition hover:text-brand-primary"
                        onClick={copyHash}
                        title="Click to copy full hash"
                      >
                        <Icon icon={Copy01} className="size-3.5" />
                        <span>{commit.hash}</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-tertiary">
                      <Icon icon={User01} className="size-4 shrink-0" />
                      <span>{commit.authorName}</span>
                      <span className="text-quaternary">&lt;{commit.authorEmail}&gt;</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-tertiary">
                      <Icon icon={Clock} className="size-4 shrink-0" />
                      <span>{formatFullDate(commit.date)}</span>
                    </div>
                  </div>

                  {/* Refs */}
                  {commit.refs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {commit.refs.map((ref, i) => (
                        <Badge key={i} size="sm" color={ref.startsWith('tag:') ? 'orange' : 'indigo'}>
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Body */}
                  {commit.body && (
                    <div className="rounded-lg border border-secondary bg-secondary p-4">
                      <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-secondary">{commit.body}</pre>
                    </div>
                  )}

                  {/* File changes */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-quaternary">Changed Files</p>
                    {loading && (
                      <div className="flex items-center justify-center py-4">
                        <div className="size-5 animate-spin rounded-full border-2 border-brand-solid border-t-transparent" />
                      </div>
                    )}
                    {error && (
                      <div className="rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-3 text-center text-xs text-error-primary">
                        {error}
                      </div>
                    )}
                    {!loading && !error && !stat && (
                      <p className="text-center text-xs text-quaternary">No file changes.</p>
                    )}
                    {!loading && !error && stat && (
                      <div className="rounded-lg border border-secondary bg-secondary p-4">
                        <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-secondary">{stat}</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end border-t border-secondary px-6 py-3">
              <Button size="md" color="secondary" onPress={onClose}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
