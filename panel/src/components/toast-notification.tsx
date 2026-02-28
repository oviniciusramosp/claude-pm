// panel/src/components/toast-notification.tsx

import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle, InfoCircle, XCircle, X } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { TOAST_TONE_CLASSES } from '../constants';
import { Icon } from './icon';
import type { ToastState } from '../types';

interface ToastContainerProps {
  toasts: ToastState;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: { toast: ToastState[number]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    // duration: undefined = default 30s, null = persist forever, number = custom ms
    const ms = toast.duration === undefined ? 30000 : toast.duration;
    if (ms === null) return;
    const timer = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 pointer-events-auto shadow-lg',
        TOAST_TONE_CLASSES[toast.color] || TOAST_TONE_CLASSES.neutral
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="inline-flex items-center gap-2 min-w-0">
        <Icon
          icon={
            toast.color === 'success'
              ? CheckCircle
              : toast.color === 'danger'
                ? XCircle
                : toast.color === 'warning'
                  ? AlertCircle
                  : InfoCircle
          }
          className="size-4 shrink-0"
        />
        <span className="break-words">{toast.message}</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 p-1 rounded hover:opacity-75 transition-opacity"
        aria-label="Dismiss notification"
      >
        <Icon icon={X} className="size-4" />
      </button>
    </div>
  );
}

export function ToastNotification({ toasts, onDismiss }: ToastContainerProps) {
  if (!toasts || toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] w-[min(92vw,440px)] flex flex-col gap-3 pointer-events-none"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{ animation: `slideUp 0.3s ease-out ${index * 0.05}s backwards` }}
        >
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
