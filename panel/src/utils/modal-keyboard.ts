// panel/src/utils/modal-keyboard.ts
//
// Utility for modal keyboard shortcuts:
//   - Enter → triggers primary action (skips textarea, select, button)
//   - Cmd/Ctrl+Enter → triggers primary action from anywhere (even textarea)

import type { KeyboardEvent } from 'react';

export function handleModalKeyDown(
  e: KeyboardEvent,
  onPrimaryAction: () => void,
): void {
  if (e.key !== 'Enter') return;

  const tag = (e.target as HTMLElement).tagName;

  // Cmd/Ctrl+Enter always triggers primary action
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    onPrimaryAction();
    return;
  }

  // Plain Enter: skip in textarea, select, and button (preserve native behavior)
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;

  e.preventDefault();
  onPrimaryAction();
}
