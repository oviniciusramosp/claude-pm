import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
const FIXED_CLAUDE_COMMAND = '/opt/homebrew/bin/claude --print';

function required(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
  return value;
}

function number(name, fallback) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Variavel ${name} precisa ser numerica.`);
  }

  return parsed;
}

function boolean(name, fallback) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  server: {
    port: number('PORT', 3000)
  },
  notion: {
    token: required('NOTION_API_TOKEN'),
    databaseId: required('NOTION_DATABASE_ID'),
    version: process.env.NOTION_VERSION || '2022-06-28',
    properties: {
      name: process.env.NOTION_PROP_NAME || 'Name',
      status: process.env.NOTION_PROP_STATUS || 'Status',
      agent: process.env.NOTION_PROP_AGENT || 'Agent',
      priority: process.env.NOTION_PROP_PRIORITY || 'Priority',
      type: process.env.NOTION_PROP_TYPE || 'Type',
      parentItem: process.env.NOTION_PROP_PARENT_ITEM || process.env.NOTION_PROP_EPIC || 'Parent item',
      model: process.env.NOTION_PROP_MODEL || 'Model'
    },
    statuses: {
      notStarted: process.env.NOTION_STATUS_NOT_STARTED || 'Not Started',
      inProgress: process.env.NOTION_STATUS_IN_PROGRESS || 'In Progress',
      done: process.env.NOTION_STATUS_DONE || 'Done'
    },
    typeValues: {
      epic: process.env.NOTION_TYPE_EPIC || 'Epic'
    }
  },
  queue: {
    debounceMs: number('QUEUE_DEBOUNCE_MS', 1500),
    maxTasksPerRun: number('MAX_TASKS_PER_RUN', 50),
    order: process.env.QUEUE_ORDER || 'alphabetical',
    runOnStartup: boolean('QUEUE_RUN_ON_STARTUP', true),
    pollIntervalMs: number('QUEUE_POLL_INTERVAL_MS', 60 * 1000)
  },
  claude: {
    command: FIXED_CLAUDE_COMMAND,
    timeoutMs: number('CLAUDE_TIMEOUT_MS', 75 * 60 * 1000),
    extraPrompt: process.env.CLAUDE_EXTRA_PROMPT || '',
    oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
    workdir: path.resolve(process.cwd(), process.env.CLAUDE_WORKDIR || '.'),
    streamOutput: boolean('CLAUDE_STREAM_OUTPUT', false),
    logPrompt: boolean('CLAUDE_LOG_PROMPT', true),
    fullAccess: boolean('CLAUDE_FULL_ACCESS', false),
    opusReviewEnabled: boolean('OPUS_REVIEW_ENABLED', false),
    epicReviewEnabled: boolean('EPIC_REVIEW_ENABLED', false),
    forceTestCreation: boolean('FORCE_TEST_CREATION', false),
    forceTestRun: boolean('FORCE_TEST_RUN', false),
    forceCommit: boolean('FORCE_COMMIT', false)
  },
  state: {
    runStorePath: path.resolve(process.cwd(), process.env.RUN_STORE_PATH || '.data/runs.json'),
    autoResetFailedTask: boolean('AUTO_RESET_FAILED_TASK', false)
  },
  watchdog: {
    enabled: boolean('WATCHDOG_ENABLED', true),
    intervalMs: number('WATCHDOG_INTERVAL_MS', 20 * 60 * 1000),
    maxWarnings: number('WATCHDOG_MAX_WARNINGS', 3),
    maxConsecutiveFailures: number('WATCHDOG_MAX_CONSECUTIVE_FAILURES', 3)
  },
  manualRun: {
    token: process.env.MANUAL_RUN_TOKEN || ''
  }
};
