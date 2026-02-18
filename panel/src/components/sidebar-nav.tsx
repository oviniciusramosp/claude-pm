// panel/src/components/sidebar-nav.tsx

import React, { useEffect, useRef, useState } from 'react';
import { AlertOctagon, Asterisk02, ChevronDown, LayersThree01, Moon01, PauseCircle, PlayCircle, Settings01, StopCircle, Sun } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from './base/tooltip/tooltip';
import { cx } from '@/utils/cx';
import { SIDEBAR_NAV_ITEMS } from '../constants';
import { Icon } from './icon';
import { StatusBadge } from './status-badge';
import { AccessMenu } from './access-menu';
import { UserMenu } from './user-menu';

export function SidebarNav({
  activeTab,
  setActiveTab,
  isDark,
  onThemeToggle,
  apiRunning,
  isPaused,
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
  unreadFeedCount,
  onDebugClick,
  sidebarOpen,
  setSidebarOpen,
  serverInfo
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  apiRunning: boolean;
  isPaused: boolean;
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
  unreadFeedCount: number;
  onDebugClick: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  serverInfo?: any;
}) {
  const [workMenuOpen, setWorkMenuOpen] = useState(false);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const workMenuRef = useRef(null);

  useEffect(() => {
    if (!workMenuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (workMenuRef.current && !workMenuRef.current.contains(e.target as Node)) {
        setWorkMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [workMenuOpen]);

  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-secondary bg-primary transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0'
      )}
    >
      {/* Header — clickable for access menu */}
      <div className="relative px-3 pb-4 pt-5">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-primary_hover"
          onClick={() => setAccessMenuOpen((prev) => !prev)}
          aria-expanded={accessMenuOpen}
          aria-label="Show access QR code"
        >
          <Icon icon={Asterisk02} className="size-6 shrink-0 text-brand-primary" />
          <div className="min-w-0 text-left">
            <h1 className="m-0 truncate text-md font-semibold text-primary">PM Automation</h1>
            <p className="m-0 text-xs text-tertiary">Board + Claude Panel</p>
          </div>
          <Icon icon={ChevronDown} className={cx('ml-auto size-4 shrink-0 text-quaternary transition-transform', accessMenuOpen && 'rotate-180')} />
        </button>
        <AccessMenu open={accessMenuOpen} onClose={() => setAccessMenuOpen(false)} />
      </div>

      {/* Navigation */}
      <nav className="space-y-1 px-3" aria-label="Main navigation">
        {SIDEBAR_NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          const isDisabled = disabledTabs?.has(item.key);
          const isFeedTab = item.key === 'feed';
          const showBadge = isFeedTab && unreadFeedCount > 0;
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
              {showBadge ? (
                <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-brand-solid text-[11px] font-bold text-white">
                  {unreadFeedCount > 99 ? '99+' : unreadFeedCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-4 mt-5 border-t border-secondary" />

      {/* Controls */}
      <div className="mt-4 space-y-3 px-3">
        <div className="flex items-center justify-between gap-2 px-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Controls</p>
          <div className="flex items-center gap-2">
            <Tooltip
              title={appError ? "App Error" : apiRunning ? "App Running" : "App Stopped"}
              description={appError ? "Click to view error details" : apiRunning ? "Automation is connected and operational" : "Automation is not running"}
            >
              <TooltipTrigger className={appError ? "cursor-pointer" : "cursor-default"}>
                <StatusBadge
                  color={appError ? 'error' : apiRunning ? 'success' : 'gray'}
                  connectionState={apiRunning ? 'active' : 'inactive'}
                  onClick={appError ? onAppBadgeClick : undefined}
                >
                  App
                </StatusBadge>
              </TooltipTrigger>
            </Tooltip>
            <Tooltip
              title={apiError ? "API Error" : apiHealthStatus.connectionState === 'active' ? "API Connected" : "API Disconnected"}
              description={apiError ? "Click to view error details" : apiHealthStatus.connectionState === 'active' ? "API is healthy and responding" : "API is not responding"}
            >
              <TooltipTrigger className={apiError ? "cursor-pointer" : "cursor-default"}>
                <StatusBadge
                  color={apiError ? 'error' : apiHealthStatus.connectionState === 'active' ? 'success' : 'gray'}
                  connectionState={apiHealthStatus.connectionState === 'active' ? 'active' : 'inactive'}
                  onClick={apiError ? onApiBadgeClick : undefined}
                >
                  API
                </StatusBadge>
              </TooltipTrigger>
            </Tooltip>
          </div>
        </div>

        {apiRunning ? (
          <Button
            size="sm"
            color="secondary-destructive"
            className="w-full justify-center"
            iconLeading={StopCircle}
            isLoading={Boolean(busy.stopApi)}
            onPress={() => runAction('stopApi', '/api/process/api/stop', isEpicRunning ? 'Epic stop requested' : 'API stopped')}
          >
            Stop API
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            className="w-full justify-center"
            iconLeading={PlayCircle}
            isLoading={Boolean(busy.startApi)}
            onPress={() => runAction('startApi', '/api/process/api/start', 'API started')}
          >
            Start API
          </Button>
        )}

        {apiRunning && (
          isPaused ? (
            <div className="relative" ref={workMenuRef}>
              <div className="flex items-stretch">
                <Button
                  size="sm"
                  color="primary"
                  className="flex-1 justify-center rounded-r-none"
                  iconLeading={PlayCircle}
                  isLoading={Boolean(busy.unpause)}
                  onPress={() => runAction('unpause', '/api/automation/unpause', 'Working resumed')}
                >
                  Start Working
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  className="!h-auto rounded-l-none border-l border-l-white/20 px-2"
                  onPress={() => setWorkMenuOpen((prev) => !prev)}
                  aria-label="Run options"
                  aria-expanded={workMenuOpen}
                >
                  <Icon icon={ChevronDown} className={cx('size-4 transition-transform', workMenuOpen && 'rotate-180')} />
                </Button>
              </div>

              {workMenuOpen && (
                <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-sm border border-secondary bg-primary shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-secondary transition hover:bg-primary_hover"
                    onClick={() => {
                      setWorkMenuOpen(false);
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
                      setWorkMenuOpen(false);
                      runAction('runEpic', '/api/automation/run-epic', 'Epic run requested');
                    }}
                  >
                    <Icon icon={LayersThree01} className="size-4 text-fg-quaternary" />
                    <span>Run Epic</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Button
              size="sm"
              color="secondary"
              iconLeading={PauseCircle}
              className="w-full justify-center"
              isLoading={Boolean(busy.pause)}
              onPress={() => runAction('pause', '/api/automation/pause', 'Working paused')}
            >
              Stop Working
            </Button>
          )
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
            <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-brand-solid text-[11px] font-bold text-white">
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

        {serverInfo?.authEnabled && <UserMenu compact />}
      </div>
    </aside>
  );
}
