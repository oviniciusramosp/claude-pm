import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './theme.css';

const THEME_MODE_STORAGE_KEY = 'pm-panel-theme-mode';

function getOsPreference() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveEffectiveMode(themeMode) {
  return themeMode === 'system' ? getOsPreference() : themeMode;
}

function resolveInitialMode() {
  const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyEffectiveMode(effective) {
  document.documentElement.classList.remove('light-mode', 'dark-mode');
  document.documentElement.classList.add(effective === 'dark' ? 'dark-mode' : 'light-mode');
  document.documentElement.style.colorScheme = effective;
}

function PanelRoot() {
  const [themeMode, setThemeMode] = useState(resolveInitialMode);
  const [effectiveMode, setEffectiveMode] = useState(() => resolveEffectiveMode(resolveInitialMode()));

  useEffect(() => {
    const effective = resolveEffectiveMode(themeMode);
    setEffectiveMode(effective);
    applyEffectiveMode(effective);
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  }, [themeMode]);

  // Re-apply when OS preference changes while in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const effective = mq.matches ? 'dark' : 'light';
      setEffectiveMode(effective);
      applyEffectiveMode(effective);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  return (
    <App mode={effectiveMode} themeMode={themeMode} setThemeMode={setThemeMode} />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PanelRoot />
  </React.StrictMode>
);
