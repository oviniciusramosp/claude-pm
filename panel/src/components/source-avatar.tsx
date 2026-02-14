// panel/src/components/source-avatar.tsx

import { useState } from 'react';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import type { LogSourceMeta } from '../types';

export function SourceAvatar({ sourceMeta }: { sourceMeta: LogSourceMeta }) {
  const [hasImageError, setHasImageError] = useState(false);
  const useImage = Boolean(sourceMeta.avatarUrl) && !hasImageError;

  return (
    <span
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-secondary bg-primary text-[10px] font-semibold uppercase text-secondary shadow-xs',
        sourceMeta.directClaude ? 'border-brand/40 bg-brand-secondary text-brand-primary' : ''
      )}
      aria-hidden="true"
    >
      {useImage ? (
        <img
          src={sourceMeta.avatarUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setHasImageError(true)}
        />
      ) : sourceMeta.icon ? (
        <Icon icon={sourceMeta.icon} className="size-3.5" />
      ) : (
        sourceMeta.avatarInitials || '?'
      )}
    </span>
  );
}
