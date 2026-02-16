// panel/src/components/debug-errors-modal.tsx

import { AlertTriangle, Copy01, Trash01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { formatFeedTimestamp } from '../utils/log-helpers';
import type { LogEntry } from '../types';

export function DebugErrorsModal({
  open,
  onClose,
  errors,
  onClear,
  onCopy
}: {
  open: boolean;
  onClose: () => void;
  errors: LogEntry[];
  onClear: () => void;
  onCopy: () => void;
}) {
  return (
    <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} isDismissable>
      <Modal className="sm:max-w-2xl">
        <Dialog>
          <div className="w-full rounded-xl border border-secondary bg-primary p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-utility-error-50 text-utility-error-600">
                <Icon icon={AlertTriangle} className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="m-0 text-lg font-semibold text-primary">Debug Errors</h3>
                <p className="m-0 text-sm text-tertiary">
                  {errors.length === 0
                    ? 'No errors captured yet.'
                    : `${errors.length} error${errors.length === 1 ? '' : 's'} captured during this session.`}
                </p>
              </div>
            </div>

            <div className="mt-4 max-h-[400px] space-y-2 overflow-auto rounded-lg border border-secondary bg-secondary p-3">
              {errors.length === 0 ? (
                <p className="m-0 py-6 text-center text-sm text-quaternary">No errors to display.</p>
              ) : (
                errors.map((entry, index) => (
                  <div
                    key={entry.id || `err-${index}`}
                    className="rounded-sm border border-secondary bg-primary p-3"
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] text-tertiary">
                      <span className="font-medium uppercase text-utility-error-600">
                        {String(entry.source || 'unknown').toUpperCase()}
                      </span>
                      <span className="text-quaternary">&bull;</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatFeedTimestamp(entry.ts)}
                      </span>
                    </div>
                    <pre className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-error-primary">
                      {String(entry.message || '')}
                    </pre>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="flex gap-2">
                <Button
                  size="md"
                  color="secondary"
                  iconLeading={Copy01}
                  isDisabled={errors.length === 0}
                  onPress={onCopy}
                >
                  Copy All
                </Button>
                <Button
                  size="md"
                  color="secondary-destructive"
                  iconLeading={Trash01}
                  isDisabled={errors.length === 0}
                  onPress={onClear}
                >
                  Clear
                </Button>
              </div>
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
