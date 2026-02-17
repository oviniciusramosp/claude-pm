// panel/src/components/task-detail-modal.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { AlertTriangle, CpuChip01, Edit05, File06, Stars01, Trash01, Users01, X } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { BOARD_PRIORITY_COLORS, BOARD_TYPE_COLORS, CLAUDE_MODELS } from '../constants';
import type { BoardTask } from '../types';

interface ModalError {
  message: string;
  details: string;
}

// --- Shared form constants ---
const TYPE_OPTIONS = ['UserStory', 'Epic', 'Bug', 'Chore', 'Discovery'] as const;
const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3'] as const;
const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Done'] as const;

const selectClasses = 'w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const inputClasses = 'w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const labelClasses = 'block text-sm font-medium text-secondary mb-1';

// --- Frontmatter parser (client-side, mirrors src/local/frontmatter.js) ---
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const text = content || '';
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) return { frontmatter: {}, body: text };

  const yamlBlock = text.slice(4, endIndex).trim();
  const body = text.slice(endIndex + 4).trim();
  const frontmatter: Record<string, string> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function serializeFrontmatter(fields: Record<string, string>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// --- Component ---
interface TaskDetailModalProps {
  open: boolean;
  onClose: () => void;
  task: BoardTask | null;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onSaved?: () => void;
  onDeleted?: () => void;
  onShowErrorDetail?: (title: string, message: string) => void;
}

export function TaskDetailModal({ open, onClose, task, apiBaseUrl, showToast, onSaved, onDeleted, onShowErrorDetail }: TaskDetailModalProps) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode - structured fields
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editType, setEditType] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editAgents, setEditAgents] = useState('');
  const [editBody, setEditBody] = useState('');
  const [extraFrontmatter, setExtraFrontmatter] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Action error (save/delete)
  const [actionError, setActionError] = useState<ModalError | null>(null);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteEpicFolder, setDeleteEpicFolder] = useState(true);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEpic = task?.type?.toLowerCase() === 'epic';

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
    setEditing(false);
    setReviewing(false);
    setConfirmDelete(false);
    setDeleteEpicFolder(true);
    setActionError(null);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [open, task, fetchMarkdown]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleEdit = useCallback(() => {
    // Parse frontmatter from raw markdown into structured fields
    const { frontmatter, body } = parseFrontmatter(markdown);
    setEditName(frontmatter.name || task?.name || '');
    setEditPriority(frontmatter.priority || task?.priority || 'P1');
    setEditType(frontmatter.type || task?.type || 'UserStory');
    setEditStatus(frontmatter.status || task?.status || 'Not Started');
    setEditModel(frontmatter.model || '');
    setEditAgents(frontmatter.agents || frontmatter.agent || '');
    setEditBody(body);

    // Preserve any extra frontmatter fields we don't have explicit controls for
    const knownKeys = new Set(['name', 'priority', 'type', 'status', 'model', 'agents', 'agent']);
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!knownKeys.has(key)) extra[key] = value;
    }
    setExtraFrontmatter(extra);
    setEditing(true);
  }, [markdown, task]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!task) return;
    if (!editName.trim()) {
      showToast('Task name is required', 'warning');
      return;
    }

    // Rebuild the full markdown from structured fields
    const fields: Record<string, string> = {
      name: editName.trim(),
      priority: editPriority,
      type: editType,
      status: editStatus,
      ...extraFrontmatter
    };
    if (editModel) fields.model = editModel;
    if (editAgents) fields.agents = editAgents;

    const newContent = serializeFrontmatter(fields) + '\n\n' + editBody;
    const url = `${apiBaseUrl}/api/board/task-markdown`;
    const requestBody = { taskId: task.id, content: newContent };

    setSaving(true);
    setActionError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const rawText = await response.text();
      const payload = isJson ? (() => { try { return JSON.parse(rawText); } catch { return {}; } })() : {};

      if (!response.ok) {
        const msg = payload?.message || `Failed to save (HTTP ${response.status})`;
        setActionError({
          message: msg,
          details: [
            `URL:          POST ${url}`,
            `Task ID:      ${task.id}`,
            `HTTP Status:  ${response.status} ${response.statusText}`,
            `Content-Type: ${contentType || '(empty)'}`,
            '',
            '--- Response Body ---',
            isJson ? JSON.stringify(payload, null, 2) : rawText.slice(0, 2000),
            '',
            `Timestamp:    ${new Date().toISOString()}`
          ].join('\n')
        });
        return;
      }
      showToast('Task saved', 'success');
      setEditing(false);
      setMarkdown(newContent);
      onSaved?.();
    } catch (err: any) {
      const msg = err.message || 'Failed to save';
      setActionError({
        message: msg,
        details: [
          `URL:          POST ${url}`,
          `Task ID:      ${task.id}`,
          `Error:        ${msg}`,
          `Type:         ${err.name || 'Unknown'}`,
          '',
          err.stack ? `--- Stack ---\n${err.stack}` : '',
          `Timestamp:    ${new Date().toISOString()}`
        ].filter(Boolean).join('\n')
      });
    } finally {
      setSaving(false);
    }
  }, [task, editName, editPriority, editType, editStatus, editModel, editAgents, editBody, extraFrontmatter, apiBaseUrl, showToast, onSaved]);

  const handleReview = useCallback(async () => {
    if (!editBody.trim()) {
      showToast('Add task content before reviewing', 'warning');
      return;
    }

    setReviewing(true);
    setActionError(null);

    const url = `${apiBaseUrl}/api/board/review-task`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          priority: editPriority,
          type: editType,
          status: editStatus,
          model: editModel || undefined,
          agents: editAgents || undefined,
          body: editBody.trim()
        })
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const rawText = await response.text();
      const payload = isJson ? (() => { try { return JSON.parse(rawText); } catch { return {}; } })() : {};

      if (!response.ok) {
        const msg = payload?.message || `Review failed (HTTP ${response.status})`;
        setActionError({
          message: msg,
          details: [
            `URL:          POST ${url}`,
            `HTTP Status:  ${response.status} ${response.statusText}`,
            `Content-Type: ${contentType || '(empty)'}`,
            '',
            '--- Response Body ---',
            isJson ? JSON.stringify(payload, null, 2) : rawText.slice(0, 2000),
            '',
            `Timestamp:    ${new Date().toISOString()}`
          ].join('\n')
        });
        return;
      }

      if (payload.improvedBody) {
        setEditBody(payload.improvedBody);
        showToast(payload.summary || 'Task reviewed and improved', 'success');
      } else {
        showToast('Review completed but no changes suggested', 'neutral');
      }
    } catch (err: any) {
      setActionError({
        message: err.message || 'Review failed',
        details: `Error: ${err.message}\nTimestamp: ${new Date().toISOString()}`
      });
    } finally {
      setReviewing(false);
    }
  }, [editName, editPriority, editType, editStatus, editModel, editAgents, editBody, apiBaseUrl, showToast]);

  const handleDeleteClick = useCallback(() => {
    if (confirmDelete) {
      handleDelete();
    } else {
      setConfirmDelete(true);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmDelete(false);
        confirmTimerRef.current = null;
      }, 4000);
    }
  }, [confirmDelete]);

  const handleDelete = useCallback(async () => {
    if (!task) return;
    const url = `${apiBaseUrl}/api/board/task`;
    const requestBody = { taskId: task.id, deleteEpicFolder: isEpic ? deleteEpicFolder : false };

    setDeleting(true);
    setActionError(null);
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const rawText = await response.text();
      const payload = isJson ? (() => { try { return JSON.parse(rawText); } catch { return {}; } })() : {};

      if (!response.ok) {
        const msg = payload?.message || `Failed to delete (HTTP ${response.status})`;
        setActionError({
          message: msg,
          details: [
            `URL:          DELETE ${url}`,
            `Task ID:      ${task.id}`,
            `HTTP Status:  ${response.status} ${response.statusText}`,
            `Content-Type: ${contentType || '(empty)'}`,
            '',
            '--- Request Body ---',
            JSON.stringify(requestBody, null, 2),
            '',
            '--- Response Body ---',
            isJson ? JSON.stringify(payload, null, 2) : rawText.slice(0, 2000),
            '',
            `Timestamp:    ${new Date().toISOString()}`
          ].join('\n')
        });
        return;
      }
      showToast(`Deleted "${task.name}"`, 'success');
      onDeleted?.();
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Failed to delete';
      setActionError({
        message: msg,
        details: [
          `URL:          DELETE ${url}`,
          `Task ID:      ${task.id}`,
          `Error:        ${msg}`,
          `Type:         ${err.name || 'Unknown'}`,
          '',
          err.stack ? `--- Stack ---\n${err.stack}` : '',
          `Timestamp:    ${new Date().toISOString()}`
        ].filter(Boolean).join('\n')
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [task, apiBaseUrl, isEpic, deleteEpicFolder, showToast, onDeleted, onClose]);

  const renderedHtml = markdown
    ? marked.parse(markdown, { async: false, gfm: true, breaks: true }) as string
    : '';

  const priorityColor = task ? BOARD_PRIORITY_COLORS[task.priority] : undefined;
  const typeColor = task ? BOARD_TYPE_COLORS[task.type] : undefined;

  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable={!saving && !deleting}>
      <Modal className="sm:max-w-2xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-secondary px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon icon={File06} className="size-5 shrink-0 text-tertiary" />
                  <h3 className="m-0 truncate text-lg font-semibold text-primary">
                    {editing ? editName || 'Task' : (task?.name || 'Task')}
                  </h3>
                </div>
                {!editing && task && (task.priority || task.type || task.status) && (
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
                {!editing && task && (task.model || task.agents.length > 0) && (
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

              {!loading && !error && editing && (
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className={labelClasses}>Name *</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputClasses}
                      autoFocus
                    />
                  </div>

                  {/* Row: Priority + Type + Status */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClasses}>Priority</label>
                      <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)} className={selectClasses}>
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Type</label>
                      <select value={editType} onChange={(e) => setEditType(e.target.value)} className={selectClasses}>
                        {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Status</label>
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className={selectClasses}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Model */}
                  <div>
                    <label className={labelClasses}>Model</label>
                    <select value={editModel} onChange={(e) => setEditModel(e.target.value)} className={selectClasses}>
                      <option value="">Default</option>
                      {CLAUDE_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Agents */}
                  <div>
                    <label className={labelClasses}>Agents</label>
                    <input
                      type="text"
                      value={editAgents}
                      onChange={(e) => setEditAgents(e.target.value)}
                      placeholder="frontend, design"
                      className={inputClasses}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label className={labelClasses}>Content (Markdown)</label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="w-full min-h-[30vh] resize-y rounded-lg border border-secondary bg-secondary p-3 font-mono text-sm text-primary focus:border-brand-solid focus:outline-none"
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              {!loading && !error && !editing && renderedHtml && (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary prose-strong:text-primary prose-a:text-brand-primary [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-utility-success-500"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              )}
            </div>

            {/* Action error banner */}
            {actionError && (
              <div className="mx-6 mb-0 mt-0 rounded-lg border border-error-primary bg-utility-error-50 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Icon icon={AlertTriangle} className="size-4 shrink-0 text-error-primary mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-error-primary">{actionError.message}</p>
                    {onShowErrorDetail && (
                      <button
                        type="button"
                        onClick={() => onShowErrorDetail(
                          editing ? 'Save Task Error' : 'Delete Task Error',
                          actionError.details
                        )}
                        className="mt-1 text-xs font-medium text-error-primary underline hover:no-underline"
                      >
                        View Details
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center border-t border-secondary px-6 py-3">
              {/* Left side: Delete */}
              {!editing && !loading && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    color={confirmDelete ? 'primary-destructive' : 'tertiary-destructive'}
                    onPress={handleDeleteClick}
                    isLoading={deleting}
                    iconLeading={<Trash01 className="size-4" />}
                  >
                    {confirmDelete ? 'Confirm Delete?' : 'Delete'}
                  </Button>
                  {isEpic && confirmDelete && (
                    <label className="flex items-center gap-1.5 text-xs text-tertiary">
                      <input
                        type="checkbox"
                        checked={deleteEpicFolder}
                        onChange={(e) => setDeleteEpicFolder(e.target.checked)}
                        className="accent-utility-error-500"
                      />
                      Delete entire folder
                    </label>
                  )}
                </div>
              )}

              {/* Right side: Edit/Save/Cancel/Close */}
              <div className="ml-auto flex items-center gap-2">
                {editing ? (
                  <>
                    <Button size="md" color="secondary" onPress={handleCancelEdit} isDisabled={saving || reviewing}>
                      Cancel
                    </Button>
                    <Button
                      size="md"
                      color="secondary"
                      onPress={handleReview}
                      isLoading={reviewing}
                      isDisabled={saving || !editBody.trim()}
                      iconLeading={<Stars01 className="size-4" />}
                    >
                      Review with Claude
                    </Button>
                    <Button size="md" color="primary" onPress={handleSave} isLoading={saving} isDisabled={reviewing}>
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    {!loading && !error && (
                      <Button
                        size="md"
                        color="secondary"
                        onPress={handleEdit}
                        iconLeading={<Edit05 className="size-4" />}
                      >
                        Edit
                      </Button>
                    )}
                    <Button size="md" color="secondary" onPress={onClose}>
                      Close
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
