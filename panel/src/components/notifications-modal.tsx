// panel/src/components/notifications-modal.tsx

import { useState } from 'react';
import { Bell01, ChevronDown, VolumeMax } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { handleModalKeyDown } from '@/utils/modal-keyboard';
import { cx } from '@/utils/cx';
import type { NotificationSettings } from '../hooks/useNotifications';

type BrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

function detectBrowser(): BrowserKind {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox/')) return 'firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'safari';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'other';
}

const BROWSER_STEPS: Record<BrowserKind, { name: string; steps: string[] }> = {
  chrome: {
    name: 'Chrome',
    steps: [
      'Click the "Not secure" label or the info icon (ⓘ) in the address bar.',
      'Click "Site settings" in the panel that opens.',
      'Find "Notifications" and change the value to "Allow".',
      'Reload this page.',
    ],
  },
  edge: {
    name: 'Edge',
    steps: [
      'Click the "Not secure" label or the info icon (ⓘ) in the address bar.',
      'Click "Permissions for this site".',
      'Find "Notifications" and change to "Allow".',
      'Reload this page.',
    ],
  },
  firefox: {
    name: 'Firefox',
    steps: [
      'Click the crossed-out lock or info icon in the address bar.',
      'Click "Remove permission" next to Notifications, then reload.',
      'The browser will ask again — choose "Allow".',
    ],
  },
  safari: {
    name: 'Safari',
    steps: [
      'In the menu bar: Safari → Settings → Websites → Notifications.',
      'Find this site in the list and change the setting to "Allow".',
      'Reload this page.',
    ],
  },
  other: {
    name: 'your browser',
    steps: [
      'Open your browser settings and search for "Notifications" or "Site permissions".',
      'Find this site in the list and change the permission to "Allow".',
      'Reload this page.',
    ],
  },
};

function PermissionDeniedHelp() {
  const [expanded, setExpanded] = useState(false);
  const browser = detectBrowser();
  const { name, steps } = BROWSER_STEPS[browser];
  const origin = window.location.origin;

  return (
    <div className="mt-2 rounded-lg border border-error-primary/30 bg-error-primary/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-xs text-error-primary">
          Permission blocked by {name}. You need to re-enable it manually.
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded p-0.5 text-xs text-error-primary/70 transition hover:text-error-primary"
          aria-expanded={expanded}
          aria-label="Toggle instructions"
        >
          <Icon icon={ChevronDown} className={cx('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <p className="m-0 text-xs font-medium text-secondary">Steps for {name}:</p>
          <ol className="m-0 space-y-1 pl-4">
            {steps.map((step, i) => (
              <li key={i} className="text-xs text-secondary">{step}</li>
            ))}
          </ol>
          <p className="m-0 pt-1 text-xs text-tertiary">
            Look for this site in your browser settings:
          </p>
          <code className="block rounded bg-secondary px-2 py-1 text-xs text-primary">
            {origin}
          </code>
        </div>
      )}
    </div>
  );
}

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  settings: NotificationSettings;
  browserPermission: NotificationPermission;
  onSettingChange: (updates: Partial<NotificationSettings>) => void;
  onRequestPermission: () => Promise<NotificationPermission>;
  onPreviewTaskDone: () => void;
  onPreviewEpicDone: () => void;
  onPreviewError: () => void;
}

const EVENT_ROWS = [
  { key: 'notifyTaskDone', label: 'Task Completed', previewKey: 'onPreviewTaskDone' },
  { key: 'notifyEpicDone', label: 'Epic Completed', previewKey: 'onPreviewEpicDone' },
  { key: 'notifyError',    label: 'Error',           previewKey: 'onPreviewError' },
] as const;

