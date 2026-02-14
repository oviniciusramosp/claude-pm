// panel/src/components/status-badge.tsx

import type { FC, ReactNode } from 'react';
import { Badge } from '@/components/base/badges/badges';
import { Icon } from './icon';
import { ConnectionDot } from './connection-dot';

export function StatusBadge({
  color = 'gray',
  icon,
  children,
  connectionState = null
}: {
  color?: 'gray' | 'brand' | 'error' | 'warning' | 'success' | 'gray-blue' | 'blue-light' | 'blue' | 'indigo' | 'purple' | 'pink' | 'orange';
  icon?: FC<{ className?: string }>;
  children: ReactNode;
  connectionState?: 'active' | 'inactive' | null;
}) {
  const isConnection = Boolean(connectionState);
  const pulse = connectionState === 'active';

  return (
    <Badge color={color} type="pill-color" size="sm" className="inline-flex items-center gap-1">
      {isConnection ? <ConnectionDot pulse={pulse} /> : icon ? <Icon icon={icon} className="size-3.5 stroke-[2.5] text-current" /> : null}
      <span>{children}</span>
    </Badge>
  );
}
