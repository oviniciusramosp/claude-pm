// panel/src/components/runtime-settings-modal.tsx

import { Activity, File03, Cpu02 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { CLAUDE_MODELS } from '../constants';
import type { RuntimeSettings } from '../types';

export function RuntimeSettingsModal({
  runtimeSettingsModalOpen,
  setRuntimeSettingsModalOpen,
  apiRunning,
  runtimeSettings,
  busy,
  updateRuntimeSetting,
  updateModelOverride
}: {
  runtimeSettingsModalOpen: boolean;
  setRuntimeSettingsModalOpen: (open: boolean) => void;
  apiRunning: boolean;
  runtimeSettings: RuntimeSettings;
  busy: Record<string, any>;
  updateRuntimeSetting: (settingKey: string, checked: boolean) => void;
  updateModelOverride: (model: string) => void;
}) {
  return (
    <ModalOverlay
      isOpen={runtimeSettingsModalOpen}
      onOpenChange={setRuntimeSettingsModalOpen}
      isDismissable
    >
      <Modal className="sm:max-w-xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary p-6 shadow-2xl">
            <div className="space-y-2">
              <h3 className="m-0 text-lg font-semibold text-primary">Runtime Settings</h3>
              <p className="m-0 text-sm text-tertiary">Applied immediately to the next task execution.</p>
            </div>

            <div className="mt-4 space-y-4 rounded-lg border border-secondary bg-secondary p-4">
              <div className="space-y-2">
                <label htmlFor="model-override" className="flex items-center gap-2 text-sm font-medium text-secondary">
                  <Icon icon={Cpu02} className="size-4" />
                  Claude Model
                </label>
                <select
                  id="model-override"
                  disabled={!apiRunning || Boolean(busy.runtime_modelOverride)}
                  value={runtimeSettings.modelOverride || ''}
                  onChange={(e) => {
                    updateModelOverride(e.target.value);
                  }}
                  className="w-full rounded-sm border border-secondary bg-primary px-3 py-2 text-sm text-primary transition hover:border-secondary_hover focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {CLAUDE_MODELS.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <p className="m-0 text-xs text-tertiary">
                  {CLAUDE_MODELS.find((m) => m.value === (runtimeSettings.modelOverride || ''))?.description}
                </p>
              </div>

              <div className="border-t border-secondary pt-3 space-y-3">
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
