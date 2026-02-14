import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './theme.css';

const THEME_MODE_STORAGE_KEY = 'pm-panel-theme-mode';

function resolveInitialMode() {
  const storedMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (storedMode === 'light' || storedMode === 'dark') {
    return storedMode;
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

function PanelRoot() {
  const [mode, setMode] = useState(resolveInitialMode);

  useEffect(() => {
    document.documentElement.classList.remove('light-mode', 'dark-mode');
    document.documentElement.classList.add(mode === 'dark' ? 'dark-mode' : 'light-mode');
    document.documentElement.style.colorScheme = mode;
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  }, [mode]);

  return (
    <App mode={mode} setMode={setMode} />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PanelRoot />
  </React.StrictMode>
);
