import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { NotionBoardClient } from './notion/client.js';
import { Orchestrator } from './orchestrator.js';
import { RunStore } from './runStore.js';
const app = express();

app.use(express.json({ limit: '2mb' }));

const notionClient = new NotionBoardClient(config);
const runStore = new RunStore(config.state.runStorePath);
const orchestrator = new Orchestrator({
  config,
  logger,
  notionClient,
  runStore
});

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
      logPrompt: Boolean(config.claude.logPrompt)
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

  logger.info(
    `Runtime settings updated (streamOutput=${config.claude.streamOutput}, logPrompt=${config.claude.logPrompt})`
  );

  res.json({
    ok: true,
    claude: {
      streamOutput: Boolean(config.claude.streamOutput),
      logPrompt: Boolean(config.claude.logPrompt)
    }
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
