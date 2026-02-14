// panel/src/utils/config-helpers.ts

import { TEXT_FIELD_KEYS, TOGGLE_KEYS } from '../constants';
import type { ValidationResult } from '../types';

export function envToBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function boolToEnv(value: boolean): string {
  return value ? 'true' : 'false';
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDatabaseId(value: string): string {
  return normalizeText(value).replace(/-/g, '');
}

export function buildInitialConfig(): Record<string, string | boolean> {
  return {
    NOTION_API_TOKEN: '',
    NOTION_DATABASE_ID: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    CLAUDE_WORKDIR: '.',
    CLAUDE_FULL_ACCESS: true,
    CLAUDE_STREAM_OUTPUT: true,
    CLAUDE_LOG_PROMPT: true,
    OPUS_REVIEW_ENABLED: false
  };
}

export function parseConfigPayload(values: Record<string, unknown> = {}): Record<string, string | boolean> {
  const next = buildInitialConfig();

  for (const key of TEXT_FIELD_KEYS) {
    next[key] = values[key] || next[key] || '';
  }

  for (const key of TOGGLE_KEYS) {
    next[key] = envToBool(values[key], next[key] as boolean);
  }

  return next;
}

export function parseRuntimeSettingsPayload(payload: Record<string, unknown> = {}): { streamOutput: boolean; logPrompt: boolean } {
  const claude = (payload.claude as Record<string, unknown>) || {};

  return {
    streamOutput: Boolean(claude.streamOutput),
    logPrompt: Boolean(claude.logPrompt)
  };
}

export function isSameConfigValue(key: string, a: unknown, b: unknown): boolean {
  if (TOGGLE_KEYS.includes(key)) {
    return Boolean(a) === Boolean(b);
  }

  return normalizeText(a) === normalizeText(b);
}

export function isSetupConfigurationComplete(values: Record<string, unknown> = {}): boolean {
  return !TEXT_FIELD_KEYS.some((key) => validateFieldValue(key, values[key]).level === 'error');
}

export function validateFieldValue(key: string, rawValue: unknown): ValidationResult {
  const value = normalizeText(rawValue);

  if (key === 'NOTION_API_TOKEN') {
    if (!value) {
      return { level: 'error', message: 'Required. This token is needed to call the Notion API.' };
    }

    if (value.length < 20) {
      return { level: 'warning', message: 'Token looks too short. Please verify it.' };
    }

    if (!value.startsWith('ntn_') && !value.startsWith('secret_')) {
      return { level: 'warning', message: 'Notion tokens usually start with ntn_ or secret_.' };
    }

    return { level: 'success', message: 'Token format looks valid.' };
  }

  if (key === 'NOTION_DATABASE_ID') {
    if (!value) {
      return { level: 'error', message: 'Required. This identifies your Notion database.' };
    }

    const compact = normalizeDatabaseId(value);
    if (!/^[a-f0-9]{32}$/i.test(compact)) {
      return {
        level: 'error',
        message: 'Use a 32-character database ID (hex), with or without hyphens.'
      };
    }

    return { level: 'success', message: 'Database ID format looks valid.' };
  }

  if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
    if (!value) {
      return {
        level: 'warning',
        message: 'Recommended for non-interactive execution.'
      };
    }

    if (value.length < 20) {
      return { level: 'warning', message: 'Token looks too short. Please verify it.' };
    }

    if (!value.startsWith('sk-ant-')) {
      return { level: 'warning', message: 'Claude tokens usually start with sk-ant-.' };
    }

    return { level: 'success', message: 'Token format looks valid.' };
  }

  if (key === 'CLAUDE_WORKDIR') {
    if (!value) {
      return { level: 'error', message: 'Required. Choose the folder Claude should use.' };
    }

    if (value.includes('\n')) {
      return { level: 'error', message: 'Path cannot contain line breaks.' };
    }

    return { level: 'success', message: 'Working directory looks valid.' };
  }

  return { level: 'neutral', message: '' };
}

export function buildNotionDatabaseUrl(databaseId: string): string {
  const compact = normalizeDatabaseId(databaseId);
  if (!/^[a-f0-9]{32}$/i.test(compact)) {
    return '';
  }

  return `https://www.notion.so/${compact}`;
}

export function resolveApiBaseUrl(): string {
  const configured = normalizeText(import.meta.env.VITE_PANEL_API_BASE_URL);
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  return '';
}
