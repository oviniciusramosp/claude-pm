// panel/src/components/task-detail-modal.tsx

import { useCallback, useEffect, useState } from 'react';
import { marked } from 'marked';
import { CpuChip01, File06, Users01, X } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { BOARD_PRIORITY_COLORS, BOARD_TYPE_COLORS } from '../constants';
import type { BoardTask } from '../types';

interface TaskDetailModalProps {
  open: boolean;
  onClose: () => void;
  task: BoardTask | null;
  apiBaseUrl: string;
}

export function TaskDetailModal({ open, onClose, task, apiBaseUrl }: TaskDetailModalProps) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkdown = useCallback(async (taskId: string) => {
    setLoading(true);
    setError(null);
    setMarkdown('');

    try {
      const url = `${apiBaseUrl}/api/board/task-markdown?taskId=${encodeURIComponent(taskId)}`;
      const response = await fetch(url);
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(payload.message || 'Failed to load task content.');
        return;
      }

      setMarkdown(payload.markdown || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load task content.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (open && task) {
      fetchMarkdown(task.id);
    }
  }, [open, task, fetchMarkdown]);

  const renderedHtml = markdown
    ? marked.parse(markdown, { async: false, gfm: true, breaks: true }) as string
    : '';

  const priorityColor = task ? BOARD_PRIORITY_COLORS[task.priority] : undefined;
  const typeColor = task ? BOARD_TYPE_COLORS[task.type] : undefined;

  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable>
      <Modal className="sm:max-w-2xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-secondary px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon icon={File06} className="size-5 shrink-0 text-tertiary" />
                  <h3 className="m-0 truncate text-lg font-semibold text-primary">
                    {task?.name || 'Task'}
                  </h3>
                </div>
                {task && (task.priority || task.type || task.status) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {task.priority && (
                      <Badge size="sm" color={(priorityColor || 'gray') as any}>
                        {task.priority}
                      </Badge>
                    )}
                    {task.type && (
                      <Badge size="sm" color={(typeColor || 'gray') as any}>
                        {task.type}
                      </Badge>
                    )}
                    {task.status && (
                      <Badge size="sm" color="gray">
                        {task.status}
                      </Badge>
                    )}
                  </div>
                )}
                {task && (task.model || task.agents.length > 0) && (
                  <div className="mt-3 flex flex-col gap-2">
                    {task.model && (
                      <div className="flex items-center gap-2 text-xs text-tertiary">
                        <Icon icon={CpuChip01} className="size-4 shrink-0" />
                        <span>{task.model}</span>
                      </div>
                    )}
                    {task.agents.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-tertiary">
                        <Icon icon={Users01} className="size-4 shrink-0" />
                        <span>{task.agents.join(', ')}</span>
                      </div>
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
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-brand-solid border-t-transparent" />
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-dashed border-error-primary bg-utility-error-50 p-4 text-center text-sm text-error-primary">
                  {error}
                </div>
              )}

              {!loading && !error && !markdown && (
                <p className="text-center text-sm text-quaternary">No content available.</p>
              )}

              {!loading && !error && renderedHtml && (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary prose-strong:text-primary prose-a:text-brand-primary [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-utility-success-500"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
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
