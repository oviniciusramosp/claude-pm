// panel/src/components/save-confirm-modal.tsx

import { ArrowUpRight } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { LABEL_BY_KEY } from '../constants';

export function SaveConfirmModal({
  saveConfirm,
  setSaveConfirm,
  busy,
  persistConfig
}: {
  saveConfirm: { open: boolean; changedKeys: string[] };
  setSaveConfirm: (value: { open: boolean; changedKeys: string[] }) => void;
  busy: Record<string, any>;
  persistConfig: (options: { restartApi: boolean }) => Promise<void>;
}) {
  return (
    <ModalOverlay
      isOpen={saveConfirm.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setSaveConfirm({ open: false, changedKeys: [] });
        }
      }}
      isDismissable={!busy.save}
    >
      <Modal className="sm:max-w-xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary p-6 shadow-2xl">
            <div className="space-y-2">
              <h3 className="m-0 text-lg font-semibold text-primary">Apply changes now?</h3>
              <p className="m-0 text-sm text-tertiary">The automation app is running. Restart to apply new settings immediately.</p>
            </div>

            <div className="mt-4 rounded-lg border border-secondary bg-secondary p-3 text-sm text-secondary">
              Changed settings: {saveConfirm.changedKeys.map((key) => LABEL_BY_KEY[key] || key).join(', ')}
            </div>

            <p className="m-0 mt-3 text-sm text-tertiary">Restarting the app does not close this panel tab.</p>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                size="md"
                color="secondary"
                isLoading={Boolean(busy.save)}
                onPress={async () => {
                  setSaveConfirm({ open: false, changedKeys: [] });
                  await persistConfig({ restartApi: false });
                }}
              >
                Save without restart
              </Button>
              <Button
                size="md"
                color="primary"
                iconLeading={ArrowUpRight}
                isLoading={Boolean(busy.save)}
                onPress={async () => {
                  setSaveConfirm({ open: false, changedKeys: [] });
                  await persistConfig({ restartApi: true });
                }}
              >
                Save and restart app
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
