import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const cwd = process.cwd();
const envFilePath = path.join(cwd, '.env');
const panelDistPath = path.join(cwd, 'panel', 'dist');
const panelPort = Number(process.env.PANEL_PORT || 4100);
const FIXED_CLAUDE_COMMAND = '/opt/homebrew/bin/claude --print';
const DEFAULT_CLAUDE_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_CHAT_MESSAGE_CHARS = 12000;
const MAX_CHAT_LOG_CHARS = 8000;

function envEnabled(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const panelAutoOpen = envEnabled(process.env.PANEL_AUTO_OPEN, true);
const panelAutoStartApi = envEnabled(process.env.PANEL_AUTO_START_API, false);

const state = {
  api: {
    child: null,
    status: 'stopped',
    startedAt: null,
    pid: null
  }
};

const claudeChatState = {
  running: false
};
const LOG_SOURCE = {
  panel: 'panel',
  claude: 'claude',
  chatUser: 'chat_user',
  chatClaude: 'chat_claude'
};

const logHistory = [];
const logClients = new Set();
const MAX_LOG_LINES = 800;
const ANSI_ESCAPE_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const LOGGER_PREFIX_REGEX = /^(?:\S+\s+)?(INFO|SUCCESS|WARN|WARNING|ERROR)\s*-\s*(.+)$/i;
const LOGGER_TIMESTAMP_SUFFIX_REGEX = /\s*\(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{2}:\d{2}:\d{2}\)\s*$/;
const PROMPT_BLOCK_HEADER_REGEX = /^🧠\s+PROMPT\s*-\s*(.+)$/i;
const PROMPT_BLOCK_LINE_REGEX = /^\s*│\s?(.*)$/;
const PROMPT_BLOCK_END_REGEX = /^\s*└[-─]+\s*$/;
const WATCH_RESTART_REGEX = /^Restarting ['"].+['"]$/i;
const NPM_SCRIPT_LINE_REGEX = /^>\s.+$/;
const API_STATUS_NOISE_PATTERNS = [
  /^Server started on port \d+$/i,
  /^Startup reconciliation disabled \(QUEUE_RUN_ON_STARTUP=false\)$/i
];
const CLAUDE_RAW_NOISE_PATTERNS = [
  /you(?:'|’)ve hit your limit/i,
  /hit your limit/i
];

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/panel', express.static(panelDistPath));

function pushLog(level, source, message, extra) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    level,
    source,
    message,
    ...extra
  };

  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_LINES) {
    logHistory.shift();
  }

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of logClients) {
    client.write(payload);
  }
}

function normalizeUiLogLevel(level, fallback = 'info') {
  const normalized = String(level || '').toLowerCase();

  if (normalized === 'success' || normalized === 'ok') {
    return 'success';
  }

  if (normalized === 'warn' || normalized === 'warning') {
    return 'warn';
  }

  if (normalized === 'error' || normalized === 'danger') {
    return 'error';
  }

  if (normalized === 'info') {
    return 'info';
  }

  return fallback;
}

function sanitizeProcessLine(rawLine) {
  return String(rawLine || '')
    .replace(ANSI_ESCAPE_REGEX, '')
    .replace(/\r/g, '');
}

function parsePromptBlockHeader(cleanLine) {
  const trimmed = cleanLine.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(PROMPT_BLOCK_HEADER_REGEX);
  if (!match) {
    return null;
  }

  const title = String(match[1] || '')
    .replace(LOGGER_TIMESTAMP_SUFFIX_REGEX, '')
    .trim();

  return title || 'Prompt sent to Claude Code';
}

function parseProcessLogLine(rawLine, fallbackLevel = 'info') {
  const clean = sanitizeProcessLine(rawLine).trim();

  if (!clean) {
    return null;
  }

  const loggerMatch = clean.match(LOGGER_PREFIX_REGEX);
  if (loggerMatch) {
    const parsedLevel = normalizeUiLogLevel(loggerMatch[1], normalizeUiLogLevel(fallbackLevel));
    const parsedMessage = String(loggerMatch[2] || '')
      .replace(LOGGER_TIMESTAMP_SUFFIX_REGEX, '')
      .trim();

    return {
      level: parsedLevel,
      message: parsedMessage || clean,
      fromLogger: true
    };
  }

  return {
    level: normalizeUiLogLevel(fallbackLevel),
    message: clean,
    fromLogger: false
  };
}

