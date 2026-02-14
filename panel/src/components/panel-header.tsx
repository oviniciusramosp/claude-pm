// panel/src/components/panel-header.tsx

import type { FC } from 'react';
import { Asterisk02, Moon01, Settings01, Sun, Toggle01Right } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { NAV_TAB_KEYS } from '../constants';
import { Icon } from './icon';

export function PanelHeader({
  activeTab,
  setActiveTab,
  isDark,
  onThemeToggle
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  onThemeToggle: () => void;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-secondary bg-primary/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-primary">
            <Icon icon={Asterisk02} className="size-5" />
            PM Automation Panel
          </h1>
          <p className="m-0 max-w-2xl text-xs leading-4 text-tertiary">
            Configure, run and monitor your Notion + Claude automation from one panel.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            role="tablist"
            aria-label="Panel sections"
            className="inline-flex items-center rounded-lg border border-secondary bg-secondary p-1"
          >
            <Button
              size="sm"
              color={activeTab === NAV_TAB_KEYS.setup ? 'primary' : 'secondary'}
              className="h-9"
              iconLeading={Settings01}
              aria-pressed={activeTab === NAV_TAB_KEYS.setup}
              onPress={() => setActiveTab(NAV_TAB_KEYS.setup)}
            >
              Setup
            </Button>
            <Button
              size="sm"
              color={activeTab === NAV_TAB_KEYS.operations ? 'primary' : 'secondary'}
              className="h-9"
              iconLeading={Toggle01Right}
              aria-pressed={activeTab === NAV_TAB_KEYS.operations}
              onPress={() => setActiveTab(NAV_TAB_KEYS.operations)}
            >
              Operations & Feed
            </Button>
          </div>

          <Button
            size="md"
            color="secondary"
            iconLeading={isDark ? Sun : Moon01}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onPress={onThemeToggle}
          />
        </div>
      </div>
    </header>
  );
}
