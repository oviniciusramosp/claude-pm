// panel/src/hooks/useNotifications.ts

import { useState, useCallback, useRef } from 'react';
import type { LogEntry } from '../types';

export interface NotificationSettings {
  browserEnabled: boolean;
  audioEnabled: boolean;
  notifyTaskDone: boolean;
  notifyEpicDone: boolean;
  notifyError: boolean;
  volume: number;
}

const STORAGE_KEY = 'pm_notification_settings';

const DEFAULT_SETTINGS: NotificationSettings = {
  browserEnabled: false,
  audioEnabled: true,
  notifyTaskDone: true,
  notifyEpicDone: true,
  notifyError: true,
  volume: 0.5,
};

function loadSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useNotifications() {
  const [settings, setSettings] = useState<NotificationSettings>(loadSettings);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const audioCtxRef = useRef<AudioContext | null>(null);

  const updateSettings = useCallback((updates: Partial<NotificationSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const requestBrowserPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof Notification === 'undefined') return 'denied';
    try {
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission !== 'granted') updateSettings({ browserEnabled: false });
      return permission;
    } catch {
      return 'denied';
    }
  }, [updateSettings]);

  const getAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return null;
        audioCtxRef.current = new Ctx();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const playTones = useCallback(
    (tones: { freq: number; duration: number; delay: number }[], volume: number) => {
      const ctx = getAudioCtx();
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(master);
          osc.type = 'sine';
          osc.frequency.value = tone.freq;
          const t0 = ctx.currentTime + tone.delay;
          const t1 = t0 + tone.duration;
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(0.8, t0 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, t1);
          osc.start(t0);
          osc.stop(t1);
        }
      } catch { /* ignore */ }
    },
    [getAudioCtx]
  );

  // C5 → E5 → G5 ascending chime
  const soundTaskDone = useCallback((vol: number) => {
    playTones([
      { freq: 523.25, duration: 0.25, delay: 0 },
      { freq: 659.25, duration: 0.25, delay: 0.18 },
      { freq: 783.99, duration: 0.45, delay: 0.36 },
    ], vol);
  }, [playTones]);

  // C5 → E5 → G5 → C6 fanfare
  const soundEpicDone = useCallback((vol: number) => {
    playTones([
      { freq: 523.25, duration: 0.18, delay: 0 },
      { freq: 659.25, duration: 0.18, delay: 0.15 },
      { freq: 783.99, duration: 0.18, delay: 0.30 },
      { freq: 1046.50, duration: 0.60, delay: 0.45 },
    ], vol);
  }, [playTones]);

  // G4 → E4 → C4 descending buzz
  const soundError = useCallback((vol: number) => {
    playTones([
      { freq: 392.00, duration: 0.25, delay: 0 },
      { freq: 329.63, duration: 0.25, delay: 0.18 },
      { freq: 261.63, duration: 0.45, delay: 0.36 },
    ], vol);
  }, [playTones]);

  const showBrowserNotification = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, silent: true });
      setTimeout(() => n.close(), 6000);
    } catch { /* ignore */ }
  }, []);

  const handleLogEntry = useCallback(
    (entry: LogEntry) => {
      const msg = String(entry.message || '');
      const level = String(entry.level || '');
      const vol = settings.volume;

      if (settings.notifyTaskDone && msg.startsWith('Moved to Done:')) {
        if (settings.audioEnabled) soundTaskDone(vol);
        if (settings.browserEnabled) {
          const name = msg.replace(/^Moved to Done:\s*"?/, '').replace(/"$/, '');
          showBrowserNotification('Task Completed', name);
        }
        return;
      }

      if (settings.notifyEpicDone && msg.startsWith('Epic moved to Done')) {
        if (settings.audioEnabled) soundEpicDone(vol);
        if (settings.browserEnabled) {
          const name = msg.replace(/^Epic moved to Done[:\s]*"?/, '').replace(/"$/, '') || 'Epic completed';
          showBrowserNotification('Epic Completed', name);
        }
        return;
      }

      if (settings.notifyError && level === 'error') {
        if (settings.audioEnabled) soundError(vol);
        if (settings.browserEnabled) showBrowserNotification('Error', msg.slice(0, 120));
      }
    },
    [settings, soundTaskDone, soundEpicDone, soundError, showBrowserNotification]
  );

  return {
    settings,
    updateSettings,
    browserPermission,
    requestBrowserPermission,
    handleLogEntry,
    previewTaskDone: () => soundTaskDone(settings.volume),
    previewEpicDone: () => soundEpicDone(settings.volume),
    previewError: () => soundError(settings.volume),
  };
}