function isClaudeTaskContractOutput(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }

  const fastPatternMatch = /^\{.*"status"\s*:\s*"(done|blocked)".*"summary"\s*:/i.test(text);
  if (!fastPatternMatch) {
    return false;
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const status = String(parsed.status || '').toLowerCase();
    if (!['done', 'blocked'].includes(status)) {
      return false;
    }

    return (
      typeof parsed.summary === 'string' ||
      typeof parsed.notes === 'string' ||
      typeof parsed.tests === 'string' ||
      Array.isArray(parsed.files)
    );
  } catch {
    return true;
  }
}

function resolveProcessLogSource(source, parsed) {
  if (source !== 'api') {
    return source;
  }

  if (parsed?.fromLogger) {
    return source;
  }

  if (isClaudeTaskContractOutput(parsed?.message)) {
    return LOG_SOURCE.chatClaude;
  }

  return source;
}

function processDisplayName(source) {
  if (source === 'api') {
    return 'Automation App';
  }

  return 'Process';
}

function shouldSuppressProcessMessage(source, message) {
  const clean = String(message || '').trim();
  if (!clean) {
    return true;
  }

  if (NPM_SCRIPT_LINE_REGEX.test(clean)) {
    return true;
  }

  if (WATCH_RESTART_REGEX.test(clean)) {
    return true;
  }

  if (source === 'api') {
    if (CLAUDE_RAW_NOISE_PATTERNS.some((pattern) => pattern.test(clean))) {
      return true;
    }

    return API_STATUS_NOISE_PATTERNS.some((pattern) => pattern.test(clean));
  }

  return false;
}

function buildProcessStopLog(source, code, signal) {
  const name = processDisplayName(source);
  const normalizedSignal = String(signal || '').toUpperCase();
  const expectedSignals = new Set(['SIGTERM', 'SIGINT']);
  const isExpectedStop = code === 0 || expectedSignals.has(normalizedSignal);

  if (isExpectedStop) {
    return {
      level: 'info',
      message: `${name} stopped.`
    };
  }

  const exitCode = code === null || code === undefined ? 'unknown' : String(code);
  const signalLabel = signal ? `, signal: ${signal}` : '';

  return {
    level: 'error',
    message: `${name} stopped unexpectedly (exit code: ${exitCode}${signalLabel}).`
  };
}

function createProcessLogForwarder({ fallbackLevel = 'info', onLog }) {
  const safeOnLog = typeof onLog === 'function' ? onLog : () => {};
  let activePromptBlock = null;

  function emitPromptBlock() {
    if (!activePromptBlock) {
      return;
    }

    const promptContent = activePromptBlock.lines.length > 0
      ? activePromptBlock.lines.join('\n')
      : '';

    safeOnLog({
      level: 'info',
      message: promptContent || activePromptBlock.title,
      isPrompt: true,
      promptTitle: activePromptBlock.title
    });

    activePromptBlock = null;
  }

  function handleLine(rawLine) {
    const cleanRaw = sanitizeProcessLine(rawLine);
    const promptHeader = parsePromptBlockHeader(cleanRaw);

    if (promptHeader) {
      emitPromptBlock();
      activePromptBlock = {
        title: promptHeader,
        lines: []
      };
      return;
    }

    if (activePromptBlock) {
      if (PROMPT_BLOCK_END_REGEX.test(cleanRaw.trim())) {
        emitPromptBlock();
        return;
      }

      const promptLineMatch = cleanRaw.match(PROMPT_BLOCK_LINE_REGEX);
      if (promptLineMatch) {
        activePromptBlock.lines.push(promptLineMatch[1] || '');
        return;
      }

      emitPromptBlock();
    }

    const parsed = parseProcessLogLine(cleanRaw, fallbackLevel);
    if (!parsed) {
      return;
    }

    safeOnLog(parsed);
  }

  return {
    handleLine,
    flush() {
      emitPromptBlock();
    }
  };
}