function InsecureContextWarning() {
  const [expanded, setExpanded] = useState(false);
  const port = window.location.port || '4100';
  const localhostUrl = `http://localhost:${port}`;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-warning-primary/30 bg-warning-primary/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-2 p-3 text-left"
        aria-expanded={expanded}
      >
        <p className="m-0 text-xs font-medium text-warning-primary">
          Browser notifications require HTTPS or localhost.
        </p>
        <Icon icon={ChevronDown} className={cx('size-3.5 shrink-0 text-warning-primary transition-transform mt-0.5', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-warning-primary/20 px-3 pb-3 pt-2 space-y-3">
          <p className="m-0 text-xs text-secondary">
            You are accessing the panel via a plain HTTP address. Browsers block the Notifications API on non-secure contexts.
          </p>

          <div className="space-y-1.5">
            <p className="m-0 text-xs font-semibold text-secondary">Option 1 — Enable HTTPS locally (recommended)</p>
            <p className="m-0 text-xs text-secondary">Install mkcert once, then restart the panel. Certificates are generated automatically and browser notifications will work from any device on your network.</p>
            <ol className="m-0 space-y-1 pl-4">
              <li className="text-xs text-secondary">
                Install mkcert:{' '}
                <code className="rounded bg-secondary px-1 text-xs text-primary">brew install mkcert</code>
              </li>
              <li className="text-xs text-secondary">
                Restart the panel:{' '}
                <code className="rounded bg-secondary px-1 text-xs text-primary">npm run panel</code>
              </li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <p className="m-0 text-xs font-semibold text-secondary">Option 2 — Use localhost (same machine only)</p>
            <p className="m-0 text-xs text-secondary">
              Open the panel at{' '}
              <code className="rounded bg-secondary px-1 text-xs text-primary">{localhostUrl}</code>{' '}
              instead of the LAN IP address.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="m-0 text-xs font-semibold text-secondary">Option 3 — Public tunnel (access from anywhere)</p>
            <p className="m-0 text-xs text-secondary">
              Run{' '}
              <code className="rounded bg-secondary px-1 text-xs text-primary">npm run panel:public</code>{' '}
              to get an HTTPS Cloudflare Tunnel URL. Requires{' '}
              <code className="rounded bg-secondary px-1 text-xs text-primary">brew install cloudflared</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationsModal({
  open,
  onClose,
  settings,
  browserPermission,
  onSettingChange,
  onRequestPermission,
  onPreviewTaskDone,
  onPreviewEpicDone,
  onPreviewError,
}: NotificationsModalProps) {
  const isSecureContext = window.isSecureContext;
  const canUseBrowser = typeof Notification !== 'undefined' && isSecureContext;
  const previews: Record<string, () => void> = {
    onPreviewTaskDone,
    onPreviewEpicDone,
    onPreviewError,
  };

  return (
    <ModalOverlay isOpen={open} onOpenChange={onClose} isDismissable className="!overflow-hidden">
      <Modal className="sm:max-w-xl">
        <Dialog>
          <div
            className="w-full rounded-xl border border-secondary bg-primary p-6 shadow-2xl"
            onKeyDown={(e) => handleModalKeyDown(e, onClose)}
          >
            <div className="space-y-1">
              <h3 className="m-0 text-lg font-semibold text-primary">Notifications</h3>
              <p className="m-0 text-sm text-tertiary">Get notified when tasks complete or errors occur.</p>
            </div>

            {/* Browser */}
            <div className="mt-5 space-y-2">
              <p className="m-0 text-xs font-semibold uppercase tracking-wider text-quaternary">Browser</p>
              <div className="rounded-lg border border-secondary bg-secondary p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                      <Icon icon={Bell01} className="size-4" />
                      Browser Notifications
                    </p>
                    {typeof Notification === 'undefined' && (
                      <p className="m-0 mt-1 text-xs text-tertiary">Not supported in this browser.</p>
                    )}
                    {canUseBrowser && browserPermission === 'default' && (
                      <p className="m-0 mt-1 text-xs text-tertiary">Permission not yet granted.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canUseBrowser && browserPermission === 'default' && (
                      <Button
                        size="sm"
                        color="secondary"
                        onPress={async () => {
                          const result = await onRequestPermission();
                          if (result === 'granted') onSettingChange({ browserEnabled: true });
                        }}
                      >
                        Grant
                      </Button>
                    )}
                    <Toggle
                      aria-label="Enable browser notifications"
                      isDisabled={!canUseBrowser || browserPermission !== 'granted'}
                      isSelected={settings.browserEnabled && canUseBrowser && browserPermission === 'granted'}
                      onChange={(v) => onSettingChange({ browserEnabled: v })}
                    />
                  </div>
                </div>
                {!isSecureContext && typeof Notification !== 'undefined' && <InsecureContextWarning />}
                {canUseBrowser && browserPermission === 'denied' && <PermissionDeniedHelp />}
              </div>
            </div>

            {/* Audio */}
            <div className="mt-4 space-y-2">
              <p className="m-0 text-xs font-semibold uppercase tracking-wider text-quaternary">Audio</p>
              <div className="rounded-lg border border-secondary bg-secondary p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                    <Icon icon={VolumeMax} className="size-4" />
                    Sound Alerts
                  </p>
                  <Toggle
                    aria-label="Enable sound alerts"
                    isSelected={settings.audioEnabled}
                    onChange={(v) => onSettingChange({ audioEnabled: v })}
                  />
                </div>

                {settings.audioEnabled && (
                  <div className="flex items-center gap-3">
                    <span className="w-12 text-xs text-tertiary">Volume</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.volume}
                      onChange={(e) => onSettingChange({ volume: parseFloat(e.target.value) })}
                      className="flex-1"
                      style={{ accentColor: 'var(--color-bg-brand-solid)' }}
                      aria-label="Notification volume"
                    />
                    <span className="w-8 text-right text-xs text-tertiary">
                      {Math.round(settings.volume * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Events */}
            <div className="mt-4 space-y-2">
              <p className="m-0 text-xs font-semibold uppercase tracking-wider text-quaternary">Events</p>
              <div className="rounded-lg border border-secondary bg-secondary p-4 space-y-3">
                {EVENT_ROWS.map(({ key, label, previewKey }) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <p className="m-0 text-sm text-secondary">{label}</p>
                    <div className="flex items-center gap-2">
                      {settings.audioEnabled && (
                        <Button size="sm" color="tertiary" onPress={previews[previewKey]}>
                          Preview
                        </Button>
                      )}
                      <Toggle
                        aria-label={`Notify on ${label}`}
                        isSelected={Boolean(settings[key])}
                        onChange={(v) => onSettingChange({ [key]: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
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
