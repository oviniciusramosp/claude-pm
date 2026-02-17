// panel/src/components/create-task-modal.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, File06, Stars01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { CLAUDE_TASK_MODELS, CLAUDE_DEFAULT_TASK_MODEL } from '../constants';
import type { BoardTask } from '../types';

interface ModalError {
  message: string;
  details: string;
}

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onCreated: () => void;
  tasks: BoardTask[];
  defaultEpicId?: string;
  onShowErrorDetail?: (title: string, message: string) => void;
}

interface NextNumbers {
  nextStandalone: number;
  nextEpic: number;
  epicChildNext: Record<string, number>;
}

function slugFromTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function extractEpicNumber(epicId: string): number | null {
  const match = epicId.match(/^E(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function extractNumberPrefix(fileName: string, context: 'standalone' | 'epic' | 'child'): string | null {
  if (context === 'standalone') {
    const m = fileName.match(/^(t\d+)-/i);
    return m ? m[1].toLowerCase() : null;
  }
  if (context === 'epic') {
    const m = fileName.match(/^(e\d+)-/i);
    return m ? m[1].toLowerCase() : null;
  }
  // child: s{epicNum}-{childNum}
  const m = fileName.match(/^(s\d+-\d+)-/i);
  return m ? m[1].toLowerCase() : null;
}

const TYPE_OPTIONS = ['UserStory', 'Epic', 'Bug', 'Chore', 'Discovery'] as const;
const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3'] as const;
const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Done'] as const;

const selectClasses = 'appearance-none w-full rounded-lg border border-secondary bg-primary pl-3 pr-9 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const selectChevronClasses = 'pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-quaternary';
const inputClasses = 'w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const labelClasses = 'block text-sm font-medium text-secondary mb-1';

export function CreateTaskModal({ open, onClose, apiBaseUrl, showToast, onCreated, tasks, defaultEpicId, onShowErrorDetail }: CreateTaskModalProps) {
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileNameManual, setFileNameManual] = useState(false);
  const [priority, setPriority] = useState('P1');
  const [type, setType] = useState('UserStory');
  const [status, setStatus] = useState('Not Started');
  const [model, setModel] = useState(CLAUDE_DEFAULT_TASK_MODEL);
  const [agents, setAgents] = useState('');
  const [body, setBody] = useState('');
  const [epicId, setEpicId] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [lastError, setLastError] = useState<ModalError | null>(null);
  const [nextNumbers, setNextNumbers] = useState<NextNumbers | null>(null);

  // Derive available epic folders from tasks (exclude Done epics)
  const availableEpics = useMemo(() => {
    return tasks
      .filter((t) => {
        const taskIsEpic = t.type?.toLowerCase() === 'epic' || tasks.some((c) => c.parentId === t.id);
        const isDone = t.status?.toLowerCase() === 'done';
        return taskIsEpic && !isDone;
      })
      .map((t) => ({ id: t.id, name: t.name }));
  }, [tasks]);

  // Auto-generate fileName from name with number prefix
  useEffect(() => {
    if (fileNameManual) return;
    if (!name) {
      setFileName('');
      return;
    }

    const slug = slugFromTitle(name);
    if (!nextNumbers) {
      setFileName(slug);
      return;
    }

    const isEpic = type === 'Epic' && !epicId;
    if (isEpic) {
      const num = String(nextNumbers.nextEpic).padStart(2, '0');
      setFileName(`e${num}-${slug}`);
    } else if (epicId) {
      const epicNum = extractEpicNumber(epicId);
      const childNum = nextNumbers.epicChildNext[epicId] || 1;
      if (epicNum !== null) {
        setFileName(`s${epicNum}-${childNum}-${slug}`);
      } else {
        setFileName(`${childNum}-${slug}`);
      }
    } else {
      const num = String(nextNumbers.nextStandalone).padStart(2, '0');
      setFileName(`t${num}-${slug}`);
    }
  }, [name, fileNameManual, type, epicId, nextNumbers]);

  // Reset form on open, pre-fill epicId from defaultEpicId, fetch next numbers
  useEffect(() => {
    if (open) {
      setName('');
      setFileName('');
      setFileNameManual(false);
      setPriority('P1');
      setType(defaultEpicId ? 'UserStory' : 'UserStory');
      setStatus('Not Started');
      setModel(CLAUDE_DEFAULT_TASK_MODEL);
      setAgents('');
      setBody('');
      setEpicId(defaultEpicId || '');
      setLastError(null);
      setNextNumbers(null);

      fetch(`${apiBaseUrl}/api/board/next-numbers`)
        .then((r) => r.json())
        .then((data) => { if (data.ok) setNextNumbers(data); })
        .catch(() => {});
    }
  }, [open, defaultEpicId, apiBaseUrl]);

  // Detect duplicate number prefix within the same scope
  const numberConflict = useMemo(() => {
    if (!fileName) return null;

    const isEpic = type === 'Epic' && !epicId;
    const context = isEpic ? 'epic' : epicId ? 'child' : 'standalone';
    const prefix = extractNumberPrefix(fileName, context);
    if (!prefix) return null;

    const scopeTasks = epicId
      ? tasks.filter((t) => t.parentId === epicId)
      : tasks.filter((t) => !t.parentId && (context === 'epic' ? t.type?.toLowerCase() === 'epic' : t.type?.toLowerCase() !== 'epic'));

    for (const t of scopeTasks) {
      const existingFileName = t.id.includes('/') ? t.id.split('/').pop()! : t.id;
      const existingPrefix = extractNumberPrefix(existingFileName, context);
      if (existingPrefix && existingPrefix === prefix) {
        return t;
      }
    }
    return null;
  }, [fileName, type, epicId, tasks]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      showToast('Task name is required', 'warning');
      return;
    }

    setSaving(true);
    setLastError(null);

    const requestBody = {
      name: name.trim(),
      priority,
      type,
      status,
      model: model || undefined,
      agents: agents || undefined,
      body: body || undefined,
      fileName: fileName || undefined,
      epicId: epicId || undefined
    };
    const url = `${apiBaseUrl}/api/board/create-task`;

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
        const msg = payload?.message || `Failed to create task (HTTP ${response.status})`;
        const details = [
          `URL:          POST ${url}`,
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
        ].join('\n');
        setLastError({ message: msg, details });
        return;
      }
      showToast(`Created "${name.trim()}"`, 'success');
      onCreated();
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Failed to create task';
      const details = [
        `URL:          POST ${url}`,
        `Error:        ${msg}`,
        `Type:         ${err.name || 'Unknown'}`,
        '',
        '--- Request Body ---',
        JSON.stringify(requestBody, null, 2),
        '',
        err.stack ? `--- Stack ---\n${err.stack}` : '',
        `Timestamp:    ${new Date().toISOString()}`
      ].filter(Boolean).join('\n');
      setLastError({ message: msg, details });
    } finally {
      setSaving(false);
    }
  }, [name, priority, type, status, model, agents, body, fileName, epicId, apiBaseUrl, showToast, onCreated, onClose]);

  const handleReview = useCallback(async () => {
    if (!name.trim()) {
      showToast('Enter a task name before reviewing', 'warning');
      return;
    }
    if (!body.trim()) {
      showToast('Add task content before reviewing', 'warning');
      return;
    }

    setReviewing(true);
    setLastError(null);

    const url = `${apiBaseUrl}/api/board/review-task`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          priority,
          type,
          status,
          model: model || undefined,
          agents: agents || undefined,
          body: body.trim()
        })
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const rawText = await response.text();
      const payload = isJson ? (() => { try { return JSON.parse(rawText); } catch { return {}; } })() : {};

      if (!response.ok) {
        const msg = payload?.message || `Review failed (HTTP ${response.status})`;
        setLastError({
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
        setBody(payload.improvedBody);
        showToast(payload.summary || 'Task reviewed and improved', 'success');
      } else {
        showToast('Review completed but no changes suggested', 'neutral');
      }
    } catch (err: any) {
      setLastError({
        message: err.message || 'Review failed',
        details: `Error: ${err.message}\nTimestamp: ${new Date().toISOString()}`
      });
    } finally {
      setReviewing(false);
    }
  }, [name, priority, type, status, model, agents, body, apiBaseUrl, showToast]);

  const isEpicType = type === 'Epic' && !epicId;
  const filePath = isEpicType
    ? `Board/${fileName || '...'}/epic.md`
    : epicId
      ? `Board/${epicId}/${fileName || '...'}.md`
      : `Board/${fileName || '...'}.md`;

  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable={!saving}>
      <Modal className="sm:max-w-xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-secondary px-6 py-4">
              <Icon icon={File06} className="size-5 text-tertiary" />
              <h3 className="text-lg font-semibold text-primary">New Task</h3>
            </div>

            {/* Form */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className={labelClasses}>Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Implement login page"
                  className={inputClasses}
                  autoFocus
                />
              </div>

              {/* File Name + path preview */}
              <div>
                <label className={labelClasses}>
                  File Name
                  {!fileNameManual && nextNumbers && (
                    <span className="ml-2 text-xs font-normal text-tertiary">(auto-numbered)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => { setFileName(e.target.value); setFileNameManual(true); }}
                  placeholder="auto-generated"
                  className={inputClasses}
                />
                {fileName && (
                  <p className="mt-1 text-xs text-quaternary font-mono">{filePath}</p>
                )}
                {numberConflict && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-utility-warning-700 dark:text-utility-warning-400">
                    <Icon icon={AlertTriangle} className="size-3 shrink-0" />
                    Duplicate number — already used by &quot;{numberConflict.name}&quot;
                  </p>
                )}
              </div>

              {/* Row: Priority + Type + Status */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClasses}>Priority</label>
                  <div className="relative">
                    <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClasses}>
                      {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <ChevronDown className={selectChevronClasses} />
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>Type</label>
                  <div className="relative">
                    <select value={type} onChange={(e) => { setType(e.target.value); if (e.target.value === 'Epic') setEpicId(''); }} className={selectClasses}>
                      {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <ChevronDown className={selectChevronClasses} />
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>Status</label>
                  <div className="relative">
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClasses}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className={selectChevronClasses} />
                  </div>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className={labelClasses}>Model</label>
                <div className="relative">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={selectClasses}>
                    {CLAUDE_TASK_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown className={selectChevronClasses} />
                </div>
              </div>

              {/* Agents */}
              <div>
                <label className={labelClasses}>Agents</label>
                <input
                  type="text"
                  value={agents}
                  onChange={(e) => setAgents(e.target.value)}
                  placeholder="frontend, design"
                  className={inputClasses}
                />
              </div>

              {/* Epic Parent */}
              <div>
                <label className={labelClasses}>Epic Parent</label>
                <div className="relative">
                  <select
                    value={type === 'Epic' ? '' : epicId}
                    onChange={(e) => setEpicId(e.target.value)}
                    className={selectClasses}
                    disabled={type === 'Epic'}
                  >
                    <option value="">{type === 'Epic' ? 'N/A (creating epic)' : 'None (standalone task)'}</option>
                    {availableEpics.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <ChevronDown className={selectChevronClasses} />
                </div>
              </div>

              {/* Body */}
              <div>
                <label className={labelClasses}>Content (Markdown)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={"# Description\n\n## Acceptance Criteria\n- [ ] First criterion\n- [ ] Second criterion"}
                  className="w-full min-h-[120px] resize-y rounded-lg border border-secondary bg-primary p-3 font-mono text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid"
                  rows={6}
                />
              </div>
            </div>

            {/* Error banner */}
            {lastError && (
              <div className="mx-6 mb-0 mt-0 rounded-lg border border-error-primary bg-utility-error-50 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Icon icon={AlertTriangle} className="size-4 shrink-0 text-error-primary mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-error-primary">{lastError.message}</p>
                    {onShowErrorDetail && (
                      <button
                        type="button"
                        onClick={() => onShowErrorDetail('Create Task Error', lastError.details)}
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
            <div className="flex justify-end gap-2 border-t border-secondary px-6 py-3">
              <Button size="md" color="secondary" onPress={onClose} isDisabled={saving || reviewing}>
                Cancel
              </Button>
              <Button
                size="md"
                color="secondary"
                onPress={handleReview}
                isLoading={reviewing}
                isDisabled={saving || !body.trim()}
                iconLeading={<Stars01 className="size-4" />}
              >
                Review with Claude
              </Button>
              <Button size="md" color="primary" onPress={handleCreate} isLoading={saving} isDisabled={reviewing}>
                Create Task
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
