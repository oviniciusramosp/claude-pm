import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { LocalBoardClient } from './local/client.js';
import { Orchestrator } from './orchestrator.js';
import { RunStore } from './runStore.js';
import { UsageStore } from './usageStore.js';
import { syncClaudeMd } from './claudeMdManager.js';
import { BoardValidator } from './boardValidator.js';
const app = express();

app.use(express.json({ limit: '2mb' }));

const boardClient = new LocalBoardClient(config);
await boardClient.initialize();
logger.info(`Board directory: ${config.board.dir}`);
logger.info(`Claude working directory: ${config.claude.workdir}`);

// Validate Board structure on startup
const boardValidator = new BoardValidator(config);
try {
  const validationResult = await boardValidator.validate();
  if (!validationResult.valid) {
    logger.warn('Board structure validation failed:');
    logger.warn(boardValidator.formatSummary(validationResult));
  } else {
    logger.success('Board structure validated successfully');
  }
} catch (error) {
  logger.warn(`Board validation failed: ${error.message}`);
}

const runStore = new RunStore(config.state.runStorePath);
const usageStore = new UsageStore(
  path.resolve(process.cwd(), process.env.USAGE_STORE_PATH || '.data/usage.json')
);
const orchestrator = new Orchestrator({
  config,
  logger,
  boardClient,
  runStore,
  usageStore
});

if (config.claude.injectClaudeMd) {
  try {
    await syncClaudeMd(config, logger);
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
  if (!config.manualRun.token) {
    return true;
  }

  const auth = extractHeaderValue(req, 'authorization');
  const expected = `Bearer ${config.manualRun.token}`;
  if (auth !== expected) {
    res.status(401).json({ error: 'Nao autorizado' });
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

app.get('/settings/runtime', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  res.json({
    claude: {
      streamOutput: Boolean(config.claude.streamOutput),
      logPrompt: Boolean(config.claude.logPrompt),
      modelOverride: config.claude.modelOverride || ''
    }
  });
});

app.post('/settings/runtime', (req, res) => {
  if (!checkManualToken(req, res)) {
    return;
  }

  const claude = req.body?.claude || {};

  config.claude.streamOutput = parseBooleanValue(claude.streamOutput, config.claude.streamOutput);
  config.claude.logPrompt = parseBooleanValue(claude.logPrompt, config.claude.logPrompt);

  if (typeof claude.modelOverride === 'string') {
    config.claude.modelOverride = claude.modelOverride;
  }

  logger.info(
    `Runtime settings updated (streamOutput=${config.claude.streamOutput}, logPrompt=${config.claude.logPrompt}, modelOverride=${config.claude.modelOverride || 'auto'})`
  );

  res.json({
    ok: true,
    claude: {
      streamOutput: Boolean(config.claude.streamOutput),
      logPrompt: Boolean(config.claude.logPrompt),
      modelOverride: config.claude.modelOverride || ''
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
    const validator = new BoardValidator(config);
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

  syncClaudeMd(config, logger)
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
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(config.server.port, () => {
  logger.success(`Server started on port ${config.server.port}`);

  if (config.queue.runOnStartup) {
    orchestrator.schedule('startup');
  } else {
    logger.info('Startup reconciliation disabled (QUEUE_RUN_ON_STARTUP=false)');
  }

  if (config.queue.pollIntervalMs > 0) {
    const pollTimer = setInterval(() => {
      orchestrator.schedule('poll_interval');
    }, config.queue.pollIntervalMs);

    if (typeof pollTimer.unref === 'function') {
      pollTimer.unref();
    }

    logger.info(`Periodic reconciliation enabled (QUEUE_POLL_INTERVAL_MS=${config.queue.pollIntervalMs})`);
  } else {
    logger.info('Periodic reconciliation disabled (QUEUE_POLL_INTERVAL_MS=0)');
  }
});
