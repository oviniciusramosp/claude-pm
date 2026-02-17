// panel/src/components/discard-confirm-overlay.tsx

import { useEffect, useRef } from 'react';
import { Button } from '@/components/base/buttons/button';

interface DiscardConfirmOverlayProps {
  open: boolean;
  reviewing: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export function DiscardConfirmOverlay({ open, reviewing, onKeepEditing, onDiscard }: DiscardConfirmOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Auto-focus the dialog when it opens so it receives keyboard events
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
      onClick={(e) => {
        // Prevent clicks from passing through to the modal behind
        e.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="rounded-xl border border-secondary bg-primary p-6 shadow-2xl max-w-sm outline-hidden"
        onClick={(e) => {
          // Prevent clicks on the dialog from closing it
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onKeepEditing();
          } else if (e.key === 'Enter') {
            e.stopPropagation();
            e.preventDefault();
            onDiscard();
          }
        }}
      >
        <h4 className="text-base font-semibold text-primary">
          {reviewing ? 'Cancel review?' : 'Discard changes?'}
        </h4>
        <p className="mt-2 text-sm text-tertiary">
          {reviewing
            ? 'A review is in progress. Closing will cancel it and discard any results.'
            : 'You have unsaved changes that will be lost.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" color="secondary" onPress={onKeepEditing}>
            Keep Editing
          </Button>
          <Button size="sm" color="primary-destructive" onPress={onDiscard}>
            {reviewing ? 'Cancel & Close' : 'Discard'}
          </Button>
        </div>
      </div>
    </div>
  );
}
