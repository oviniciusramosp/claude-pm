import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
const DEFAULT_CLAUDE_COMMAND = 'claude --print';

function number(name, fallback) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be numeric.`);
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

// Resolve CLAUDE_WORKDIR first, then use it as base for BOARD_DIR
const claudeWorkdir = path.resolve(process.cwd(), process.env.CLAUDE_WORKDIR || '.');
const boardDir = process.env.BOARD_DIR
  ? (path.isAbsolute(process.env.BOARD_DIR)
    ? process.env.BOARD_DIR
    : path.resolve(claudeWorkdir, process.env.BOARD_DIR))
  : path.resolve(claudeWorkdir, 'Board');

export const config = {
  server: {
    port: number('PORT', 3000)
  },
  board: {
    dir: boardDir,
    statuses: {
      notStarted: process.env.BOARD_STATUS_NOT_STARTED || 'Not Started',
      inProgress: process.env.BOARD_STATUS_IN_PROGRESS || 'In Progress',
      done: process.env.BOARD_STATUS_DONE || 'Done'
    },
    typeValues: {
      epic: process.env.BOARD_TYPE_EPIC || 'Epic'
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
    command: process.env.CLAUDE_COMMAND || DEFAULT_CLAUDE_COMMAND,
    timeoutMs: number('CLAUDE_TIMEOUT_MS', 75 * 60 * 1000),
    extraPrompt: process.env.CLAUDE_EXTRA_PROMPT || '',
    oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
    workdir: claudeWorkdir,
    streamOutput: boolean('CLAUDE_STREAM_OUTPUT', false),
    logPrompt: boolean('CLAUDE_LOG_PROMPT', true),
    fullAccess: boolean('CLAUDE_FULL_ACCESS', false),
    modelOverride: process.env.CLAUDE_MODEL_OVERRIDE || '',
    opusReviewEnabled: boolean('OPUS_REVIEW_ENABLED', false),
    epicReviewEnabled: boolean('EPIC_REVIEW_ENABLED', false),
    forceTestCreation: boolean('FORCE_TEST_CREATION', false),
    forceTestRun: boolean('FORCE_TEST_RUN', false),
    forceCommit: boolean('FORCE_COMMIT', false),
    injectClaudeMd: boolean('INJECT_CLAUDE_MD', true)
  },
  state: {
    runStorePath: path.resolve(process.cwd(), process.env.RUN_STORE_PATH || '.data/runs.json'),
    autoResetFailedTask: boolean('AUTO_RESET_FAILED_TASK', false)
  },
  watchdog: {
    enabled: boolean('WATCHDOG_ENABLED', true),
    intervalMs: number('WATCHDOG_INTERVAL_MS', 20 * 60 * 1000),
    maxWarnings: number('WATCHDOG_MAX_WARNINGS', 3),
    maxConsecutiveFailures: number('WATCHDOG_MAX_CONSECUTIVE_FAILURES', 3),
    maxGlobalConsecutiveFailures: number('GLOBAL_MAX_CONSECUTIVE_FAILURES', 5)
  },
  autoRecovery: {
    enabled: boolean('AUTO_RECOVERY_ENABLED', true),
    maxRetries: number('AUTO_RECOVERY_MAX_RETRIES', 2),
    timeoutMs: number('AUTO_RECOVERY_TIMEOUT_MS', 5 * 60 * 1000),
    model: process.env.AUTO_RECOVERY_MODEL || 'auto'
  },
  manualRun: {
    token: process.env.MANUAL_RUN_TOKEN || ''
  }
};
