import path from 'node:path';
import { readFileSync } from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { setRuntime, resolveRuntime, getEffectiveConfig } from './runtimeConfig.js';
import { logger } from './logger.js';
import { LocalBoardClient } from './local/client.js';
import { Orchestrator } from './orchestrator.js';
import { RunStore } from './runStore.js';
import { UsageStore } from './usageStore.js';
import { syncClaudeMd } from './claudeMdManager.js';
import { BoardValidator } from './boardValidator.js';
const app = express();

app.use(express.json({ limit: '2mb' }));

// Collect startup info for consolidated log (array of {level, text})
const startupInfo = [];

// Create an effective config that transparently resolves runtime overrides
// for streamOutput, logPrompt, fullAccess, and modelOverride via Proxy.
const effectiveConfig = getEffectiveConfig(config);

const boardClient = new LocalBoardClient(effectiveConfig);
await boardClient.initialize();
startupInfo.push({ level: 'info', text: `Claude working directory: ${effectiveConfig.claude.workdir}` });
startupInfo.push({ level: 'info', text: `Board directory: ${effectiveConfig.board.dir}` });

// Validate Board structure on startup
const boardValidator = new BoardValidator(effectiveConfig);
try {
  const validationResult = await boardValidator.validate();
  if (!validationResult.valid) {
    logger.warn(`[VALIDATION_REPORT] ${boardValidator.formatForFeed(validationResult)}`);
  } else {
    startupInfo.push({ level: 'success', text: 'Board structure validated successfully' });
  }
} catch (error) {
  logger.warn(`Board validation failed: ${error.message}`);
}

const runStore = new RunStore(effectiveConfig.state.runStorePath);
const usageStore = new UsageStore(
  path.resolve(process.cwd(), process.env.USAGE_STORE_PATH || '.data/usage.json')
);
const orchestrator = new Orchestrator({
  config: effectiveConfig,
  logger,
  boardClient,
  runStore,
  usageStore
});

if (effectiveConfig.claude.injectClaudeMd) {
  try {
    const result = await syncClaudeMd(effectiveConfig, logger);
    if (result?.action === 'unchanged') {
      startupInfo.push({ level: 'info', text: 'CLAUDE.md managed section is already up to date' });
    } else if (result?.action === 'updated') {
      startupInfo.push({ level: 'success', text: 'CLAUDE.md managed section updated' });
    } else if (result?.action === 'created') {
      startupInfo.push({ level: 'success', text: 'CLAUDE.md managed section created' });
    } else if (result?.action === 'appended') {
      startupInfo.push({ level: 'success', text: 'CLAUDE.md managed section appended' });
    }
  } catch (error) {
    logger.warn(`Failed to sync CLAUDE.md in target project: ${error.message}`);
  }
}

function extractHeaderValue(req, headerName) {
  const header = req.headers[headerName];

  if (Array.isArray(header)) {
    return header[0] || '';
  }

  return header || '';
}

function checkManualToken(req, res) {
  if (!effectiveConfig.manualRun.token) {
    return true;
  }

  const auth = extractHeaderValue(req, 'authorization');
  const expected = `Bearer ${effectiveConfig.manualRun.token}`;
  if (auth !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

function parseBooleanValue(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    orchestrator: orchestrator.isRunning()
  });
});

app.post('/run', async (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  logger.info('Manual reconciliation requested');
  orchestrator.schedule('manual');
  res.status(202).json({ accepted: true, message: 'Reconciliation queued' });
});

app.post('/run-task', async (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  logger.info('Manual single-task run requested');
  orchestrator.schedule('manual_task', { mode: 'task' });
  res.status(202).json({ accepted: true, message: 'Single-task run queued' });
});

app.post('/run-epic', async (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  logger.info('Manual epic reconciliation requested');
  orchestrator.schedule('manual_epic', { mode: 'epic' });
  res.status(202).json({ accepted: true, message: 'Epic reconciliation queued' });
});

app.post('/resume', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  const resumed = orchestrator.resume();
  if (!resumed) {
    res.status(409).json({ ok: false, message: 'Orchestrator is not halted' });
    return;
  }

  logger.info('Orchestrator resumed via API');
  orchestrator.schedule('manual_resume');
  res.json({ ok: true, message: 'Orchestrator resumed' });
});

app.post('/pause', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  const paused = orchestrator.pause();
  if (!paused) {
    res.status(409).json({ ok: false, message: 'Orchestrator is already paused' });
    return;
  }

  res.json({ ok: true, message: 'Orchestrator paused' });
});

