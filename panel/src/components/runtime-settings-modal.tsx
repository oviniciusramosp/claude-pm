// panel/src/components/runtime-settings-modal.tsx

import { Activity, File03 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { handleModalKeyDown } from '@/utils/modal-keyboard';
import type { RuntimeSettings } from '../types';

export function RuntimeSettingsModal({
  runtimeSettingsModalOpen,
  setRuntimeSettingsModalOpen,
  apiRunning,
  runtimeSettings,
  busy,
  updateRuntimeSetting
}: {
  runtimeSettingsModalOpen: boolean;
  setRuntimeSettingsModalOpen: (open: boolean) => void;
  apiRunning: boolean;
  runtimeSettings: RuntimeSettings;
  busy: Record<string, any>;
  updateRuntimeSetting: (settingKey: string, checked: boolean) => void;
}) {
  return (
    <ModalOverlay
      isOpen={runtimeSettingsModalOpen}
      onOpenChange={setRuntimeSettingsModalOpen}
      isDismissable
    >
      <Modal className="sm:max-w-xl">
        <Dialog>
          <div
            className="w-full rounded-xl border border-secondary bg-primary p-6 shadow-2xl"
            onKeyDown={(e) => handleModalKeyDown(e, () => setRuntimeSettingsModalOpen(false))}
          >
            <div className="space-y-2">
              <h3 className="m-0 text-lg font-semibold text-primary">Runtime Settings</h3>
              <p className="m-0 text-sm text-tertiary">Applied immediately to the next task execution.</p>
            </div>

            <div className="mt-4 space-y-3 rounded-lg border border-secondary bg-secondary p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                  <Icon icon={Activity} className="size-4" />
                  Show Claude Live Output
                </p>
                <Toggle
                  aria-label="Show Claude Live Output"
                  isDisabled={!apiRunning || Boolean(busy.runtime_streamOutput)}
                  isSelected={Boolean(runtimeSettings.streamOutput)}
                  onChange={(selected) => {
                    updateRuntimeSetting('streamOutput', selected);
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="m-0 inline-flex items-center gap-2 text-sm text-secondary">
                  <Icon icon={File03} className="size-4" />
                  Log Prompt Sent to Claude
                </p>
                <Toggle
                  aria-label="Log Prompt Sent to Claude"
                  isDisabled={!apiRunning || Boolean(busy.runtime_logPrompt)}
                  isSelected={Boolean(runtimeSettings.logPrompt)}
                  onChange={(selected) => {
                    updateRuntimeSetting('logPrompt', selected);
                  }}
                />
              </div>
            </div>

            {!apiRunning ? <p className="m-0 mt-3 text-sm text-warning-primary">Start Automation App to change runtime settings.</p> : null}

            <div className="mt-5 flex justify-end">
              <Button
                size="md"
                color="secondary"
                onPress={() => {
                  setRuntimeSettingsModalOpen(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
