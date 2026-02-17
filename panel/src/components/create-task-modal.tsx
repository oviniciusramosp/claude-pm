// panel/src/components/create-task-modal.tsx

import { useCallback, useEffect, useState } from 'react';
import { File06 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { CLAUDE_MODELS } from '../constants';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onCreated: () => void;
}

function slugFromTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

const TYPE_OPTIONS = ['UserStory', 'Epic', 'Bug', 'Chore', 'Discovery'] as const;
const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3'] as const;
const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Done'] as const;

const selectClasses = 'w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const inputClasses = 'w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid';
const labelClasses = 'block text-sm font-medium text-secondary mb-1';

export function CreateTaskModal({ open, onClose, apiBaseUrl, showToast, onCreated }: CreateTaskModalProps) {
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileNameManual, setFileNameManual] = useState(false);
  const [priority, setPriority] = useState('P1');
  const [type, setType] = useState('UserStory');
  const [status, setStatus] = useState('Not Started');
  const [model, setModel] = useState('');
  const [agents, setAgents] = useState('');
  const [body, setBody] = useState('');
  const [epicId, setEpicId] = useState('');
  const [epicFolders, setEpicFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Auto-generate fileName from name
  useEffect(() => {
    if (!fileNameManual && name) {
      setFileName(slugFromTitle(name));
    } else if (!fileNameManual && !name) {
      setFileName('');
    }
  }, [name, fileNameManual]);

  // Fetch epic folders on open
  useEffect(() => {
    if (open) {
      fetch(`${apiBaseUrl}/api/board/epic-folders`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && Array.isArray(data.folders)) {
            setEpicFolders(data.folders);
          }
        })
        .catch(() => {});
    }
  }, [open, apiBaseUrl]);

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName('');
      setFileName('');
      setFileNameManual(false);
      setPriority('P1');
      setType('UserStory');
      setStatus('Not Started');
      setModel('');
      setAgents('');
      setBody('');
      setEpicId('');
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      showToast('Task name is required', 'warning');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          priority,
          type,
          status,
          model: model || undefined,
          agents: agents || undefined,
          body: body || undefined,
          fileName: fileName || undefined,
          epicId: epicId || undefined
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload?.message || 'Failed to create task', 'danger');
        return;
      }
      showToast(`Created "${name.trim()}"`, 'success');
      onCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to create task', 'danger');
    } finally {
      setSaving(false);
    }
  }, [name, priority, type, status, model, agents, body, fileName, epicId, apiBaseUrl, showToast, onCreated, onClose]);

  const filePath = epicId
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
                <label className={labelClasses}>File Name</label>
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
              </div>

              {/* Row: Priority + Type + Status */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClasses}>Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClasses}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className={selectClasses}>
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClasses}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className={labelClasses}>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)} className={selectClasses}>
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
                  value={agents}
                  onChange={(e) => setAgents(e.target.value)}
                  placeholder="frontend, design"
                  className={inputClasses}
                />
              </div>

              {/* Epic Parent */}
              {epicFolders.length > 0 && (
                <div>
                  <label className={labelClasses}>Epic Parent</label>
                  <select value={epicId} onChange={(e) => setEpicId(e.target.value)} className={selectClasses}>
                    <option value="">None (standalone task)</option>
                    {epicFolders.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}

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

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-secondary px-6 py-3">
              <Button size="md" color="secondary" onPress={onClose} isDisabled={saving}>
                Cancel
              </Button>
              <Button size="md" color="primary" onPress={handleCreate} isLoading={saving}>
                Create Task
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
