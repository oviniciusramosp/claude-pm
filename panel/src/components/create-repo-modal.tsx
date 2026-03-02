// panel/src/components/create-repo-modal.tsx

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, FolderPlus, GitBranch02, X } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { handleModalKeyDown } from '@/utils/modal-keyboard';

interface GhStatus {
  available: boolean;
  authenticated: boolean;
  username: string | null;
  workdirBasename: string;
  reason: string | null;
}

interface CreateRepoModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onSuccess: () => void;
}

export function CreateRepoModal({ open, onClose, apiBaseUrl, showToast, onSuccess }: CreateRepoModalProps) {
  const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [repoType, setRepoType] = useState<'github' | 'local'>('github');
  const [repoName, setRepoName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch gh status when modal opens
  useEffect(() => {
    if (!open) return;
    setGhStatus(null);
    setLoadingStatus(true);
    setRepoName('');
    setRepoType('github');
    setVisibility('private');

    fetch(`${apiBaseUrl}/api/git/gh-status`)
      .then((r) => r.json())
      .then((data: GhStatus) => {
        setGhStatus(data);
        setRepoName(data.workdirBasename || 'my-project');
        if (!data.available || !data.authenticated) setRepoType('local');
      })
      .catch(() => {
        setGhStatus({ available: false, authenticated: false, username: null, workdirBasename: 'my-project', reason: 'Could not reach API.' });
        setRepoName('my-project');
        setRepoType('local');
      })
      .finally(() => setLoadingStatus(false));
  }, [open, apiBaseUrl]);

  const githubReady = ghStatus?.available && ghStatus?.authenticated;

  async function handleCreate() {
    setCreating(true);
    try {
      const body: Record<string, string> = { type: repoType };
      if (repoType === 'github') {
        body.repoName = repoName.trim() || ghStatus?.workdirBasename || 'my-project';
        body.visibility = visibility;
      }

      const res = await fetch(`${apiBaseUrl}/api/git/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json();

      if (!res.ok || !payload.ok) {
        showToast(payload.message || 'Failed to create repository.', 'danger');
        return;
      }

      showToast(payload.message, 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to create repository.', 'danger');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalOverlay isOpen={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Modal>
        <Dialog>
          <div
            className="w-full max-w-md rounded-xl border border-secondary bg-primary shadow-xl"
            onKeyDown={(e) => handleModalKeyDown(e, onClose)}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
              <div className="flex items-center gap-2">
                <Icon icon={FolderPlus} className="size-5 text-tertiary" />
                <h2 className="text-base font-semibold text-primary">Create Repository</h2>
              </div>
              <button
                onClick={onClose}
                className="rounded p-1 text-tertiary hover:bg-secondary hover:text-primary"
                aria-label="Close"
              >
                <Icon icon={X} className="size-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              {loadingStatus ? (
                <div className="flex items-center justify-center py-6 text-sm text-tertiary">
                  <span className="animate-pulse">Checking GitHub CLI…</span>
                </div>
              ) : (
                <>
                  {/* Option cards */}
                  <div className="mb-4 space-y-2">
                    {/* GitHub option */}
                    <button
                      type="button"
                      disabled={!githubReady}
                      onClick={() => setRepoType('github')}
                      className={[
                        'w-full rounded-lg border p-3 text-left transition',
                        repoType === 'github' && githubReady
                          ? 'border-brand-solid bg-brand-primary'
                          : githubReady
                            ? 'border-secondary bg-primary hover:border-brand-solid hover:bg-secondary'
                            : 'cursor-not-allowed border-secondary bg-secondary opacity-50'
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon icon={GitBranch02} className="size-4 text-secondary" />
                          <span className="text-sm font-medium text-primary">GitHub Repository</span>
                          <span className="rounded bg-brand-secondary px-1.5 py-0.5 text-xs font-medium text-brand-primary">Recommended</span>
                        </div>
                        {repoType === 'github' && githubReady && (
                          <Icon icon={Check} className="size-4 text-brand-primary" />
                        )}
                      </div>
                      {githubReady ? (
                        <p className="mt-1 text-xs text-tertiary">
                          Create on GitHub and sync remotely.
                          {ghStatus?.username && ` Logged in as ${ghStatus.username}.`}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-error-primary">
                          {ghStatus?.reason || 'GitHub CLI unavailable.'}
                        </p>
                      )}
                    </button>

                    {/* Local option */}
                    <button
                      type="button"
                      onClick={() => setRepoType('local')}
                      className={[
                        'w-full rounded-lg border p-3 text-left transition',
                        repoType === 'local'
                          ? 'border-brand-solid bg-brand-primary'
                          : 'border-secondary bg-primary hover:border-brand-solid hover:bg-secondary'
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon icon={FolderPlus} className="size-4 text-secondary" />
                          <span className="text-sm font-medium text-primary">Local Repository</span>
                        </div>
                        {repoType === 'local' && (
                          <Icon icon={Check} className="size-4 text-brand-primary" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-tertiary">Initialize git locally (no remote).</p>
                    </button>
                  </div>

                  {/* GitHub-specific options */}
                  {repoType === 'github' && githubReady && (
                    <div className="mb-4 space-y-3 rounded-lg border border-secondary bg-secondary p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-secondary">Repository name</label>
                        <input
                          ref={inputRef}
                          type="text"
                          value={repoName}
                          onChange={(e) => setRepoName(e.target.value.replace(/\s+/g, '-'))}
                          className="w-full rounded-md border border-secondary bg-primary px-3 py-1.5 text-sm text-primary placeholder-quaternary focus:border-brand-solid focus:outline-none"
                          placeholder={ghStatus?.workdirBasename || 'my-project'}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-secondary">Visibility</label>
                        <div className="flex gap-2">
                          {(['private', 'public'] as const).map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setVisibility(v)}
                              className={[
                                'rounded-md border px-3 py-1 text-xs font-medium capitalize transition',
                                visibility === v
                                  ? 'border-brand-solid bg-brand-primary text-brand-primary'
                                  : 'border-secondary text-tertiary hover:border-brand-solid'
                              ].join(' ')}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* No gh installed notice */}
                  {!ghStatus?.available && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-primary bg-utility-warning-50 p-3 text-xs text-warning-primary">
                      <Icon icon={AlertCircle} className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        GitHub CLI not found. Install it with{' '}
                        <code className="rounded bg-utility-warning-100 px-1 font-mono">brew install gh</code>{' '}
                        then run{' '}
                        <code className="rounded bg-utility-warning-100 px-1 font-mono">gh auth login</code>.
                      </span>
                    </div>
                  )}

                  {/* gh installed but not authenticated */}
                  {ghStatus?.available && !ghStatus?.authenticated && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-primary bg-utility-warning-50 p-3 text-xs text-warning-primary">
                      <Icon icon={AlertCircle} className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        GitHub CLI found but not authenticated. Run{' '}
                        <code className="rounded bg-utility-warning-100 px-1 font-mono">gh auth login</code>{' '}
                        to enable GitHub repositories.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-secondary px-5 py-4">
              <Button size="sm" color="secondary" onPress={onClose} isDisabled={creating}>
                Cancel
              </Button>
              <Button
                size="sm"
                color="primary"
                isLoading={creating}
                isDisabled={loadingStatus}
                onPress={handleCreate}
              >
                {repoType === 'github' ? 'Create on GitHub' : 'Initialize Local'}
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
