import React from 'react';
import { LogOut01 } from '@untitledui/icons';
import { Button } from './base/buttons/button';
import { Icon } from './icon';
import { useAuth } from '@/contexts/auth-context';

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();

  if (!user) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        {user.avatar && (
          <img
            src={user.avatar}
            alt={user.name}
            className="size-6 rounded-full border border-secondary"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-primary">{user.name}</p>
          <p className="truncate text-xs text-tertiary">{user.email}</p>
        </div>
        <Button
          color="ghost"
          size="small"
          onClick={logout}
          aria-label="Sign out"
        >
          <Icon icon={LogOut01} className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-secondary bg-primary_hover p-3">
      <div className="mb-3 flex items-center gap-3">
        {user.avatar && (
          <img
            src={user.avatar}
            alt={user.name}
            className="size-8 rounded-full border border-secondary"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">{user.name}</p>
          <p className="truncate text-xs text-tertiary">{user.email}</p>
        </div>
      </div>
      <Button
        color="secondary"
        size="small"
        className="w-full justify-center"
        onClick={logout}
      >
        <Icon icon={LogOut01} className="size-4" />
        Sign out
      </Button>
    </div>
  );
}
