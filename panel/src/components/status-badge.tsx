// panel/src/components/status-badge.tsx

import type { FC, ReactNode } from 'react';
import { CloudOff } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import { ConnectionDot } from './connection-dot';

export function StatusBadge({
  color = 'gray',
  icon,
  children,
  connectionState = null,
  onClick
}: {
  color?: 'gray' | 'brand' | 'error' | 'warning' | 'success' | 'gray-blue' | 'blue-light' | 'blue' | 'indigo' | 'purple' | 'pink' | 'orange';
  icon?: FC<{ className?: string }>;
  children: ReactNode;
  connectionState?: 'active' | 'inactive' | null;
  onClick?: () => void;
}) {
  const isConnection = Boolean(connectionState);
  const isActive = connectionState === 'active';

  function renderLeading() {
    if (!isConnection) {
      return icon ? <Icon icon={icon} className="size-3.5 stroke-[2.5] text-current" /> : null;
    }
    if (isActive) {
      return <ConnectionDot pulse />;
    }
    return <Icon icon={CloudOff} className="size-3 stroke-[2.5] text-current" />;
  }

  return (
    <Badge
      color={color}
      type="pill-color"
      size="sm"
      className={cx('inline-flex items-center gap-1', onClick ? 'cursor-pointer hover:opacity-80' : '')}
      {...(onClick ? { onClick } : {})}
    >
      {renderLeading()}
      <span>{children}</span>
    </Badge>
  );
}
