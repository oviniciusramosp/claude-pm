// panel/src/components/toast-notification.tsx

import { AlertCircle, CheckCircle, InfoCircle, XCircle } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { TOAST_TONE_CLASSES } from '../constants';
import { Icon } from './icon';
import type { ToastState } from '../types';

export function ToastNotification({ toast }: { toast: ToastState }) {
  if (!toast.open) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed bottom-4 left-1/2 z-[2000] w-[min(92vw,440px)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-lg',
        TOAST_TONE_CLASSES[toast.color] || TOAST_TONE_CLASSES.neutral
      )}
    >
      <div className="inline-flex items-center gap-2">
        <Icon
          icon={
            toast.color === 'success' ? CheckCircle : toast.color === 'danger' ? XCircle : toast.color === 'warning' ? AlertCircle : InfoCircle
          }
          className="size-4"
        />
        {toast.message}
      </div>
    </div>
  );
}