app.post('/unpause', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  const unpaused = orchestrator.unpause();
  if (!unpaused) {
    res.status(409).json({ ok: false, message: 'Orchestrator is already running' });
    return;
  }

  res.json({ ok: true, message: 'Orchestrator activated. Checking for tasks to execute...' });
});

app.get('/settings/runtime', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  res.json({
    claude: {
      streamOutput: Boolean(effectiveConfig.claude.streamOutput),
      logPrompt: Boolean(effectiveConfig.claude.logPrompt),
      modelOverride: effectiveConfig.claude.modelOverride || ''
    }
  });
});

app.post('/settings/runtime', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  const claude = req.body?.claude || {};

  setRuntime('streamOutput', parseBooleanValue(claude.streamOutput, effectiveConfig.claude.streamOutput));
  setRuntime('logPrompt', parseBooleanValue(claude.logPrompt, effectiveConfig.claude.logPrompt));

  if (typeof claude.modelOverride === 'string') {
    setRuntime('modelOverride', claude.modelOverride);
  }

  logger.info(
    `Runtime settings updated (streamOutput=${effectiveConfig.claude.streamOutput}, logPrompt=${effectiveConfig.claude.logPrompt}, modelOverride=${effectiveConfig.claude.modelOverride || 'auto'})`
  );

  res.json({
    ok: true,
    claude: {
      streamOutput: Boolean(effectiveConfig.claude.streamOutput),
      logPrompt: Boolean(effectiveConfig.claude.logPrompt),
      modelOverride: effectiveConfig.claude.modelOverride || ''
    }
  });
});

app.get('/usage/weekly', async (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  try {
    const summary = await usageStore.getWeeklySummary();

    res.json({
      ok: true,
      weekKey: summary.weekKey,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheCreationInputTokens: summary.cacheCreationInputTokens,
      cacheReadInputTokens: summary.cacheReadInputTokens,
      totalTokens: summary.totalTokens,
      totalCostUsd: summary.totalCostUsd,
      taskCount: summary.taskCount,
      tasks: summary.tasks
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/validate-board', async (req, res) => {
  try {
    const validator = new BoardValidator(effectiveConfig);
    const result = await validator.validate();

    res.json({
      ok: result.valid,
      ...result
    });
  } catch (error) {
    logger.error(`Board validation error: ${error.message}`);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/sync-claude-md', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  syncClaudeMd(effectiveConfig, logger)
    .then((result) => {
      res.json({ ok: true, ...result });
    })
    .catch((error) => {
      logger.error(`Manual CLAUDE.md sync failed: ${error.message}`);
      res.status(500).json({ ok: false, message: error.message });
    });
});

app.use((error, _req, res, _next) => {
  logger.error(`Unhandled HTTP error: ${error.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

orchestrator.on('shutdown-requested', ({ reason, epic }) => {
  logger.info(`Graceful shutdown requested: ${reason}${epic ? ` (${epic})` : ''}`);
  server.close(() => {
    logger.info('Server closed. Exiting.');
    process.exit(0);
  });
});

const server = app.listen(effectiveConfig.server.port, () => {
  // Add reconciliation info to startup
  if (effectiveConfig.queue.pollIntervalMs > 0) {
    const minutes = Math.floor(effectiveConfig.queue.pollIntervalMs / 60000);
    const seconds = Math.floor((effectiveConfig.queue.pollIntervalMs % 60000) / 1000);
    const timeStr = minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''}` : `${seconds} second${seconds > 1 ? 's' : ''}`;
    startupInfo.push({ level: 'info', text: `Automatic reconciliation enabled every ${timeStr}` });
  }

  // Send consolidated startup message as progressive log
  const summary = 'API started successfully';

  // Store details as JSON array for frontend to render with icons
  const expandableDetails = startupInfo;

  // Use timestamp-based groupId to ensure each startup message is unique
  const startupGroupId = `app-startup-${Date.now()}`;

  logger.progressive(
    'success',
    startupGroupId,
    'complete',
    summary,
    { detailsType: 'startup' }, // Flag to indicate this is startup details with levels
    expandableDetails,
    true // feedEnabled: show in Feed
  );

  // Trigger startup reconciliation if enabled
  if (effectiveConfig.queue.runOnStartup) {
    orchestrator.schedule('startup');
  }

  // Setup periodic reconciliation if enabled
  if (effectiveConfig.queue.pollIntervalMs > 0) {
    const pollTimer = setInterval(() => {
      orchestrator.schedule('poll_interval');
    }, effectiveConfig.queue.pollIntervalMs);

    if (typeof pollTimer.unref === 'function') {
      pollTimer.unref();
    }
  }
});