function readLines(stream, onLine) {
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => onLine(line));
  return rl;
}

function startManagedProcess(target, command, source, envOverrides = {}) {
  if (target.child) {
    return false;
  }

  const child = spawn(command, {
    shell: true,
    cwd,
    env: {
      ...process.env,
      ...envOverrides
    }
  });

  target.child = child;
  target.status = 'running';
  target.startedAt = new Date().toISOString();
  target.pid = child.pid || null;

  pushLog('success', source, `${processDisplayName(source)} started.`);

  const stdoutForwarder = createProcessLogForwarder({
    fallbackLevel: 'info',
    onLog: (parsed) => {
      if (shouldSuppressProcessMessage(source, parsed.message)) {
        return;
      }

      const extra = parsed.isPrompt ? { isPrompt: true, promptTitle: parsed.promptTitle } : undefined;
      pushLog(parsed.level, resolveProcessLogSource(source, parsed), parsed.message, extra);
    }
  });

  const stderrForwarder = createProcessLogForwarder({
    fallbackLevel: 'warn',
    onLog: (parsed) => {
      if (shouldSuppressProcessMessage(source, parsed.message)) {
        return;
      }

      const extra = parsed.isPrompt ? { isPrompt: true, promptTitle: parsed.promptTitle } : undefined;
      pushLog(parsed.level, resolveProcessLogSource(source, parsed), parsed.message, extra);
    }
  });

  const stdoutReader = readLines(child.stdout, (line) => {
    stdoutForwarder.handleLine(line);
  });

  const stderrReader = readLines(child.stderr, (line) => {
    stderrForwarder.handleLine(line);
  });

  child.on('close', (code, signal) => {
    stdoutForwarder.flush();
    stderrForwarder.flush();
    stdoutReader.close();
    stderrReader.close();

    const stopLog = buildProcessStopLog(source, code, signal);
    pushLog(stopLog.level, source, stopLog.message);
    target.child = null;
    target.status = 'stopped';
    target.startedAt = null;
    target.pid = null;
  });

  child.on('error', (error) => {
    pushLog('error', source, `Process error: ${error.message}`);
  });

  return true;
}

function stopManagedProcess(target, source) {
  if (!target.child) {
    return false;
  }

  pushLog('info', source, 'Stopping process...');
  target.child.kill('SIGTERM');
  return true;
}

function waitForProcessClose(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onClose = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    };

    const onError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill errors in timeout fallback.
      }
      reject(new Error('Timed out waiting process to stop.'));
    }, timeoutMs);

    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function restartManagedProcess(target, source, command, envOverrides = {}) {
  if (!target.child) {
    return false;
  }

  const child = target.child;
  const closed = waitForProcessClose(child);
  stopManagedProcess(target, source);
  await closed;

  const started = startManagedProcess(target, command, source, envOverrides);
  if (!started) {
    throw new Error('Could not start process after restart.');
  }

  return true;
}

async function readEnvPairs() {
  try {
    const content = await fs.readFile(envFilePath, 'utf8');
    const pairs = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) {
        continue;
      }

      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1);
      pairs[key] = value;
    }

    return pairs;
  } catch {
    return {};
  }
}

function normalizeEnvValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  return String(rawValue).replace(/\r?\n/g, '\\n');
}

async function updateEnvFile(updates) {
  let content = '';
  try {
    content = await fs.readFile(envFilePath, 'utf8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const keys = Object.keys(updates);
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (!(key in updates)) {
      continue;
    }

    lines[i] = `${key}=${normalizeEnvValue(updates[key])}`;
    seen.add(key);
  }

  for (const key of keys) {
    if (seen.has(key)) {
      continue;
    }

    if (lines.length > 0 && lines[lines.length - 1].trim().length > 0) {
      lines.push('');
    }
    lines.push(`${key}=${normalizeEnvValue(updates[key])}`);
  }

  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  await fs.writeFile(envFilePath, `${next.replace(/\n+$/, '')}\n`, 'utf8');

  for (const [key, rawValue] of Object.entries(updates)) {
    process.env[key] = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  }
}

async function probeApiHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const payload = await response.json();
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function getApiBaseUrl() {
  return process.env.PANEL_API_BASE_URL || 'http://localhost:3000';
}

function getApiProcessEnvOverrides() {
  return {
    QUEUE_RUN_ON_STARTUP: 'false',
    CLAUDE_COMMAND: FIXED_CLAUDE_COMMAND
  };
}

function getAutomationHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };

  const token = String(process.env.MANUAL_RUN_TOKEN || '').trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function resolveClaudeTimeoutMs() {
  const value = Number(process.env.CLAUDE_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_CLAUDE_TIMEOUT_MS;
  }

  return value;
}

