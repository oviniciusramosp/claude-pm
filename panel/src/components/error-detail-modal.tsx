// panel/src/components/error-detail-modal.tsx

import { AlertTriangle } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';

export function ErrorDetailModal({
  open,
  onClose,
  title,
  errorMessage
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  errorMessage: string;
}) {
  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable>
      <Modal className="sm:max-w-lg">
        <Dialog>
          <div className="w-full rounded-2xl border border-secondary bg-primary p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-utility-error-50 text-utility-error-600">
                <Icon icon={AlertTriangle} className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="m-0 text-lg font-semibold text-primary">{title}</h3>
                <p className="m-0 text-sm text-tertiary">The operation failed with the following error:</p>
              </div>
            </div>

            <pre className="mt-4 max-h-[300px] overflow-auto rounded-xl border border-secondary bg-secondary p-3 text-sm leading-relaxed text-secondary">
              {errorMessage}
            </pre>

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
