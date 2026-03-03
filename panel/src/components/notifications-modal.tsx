// panel/src/components/notifications-modal.tsx

import { Bell01, VolumeMax } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { handleModalKeyDown } from '@/utils/modal-keyboard';
import type { NotificationSettings } from '../hooks/useNotifications';

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
  const canUseBrowser = typeof Notification !== 'undefined';
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
                    {!canUseBrowser && (
                      <p className="m-0 mt-1 text-xs text-tertiary">Not supported in this browser.</p>
                    )}
                    {canUseBrowser && browserPermission === 'denied' && (
                      <p className="m-0 mt-1 text-xs text-error-primary">
                        Permission denied — allow notifications in browser settings.
                      </p>
                    )}
                    {canUseBrowser && browserPermission === 'default' && (
                      <p className="m-0 mt-1 text-xs text-tertiary">
                        Permission not yet granted.
                      </p>
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
                      className="flex-1 accent-brand-solid"
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
                        <Button size="sm" color="secondary" onPress={previews[previewKey]}>
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
