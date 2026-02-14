// panel/src/components/sidebar-nav.tsx

import { Asterisk02, Flash, Moon01, PlayCircle, Settings01, StopCircle, Sun } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { cx } from '@/utils/cx';
import { SIDEBAR_NAV_ITEMS } from '../constants';
import { Icon } from './icon';
import { StatusBadge } from './status-badge';

export function SidebarNav({
  activeTab,
  setActiveTab,
  isDark,
  onThemeToggle,
  apiRunning,
  apiHealthStatus,
  busy,
  runAction,
  appError,
  apiError,
  onAppBadgeClick,
  onApiBadgeClick,
  setRuntimeSettingsModalOpen,
  sidebarOpen,
  setSidebarOpen
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  apiRunning: boolean;
  apiHealthStatus: { label: string; color: string; connectionState: string };
  busy: Record<string, any>;
  runAction: (key: string, endpoint: string, successMessage: string) => void;
  appError: string | null;
  apiError: string | null;
  onAppBadgeClick: () => void;
  onApiBadgeClick: () => void;
  setRuntimeSettingsModalOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}) {
  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-secondary bg-primary transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Icon icon={Asterisk02} className="size-6 shrink-0 text-brand-primary" />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-md font-semibold text-primary">PM Automation</h1>
          <p className="m-0 text-xs text-tertiary">Notion + Claude Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 px-3" aria-label="Main navigation">
        {SIDEBAR_NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-active text-secondary shadow-xs'
                  : 'text-tertiary hover:bg-primary_hover hover:text-secondary'
              )}
              onClick={() => setActiveTab(item.key)}
            >
              <Icon icon={item.icon} className="size-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-4 mt-5 border-t border-secondary" />

      {/* Controls */}
      <div className="mt-4 space-y-2.5 px-3">
        <div className="flex items-center gap-2 px-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Controls</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge
              color={appError ? 'error' : apiRunning ? 'success' : 'gray'}
              connectionState={apiRunning ? 'active' : 'inactive'}
              onClick={appError ? onAppBadgeClick : undefined}
            >
              App
            </StatusBadge>
            <StatusBadge
              color={apiError ? 'error' : apiHealthStatus.connectionState === 'active' ? 'success' : 'gray'}
              connectionState={apiHealthStatus.connectionState === 'active' ? 'active' : 'inactive'}
              onClick={apiError ? onApiBadgeClick : undefined}
            >
              API
            </StatusBadge>
          </div>
        </div>

        {apiRunning ? (
          <Button
            size="sm"
            color="secondary-destructive"
            className="w-full justify-center"
            iconLeading={StopCircle}
            isLoading={Boolean(busy.stopApi)}
            onPress={() => runAction('stopApi', '/api/process/api/stop', 'App stop requested')}
          >
            Stop App
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            className="w-full justify-center"
            iconLeading={PlayCircle}
            isLoading={Boolean(busy.startApi)}
            onPress={() => runAction('startApi', '/api/process/api/start', 'App started')}
          >
            Start App
          </Button>
        )}

        <Button
          size="sm"
          color="secondary"
          iconLeading={Flash}
          className="w-full justify-center"
          isLoading={Boolean(busy.runNow)}
          onPress={() => runAction('runNow', '/api/automation/run', 'Manual run requested')}
        >
          Run Queue
        </Button>

        <Button
          size="sm"
          color="secondary"
          iconLeading={Settings01}
          className="w-full justify-center"
          onPress={() => setRuntimeSettingsModalOpen(true)}
        >
          Runtime Settings
        </Button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer — Theme Toggle */}
      <div className="border-t border-secondary px-3 py-4">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-tertiary transition hover:bg-primary_hover hover:text-secondary"
          onClick={onThemeToggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <Icon icon={isDark ? Sun : Moon01} className="size-5" />
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>
    </aside>
  );
}
