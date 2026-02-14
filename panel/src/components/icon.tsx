// panel/src/components/icon.tsx

import type { FC } from 'react';

export function Icon({ icon: IconComponent, className = 'size-4' }: {
  icon?: FC<{ className?: string; 'aria-hidden'?: string }>;
  className?: string;
}) {
  if (!IconComponent) {
    return null;
  }

  return <IconComponent aria-hidden="true" className={className} />;
}
