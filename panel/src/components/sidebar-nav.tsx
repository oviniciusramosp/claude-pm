// panel/src/components/sidebar-nav.tsx

import React, { useEffect, useRef, useState } from 'react';
import { AlertOctagon, Asterisk02, ChevronDown, LayersThree01, Moon01, PlayCircle, Settings01, StopCircle, Sun } from '@untitledui/icons';
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
  isEpicRunning,
  apiHealthStatus,
  busy,
  runAction,
  appError,
  apiError,
  onAppBadgeClick,
  onApiBadgeClick,
  setRuntimeSettingsModalOpen,
  disabledTabs,
  errorCount,
  onDebugClick,
  sidebarOpen,
  setSidebarOpen
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  apiRunning: boolean;
  isEpicRunning: boolean;
  apiHealthStatus: { label: string; color: string; connectionState: string };
  busy: Record<string, any>;
  runAction: (key: string, endpoint: string, successMessage: string) => void;
  appError: string | null;
  apiError: string | null;
  onAppBadgeClick: () => void;
  onApiBadgeClick: () => void;
  setRuntimeSettingsModalOpen: (open: boolean) => void;
  disabledTabs?: Set<string>;
  errorCount: number;
  onDebugClick: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}) {
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const runMenuRef = useRef(null);

  useEffect(() => {
    if (!runMenuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) {
        setRunMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [runMenuOpen]);

  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-secondary bg-primary transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <Icon icon={Asterisk02} className="size-6 shrink-0 text-brand-primary" />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-md font-semibold text-primary">PM Automation</h1>
          <p className="m-0 text-xs text-tertiary">Board + Claude Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 px-3" aria-label="Main navigation">
        {SIDEBAR_NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          const isDisabled = disabledTabs?.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              disabled={isDisabled}
              aria-current={isActive ? 'page' : undefined}
              title={isDisabled ? 'Configuration required' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition',
                isDisabled
                  ? 'cursor-not-allowed text-disabled opacity-50'
                  : isActive
                    ? 'bg-active text-secondary shadow-xs'
                    : 'text-tertiary hover:bg-primary_hover hover:text-secondary'
              )}
              onClick={() => { if (!isDisabled) setActiveTab(item.key); }}
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
      <div className="mt-4 space-y-3 px-3">
        <div className="flex items-center gap-2 px-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Controls</p>
          <div className="flex items-center gap-2">
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
            onPress={() => runAction('stopApi', '/api/process/api/stop', isEpicRunning ? 'Epic stop requested' : 'App stop requested')}
          >
            {isEpicRunning ? 'Stop Epic' : 'Stop App'}
          </Button>
        ) : (
          <div className="relative" ref={runMenuRef}>
            <div className="flex items-stretch">
              <Button
                size="sm"
                color="primary"
                className="flex-1 justify-center rounded-r-none"
                iconLeading={PlayCircle}
                isLoading={Boolean(busy.startApi)}
                onPress={() => runAction('startApi', '/api/process/api/start', 'App started')}
              >
                Start App
              </Button>
              <Button
                size="sm"
                color="primary"
                className="!h-auto rounded-l-none border-l border-l-white/20 px-2"
                onPress={() => setRunMenuOpen((prev) => !prev)}
                aria-label="Run options"
                aria-expanded={runMenuOpen}
              >
                <Icon icon={ChevronDown} className={cx('size-4 transition-transform', runMenuOpen && 'rotate-180')} />
              </Button>
            </div>

            {runMenuOpen && (
              <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-sm border border-secondary bg-primary shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-secondary transition hover:bg-primary_hover"
                  onClick={() => {
                    setRunMenuOpen(false);
                    runAction('runTask', '/api/automation/run-task', 'Single-task run requested');
                  }}
                >
                  <Icon icon={PlayCircle} className="size-4 text-fg-quaternary" />
                  <span>Run Task</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-secondary transition hover:bg-primary_hover"
                  onClick={() => {
                    setRunMenuOpen(false);
                    runAction('runEpic', '/api/automation/run-epic', 'Epic run requested');
                  }}
                >
                  <Icon icon={LayersThree01} className="size-4 text-fg-quaternary" />
                  <span>Run Epic</span>
                </button>
              </div>
            )}
          </div>
        )}

        <Button
          size="sm"
          color="tertiary"
          iconLeading={Settings01}
          className="w-full justify-center"
          onPress={() => setRuntimeSettingsModalOpen(true)}
        >
          Runtime Settings
        </Button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer */}
      <div className="px-3 pb-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-tertiary transition hover:bg-primary_hover hover:text-secondary"
          onClick={onDebugClick}
        >
          <Icon icon={AlertOctagon} className="size-5" />
          <span>Debug Errors</span>
          {errorCount > 0 ? (
            <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-utility-error-600 text-[11px] font-semibold text-white">
              {errorCount > 99 ? '99+' : errorCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="border-t border-secondary" />

      <div className="px-3 py-3">
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