function truncateText(rawValue, maxChars = MAX_CHAT_LOG_CHARS) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}

function summarizeCommandOutput(stderr, stdout) {
  const raw = String(stderr || stdout || 'No output');
  const line = raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)[0];

  if (!line) {
    return 'No output';
  }

  if (line.length <= 320) {
    return line;
  }

  return `${line.slice(0, 320)}...`;
}

function buildClaudePromptCommand() {
  if (!envEnabled(process.env.CLAUDE_FULL_ACCESS, false)) {
    return FIXED_CLAUDE_COMMAND;
  }

  if (FIXED_CLAUDE_COMMAND.includes('--dangerously-skip-permissions')) {
    return FIXED_CLAUDE_COMMAND;
  }

  return `${FIXED_CLAUDE_COMMAND} --dangerously-skip-permissions`;
}

function runClaudePrompt(prompt) {
  return new Promise((resolve, reject) => {
    const command = buildClaudePromptCommand();
    const workdir = path.resolve(cwd, process.env.CLAUDE_WORKDIR || '.');
    const timeoutMs = resolveClaudeTimeoutMs();
    const commandEnv = {
      ...process.env
    };

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      commandEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    const child = spawn(command, {
      shell: true,
      cwd: workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: commandEnv
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    function finish(error, payload) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
        return;
      }

      resolve(payload);
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill errors on timeout fallback.
      }

      finish(new Error(`Claude prompt timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      finish(error);
    });

    child.on('close', (code, signal) => {
      if (code !== 0) {
        const summary = summarizeCommandOutput(stderr, stdout);
        finish(new Error(`Claude command failed (exit=${code}, signal=${signal || 'none'}): ${summary}`));
        return;
      }

      finish(null, {
        reply: String(stdout || stderr || '').trim(),
        workdir
      });
    });

    child.stdin.on('error', () => {
      // Ignore EPIPE when process exits early.
    });
    child.stdin.write(String(prompt || ''));
    child.stdin.end();
  });
}

async function autoStartApiIfNeeded() {
  if (!panelAutoStartApi) {
    pushLog('info', LOG_SOURCE.panel, 'API auto-start is disabled (PANEL_AUTO_START_API=false).');
    return;
  }

  const apiBaseUrl = getApiBaseUrl();
  const health = await probeApiHealth(apiBaseUrl);
  if (health.ok) {
    pushLog('info', LOG_SOURCE.panel, `Automation API already reachable at ${apiBaseUrl}. Skipping auto-start.`);
    return;
  }

  const command = process.env.PANEL_API_START_COMMAND || 'npm run dev';
  const started = startManagedProcess(state.api, command, 'api', getApiProcessEnvOverrides());
  if (started) {
    pushLog('info', LOG_SOURCE.panel, 'Automation App was started automatically when the panel opened.');
    return;
  }

  pushLog('warn', LOG_SOURCE.panel, 'Automation App auto-start skipped because process is already running.');
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore' });
    return;
  }

  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    return;
  }

  spawn('xdg-open', [url], { stdio: 'ignore' });
}

async function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || stdout.trim() || `Command failed with exit=${code}`;
      const error = new Error(message);
      error.exitCode = code;
      reject(error);
    });
  });
}

function createSelectionCanceledError() {
  const error = new Error('Directory selection canceled by user.');
  error.code = 'SELECTION_CANCELED';
  return error;
}

function normalizeSelectedPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.length > 1 && trimmed.endsWith(path.sep)) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

async function selectDirectoryWithDialog() {
  if (process.platform === 'darwin') {
    try {
      const script = 'POSIX path of (choose folder with prompt "Select folder for CLAUDE_WORKDIR")';
      const { stdout } = await runCommandCapture('osascript', ['-e', script]);
      const selectedPath = normalizeSelectedPath(stdout);
      if (!selectedPath) {
        throw createSelectionCanceledError();
      }
      return selectedPath;
    } catch (error) {
      const message = error.message || '';
      if (error.code === 'SELECTION_CANCELED' || message.includes('User canceled') || message.includes('(-128)')) {
        throw createSelectionCanceledError();
      }
      throw error;
    }
  }

  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Select folder for CLAUDE_WORKDIR"',
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::WriteLine($dialog.SelectedPath)',
      '  exit 0',
      '}',
      'exit 1'
    ].join('; ');

    try {
      const { stdout } = await runCommandCapture('powershell', ['-NoProfile', '-Command', script]);
      const selectedPath = normalizeSelectedPath(stdout);
      if (!selectedPath) {
        throw createSelectionCanceledError();
      }
      return selectedPath;
    } catch (error) {
      if (error.code === 'SELECTION_CANCELED' || error.exitCode === 1) {
        throw createSelectionCanceledError();
      }
      throw error;
    }
  }

  try {
    const { stdout } = await runCommandCapture('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select folder for CLAUDE_WORKDIR'
    ]);
    const selectedPath = normalizeSelectedPath(stdout);
    if (!selectedPath) {
      throw createSelectionCanceledError();
    }
    return selectedPath;
  } catch (error) {
    if (error.code === 'SELECTION_CANCELED' || error.exitCode === 1) {
      throw createSelectionCanceledError();
    }

    if (error.code === 'ENOENT') {
      throw new Error('Folder picker is not available. Install zenity or type the path manually.');
    }

    throw error;
  }
}

app.get('/', (_req, res) => {
  res.redirect('/panel/');
});

app.get('/panel/*', (req, res, next) => {
  if (req.path.startsWith('/panel/api')) {
    next();
    return;
  }

  res.sendFile(path.join(panelDistPath, 'index.html'), (error) => {
    if (error) {
      next(error);
    }
  });
});

app.get('/api/status', async (_req, res) => {
  const apiBaseUrl = getApiBaseUrl();
  const apiHealth = await probeApiHealth(apiBaseUrl);

  res.json({
    api: {
      status: state.api.status,
      pid: state.api.pid,
      startedAt: state.api.startedAt
    },
    automationApi: {
      baseUrl: apiBaseUrl,
      reachable: apiHealth.ok,
      health: apiHealth
    }
  });
});

app.get('/api/logs', (_req, res) => {
  res.json({
    lines: logHistory
  });
});

app.get('/api/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  res.write('\n');
  logClients.add(res);

  req.on('close', () => {
    logClients.delete(res);
  });
});

app.get('/api/config', async (_req, res) => {
  const env = await readEnvPairs();

  res.json({
    values: {
      NOTION_API_TOKEN: env.NOTION_API_TOKEN || '',
      NOTION_DATABASE_ID: env.NOTION_DATABASE_ID || '',
      CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || '',
      CLAUDE_COMMAND: FIXED_CLAUDE_COMMAND,
      CLAUDE_WORKDIR: env.CLAUDE_WORKDIR || '.',
      CLAUDE_FULL_ACCESS: env.CLAUDE_FULL_ACCESS || 'true',
      CLAUDE_STREAM_OUTPUT: env.CLAUDE_STREAM_OUTPUT || 'true',
      CLAUDE_LOG_PROMPT: env.CLAUDE_LOG_PROMPT || 'true',
      MANUAL_RUN_TOKEN: env.MANUAL_RUN_TOKEN || ''
    }
  });
});

app.post('/api/config', async (req, res) => {
  const updates = {
    ...(req.body || {}),
    CLAUDE_COMMAND: FIXED_CLAUDE_COMMAND
  };

  await updateEnvFile(updates);
  pushLog('success', LOG_SOURCE.panel, 'Saved .env updates');
  res.json({ ok: true });
});

app.post('/api/system/select-directory', async (_req, res) => {
  try {
    const selectedPath = await selectDirectoryWithDialog();
    pushLog('info', LOG_SOURCE.panel, `Folder selected for CLAUDE_WORKDIR: ${selectedPath}`);
    res.json({ ok: true, path: selectedPath });
  } catch (error) {
    if (error.code === 'SELECTION_CANCELED') {
      res.status(409).json({ ok: false, message: 'Directory selection canceled by user.' });
      return;
    }

    pushLog('warn', LOG_SOURCE.panel, `Folder picker failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/process/api/start', (req, res) => {
  const command = process.env.PANEL_API_START_COMMAND || 'npm run dev';
  const started = startManagedProcess(state.api, command, 'api', getApiProcessEnvOverrides());

  if (!started) {
    res.status(409).json({ ok: false, message: 'API process already running' });
    return;
  }

  res.json({ ok: true });
});

app.post('/api/process/api/stop', (req, res) => {
  const stopped = stopManagedProcess(state.api, 'api');
  if (!stopped) {
    res.status(409).json({ ok: false, message: 'API process is not running' });
    return;
  }

  res.json({ ok: true });
});

app.post('/api/process/api/restart', async (_req, res) => {
  const command = process.env.PANEL_API_START_COMMAND || 'npm run dev';

  try {
    const restarted = await restartManagedProcess(state.api, 'api', command, getApiProcessEnvOverrides());
    if (!restarted) {
      res.status(409).json({ ok: false, message: 'API process is not running' });
      return;
    }

    pushLog('success', 'api', 'API process restarted with latest .env values');
    res.json({ ok: true });
  } catch (error) {
    pushLog('error', 'api', `API restart failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/automation/run', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Manual run failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Manual run requested successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Manual run error: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/claude/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    res.status(400).json({ ok: false, message: 'Message is required.' });
    return;
  }

  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    res.status(400).json({ ok: false, message: `Message is too long (${MAX_CHAT_MESSAGE_CHARS} chars max).` });
    return;
  }

  if (claudeChatState.running) {
    res.status(409).json({ ok: false, message: 'Claude chat is already running. Wait for the current reply.' });
    return;
  }

  claudeChatState.running = true;
  pushLog('info', LOG_SOURCE.chatUser, truncateText(message));

  try {
    const { reply, workdir } = await runClaudePrompt(message);
    const normalizedReply = reply || '(Claude returned empty output)';
    pushLog('success', LOG_SOURCE.chatClaude, truncateText(normalizedReply));
    res.json({
      ok: true,
      workdir,
      reply: normalizedReply
    });
  } catch (error) {
    pushLog('error', LOG_SOURCE.claude, `Manual Claude chat failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    claudeChatState.running = false;
  }
});

app.get('/api/automation/runtime', async (_req, res) => {
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/settings/runtime`, {
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({ ok: false, message: payload?.error || payload?.message || 'Request failed' });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/automation/runtime', async (req, res) => {
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/settings/runtime`, {
      method: 'POST',
      headers: getAutomationHeaders(),
      body: JSON.stringify(req.body || {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({ ok: false, message: payload?.error || payload?.message || 'Request failed' });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

async function ensurePanelBuild() {
  const indexPath = path.join(panelDistPath, 'index.html');
  try {
    await fs.access(indexPath);
  } catch {
    console.error('❌ Panel build not found. Run: npm run panel:build');
    process.exit(1);
  }
}

async function startServer() {
  await ensurePanelBuild();

  const server = app.listen(panelPort, () => {
    const url = `http://localhost:${panelPort}`;
    console.log(`✅ Joy UI panel started: ${url}`);
    console.log('ℹ️ Use this panel to configure .env, start app, and watch live logs.');
    if (panelAutoOpen) {
      try {
        openBrowser(url);
        console.log('🌐 Browser opened automatically.');
      } catch (error) {
        console.warn(`⚠️ Could not open browser automatically: ${error.message}`);
      }
    }

    autoStartApiIfNeeded().catch((error) => {
      pushLog('error', LOG_SOURCE.panel, `Failed API auto-start check: ${error.message}`);
    });
  });

  server.on('error', (error) => {
    console.error(`❌ Failed to start panel server: ${error.message}`);
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error(`❌ Failed to initialize panel server: ${error.message}`);
  process.exit(1);
});
