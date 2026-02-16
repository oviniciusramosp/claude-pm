import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';
import { LocalBoardClient } from '../src/local/client.js';
import { isEpicTask, sortCandidates } from '../src/selectTask.js';

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
const LOGS_FILE = path.join(cwd, '.data', 'logs.jsonl');
const MAX_LOG_FILE_LINES = 2000;
let logWritesSinceLastTrim = 0;

function loadLogsFromDisk() {
  try {
    fsSync.mkdirSync(path.dirname(LOGS_FILE), { recursive: true });
    if (!fsSync.existsSync(LOGS_FILE)) return;
    const raw = fsSync.readFileSync(LOGS_FILE, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const recent = lines.slice(-MAX_LOG_LINES);
    for (const line of recent) {
      try {
        logHistory.push(JSON.parse(line));
      } catch { /* skip malformed line */ }
    }
  } catch { /* first run — no file yet */ }
}

function appendLogToDisk(entry) {
  try {
    fsSync.appendFileSync(LOGS_FILE, JSON.stringify(entry) + '\n');
    logWritesSinceLastTrim++;
    if (logWritesSinceLastTrim >= 100) {
      logWritesSinceLastTrim = 0;
      trimLogFile();
    }
  } catch { /* non-critical — log continues in-memory */ }
}

function trimLogFile() {
  try {
    const raw = fsSync.readFileSync(LOGS_FILE, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length > MAX_LOG_FILE_LINES) {
      const trimmed = lines.slice(-MAX_LOG_FILE_LINES);
      fsSync.writeFileSync(LOGS_FILE, trimmed.join('\n') + '\n');
    }
  } catch { /* non-critical */ }
}
const ANSI_ESCAPE_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const LOGGER_PREFIX_REGEX = /^(?:\S+\s+)?(INFO|SUCCESS|WARN|WARNING|ERROR)\s*-\s*(.+)$/i;
const LOGGER_TIMESTAMP_SUFFIX_REGEX = /\s*\(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{2}:\d{2}:\d{2}\)\s*$/;
const PROMPT_BLOCK_HEADER_REGEX = /^🧠\s+PROMPT\s*-\s*(.+)$/i;
const PROMPT_BLOCK_LINE_REGEX = /^\s*│\s?(.*)$/;
const PROMPT_BLOCK_END_REGEX = /^\s*└[-─]+\s*$/;
const WATCH_RESTART_REGEX = /^Restarting ['"].+['"]$/i;
const NPM_SCRIPT_LINE_REGEX = /^>\s.+$/;
const PROGRESS_MARKER_REGEX = /^\[PM_PROGRESS]\s+(.+)$/;
const AC_COMPLETE_MARKER_REGEX = /^\[PM_AC_COMPLETE]\s+(.+)$/;
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

  appendLogToDisk(entry);

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

  const acCompleteMatch = clean.match(AC_COMPLETE_MARKER_REGEX);
  if (acCompleteMatch) {
    return {
      level: 'success',
      message: `AC completed: "${acCompleteMatch[1].trim()}"`,
      fromLogger: false,
      isAcComplete: true
    };
  }

  const progressMatch = clean.match(PROGRESS_MARKER_REGEX);
  if (progressMatch) {
    return {
      level: 'info',
      message: progressMatch[1].trim(),
      fromLogger: false,
      isToolUse: true
    };
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

  if (parsed?.isToolUse) {
    return LOG_SOURCE.claude;
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

  function buildLogExtra(parsed) {
    if (parsed.isPrompt) return { isPrompt: true, promptTitle: parsed.promptTitle };
    if (parsed.isAcComplete) return { isAcComplete: true };
    if (parsed.isToolUse) return { isToolUse: true };
    return undefined;
  }

  const stdoutForwarder = createProcessLogForwarder({
    fallbackLevel: 'info',
    onLog: (parsed) => {
      if (shouldSuppressProcessMessage(source, parsed.message)) {
        return;
      }

      pushLog(parsed.level, resolveProcessLogSource(source, parsed), parsed.message, buildLogExtra(parsed));
    }
  });

  const stderrForwarder = createProcessLogForwarder({
    fallbackLevel: 'warn',
    onLog: (parsed) => {
      if (shouldSuppressProcessMessage(source, parsed.message)) {
        return;
      }

      pushLog(parsed.level, resolveProcessLogSource(source, parsed), parsed.message, buildLogExtra(parsed));
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

/**
 * Resolve BOARD_DIR relative to CLAUDE_WORKDIR (the project directory),
 * not relative to the Product Manager directory. This ensures the panel
 * reads/writes the same Board/ files that Claude updates during execution.
 */
function resolveBoardDir(env) {
  const claudeWorkdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');
  const boardDirEnv = env.BOARD_DIR;

  if (!boardDirEnv) {
    // Default: Board/ inside the project directory
    return path.resolve(claudeWorkdir, 'Board');
  }

  // If BOARD_DIR is absolute, use it as-is
  if (path.isAbsolute(boardDirEnv)) {
    return boardDirEnv;
  }

  // If BOARD_DIR is relative, resolve from project directory
  return path.resolve(claudeWorkdir, boardDirEnv);
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

async function ensureApiRunning() {
  const baseUrl = getApiBaseUrl();
  const health = await probeApiHealth(baseUrl);
  if (health.ok) {
    return;
  }

  const command = process.env.PANEL_API_START_COMMAND || 'npm start';
  const started = startManagedProcess(state.api, command, 'api', getApiProcessEnvOverrides());
  if (!started && !state.api.process) {
    throw new Error('Failed to start API process');
  }

  if (started) {
    pushLog('info', LOG_SOURCE.panel, 'API started automatically before running automation.');
  }

  const maxAttempts = 30;
  const intervalMs = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const probe = await probeApiHealth(baseUrl);
    if (probe.ok) {
      return;
    }
  }

  throw new Error('API process started but did not become healthy within 15s');
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

function buildClaudePromptCommand(model) {
  let command = FIXED_CLAUDE_COMMAND;

  if (envEnabled(process.env.CLAUDE_FULL_ACCESS, false) && !command.includes('--dangerously-skip-permissions')) {
    command = `${command} --dangerously-skip-permissions`;
  }

  if (model && model.trim()) {
    command = `${command} --model ${model.trim()}`;
  }

  return command;
}

function runClaudePrompt(prompt, model) {
  return new Promise((resolve, reject) => {
    const command = buildClaudePromptCommand(model);
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

  const command = process.env.PANEL_API_START_COMMAND || 'npm start';
  const started = startManagedProcess(state.api, command, 'api', getApiProcessEnvOverrides());
  if (started) {
    pushLog('info', LOG_SOURCE.panel, 'Automation App was started automatically when the panel opened.');
    return;
  }

  pushLog('warn', LOG_SOURCE.panel, 'Automation App auto-start skipped because process is already running.');
}

function buildMacOsReuseTabScript(url) {
  // Each browser has a different AppleScript API for tab control.
  // Dia: supports `focus` command but URL is read-only.
  // Chrome/Brave/Edge: supports `set URL` and `active tab index`.
  // Safari: supports `set URL` and `current tab`.
  return `
set targetUrl to "${url}"
set urlPrefix to "${url}"

-- Dia (focus-only API, URL is read-only)
try
  tell application "Dia"
    if it is running then
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t starts with urlPrefix then
            focus t
            activate
            return "found"
          end if
        end repeat
      end repeat
    end if
  end tell
end try

-- Chromium browsers with full tab control (set URL + active tab index)
repeat with browserName in {"Google Chrome", "Brave Browser", "Microsoft Edge", "Arc"}
  try
    tell application browserName
      if it is running then
        repeat with w in windows
          repeat with t in tabs of w
            if URL of t starts with urlPrefix then
              set URL of t to targetUrl
              set active tab index of w to (index of t)
              set index of w to 1
              activate
              return "found"
            end if
          end repeat
        end repeat
      end if
    end tell
  end try
end repeat

-- Safari
try
  tell application "Safari"
    if it is running then
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t starts with urlPrefix then
            set URL of t to targetUrl
            set current tab of w to t
            set index of w to 1
            activate
            return "found"
          end if
        end repeat
      end repeat
    end if
  end tell
end try

open location targetUrl
`.trim();
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const script = buildMacOsReuseTabScript(url);
    spawn('osascript', ['-e', script], { stdio: 'ignore' }).on('error', () => {
      spawn('open', [url], { stdio: 'ignore' });
    });
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
      CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || '',
      CLAUDE_COMMAND: FIXED_CLAUDE_COMMAND,
      CLAUDE_WORKDIR: env.CLAUDE_WORKDIR || '.',
      CLAUDE_MODEL_OVERRIDE: env.CLAUDE_MODEL_OVERRIDE || '',
      CLAUDE_FULL_ACCESS: env.CLAUDE_FULL_ACCESS || 'true',
      CLAUDE_STREAM_OUTPUT: env.CLAUDE_STREAM_OUTPUT || 'true',
      CLAUDE_LOG_PROMPT: env.CLAUDE_LOG_PROMPT || 'true',
      OPUS_REVIEW_ENABLED: env.OPUS_REVIEW_ENABLED || 'false',
      EPIC_REVIEW_ENABLED: env.EPIC_REVIEW_ENABLED || 'false',
      FORCE_TEST_CREATION: env.FORCE_TEST_CREATION || 'false',
      FORCE_TEST_RUN: env.FORCE_TEST_RUN || 'false',
      FORCE_COMMIT: env.FORCE_COMMIT || 'false',
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
  const command = process.env.PANEL_API_START_COMMAND || 'npm start';
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
  const command = process.env.PANEL_API_START_COMMAND || 'npm start';

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
    await ensureApiRunning();
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

app.post('/api/automation/run-task', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    await ensureApiRunning();
    const response = await fetch(`${baseUrl}/run-task`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Single-task run failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Single-task run requested successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Single-task run error: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/automation/run-epic', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    await ensureApiRunning();
    const response = await fetch(`${baseUrl}/run-epic`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Epic run failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Epic run requested successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Epic run error: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/automation/resume', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    await ensureApiRunning();
    const response = await fetch(`${baseUrl}/resume`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Resume failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Orchestrator resumed successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Resume error: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/api/board', async (_req, res) => {
  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);

  const boardConfig = {
    board: {
      dir: boardDir,
      statuses: {
        notStarted: env.BOARD_STATUS_NOT_STARTED || 'Not Started',
        inProgress: env.BOARD_STATUS_IN_PROGRESS || 'In Progress',
        done: env.BOARD_STATUS_DONE || 'Done'
      },
      typeValues: { epic: env.BOARD_TYPE_EPIC || 'Epic' }
    }
  };

  try {
    const client = new LocalBoardClient(boardConfig);
    await client.initialize();
    const tasks = await client.listTasks();
    res.json({ ok: true, tasks });
  } catch (error) {
    const msg = error.message || String(error);
    res.status(500).json({
      ok: false,
      code: 'BOARD_ERROR',
      message: `Board read error: ${msg}`,
      details: {
        errorId: `board-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        boardDir,
        raw: msg,
        stack: error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : undefined,
        timestamp: new Date().toISOString(),
        hint: 'Make sure the Board directory exists and is readable.'
      }
    });
  }
});

app.get('/api/board/task-markdown', async (req, res) => {
  const taskId = String(req.query.taskId || '').trim();
  if (!taskId) {
    res.status(400).json({ ok: false, message: 'taskId query parameter is required.' });
    return;
  }

  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);

  const boardConfig = {
    board: {
      dir: boardDir,
      statuses: {
        notStarted: env.BOARD_STATUS_NOT_STARTED || 'Not Started',
        inProgress: env.BOARD_STATUS_IN_PROGRESS || 'In Progress',
        done: env.BOARD_STATUS_DONE || 'Done'
      },
      typeValues: { epic: env.BOARD_TYPE_EPIC || 'Epic' }
    }
  };

  try {
    const client = new LocalBoardClient(boardConfig);
    await client.initialize();
    await client.listTasks();
    const markdown = await client.getTaskMarkdown(taskId);
    res.json({ ok: true, markdown });
  } catch (error) {
    const msg = error.message || String(error);
    res.status(500).json({ ok: false, message: msg });
  }
});

app.post('/api/board/fix-order', async (_req, res) => {
  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);
  const queueOrder = env.QUEUE_ORDER || 'alphabetical';

  const boardConfig = {
    board: {
      dir: boardDir,
      statuses: {
        notStarted: env.BOARD_STATUS_NOT_STARTED || 'Not Started',
        inProgress: env.BOARD_STATUS_IN_PROGRESS || 'In Progress',
        done: env.BOARD_STATUS_DONE || 'Done'
      },
      typeValues: { epic: env.BOARD_TYPE_EPIC || 'Epic' }
    }
  };

  try {
    const client = new LocalBoardClient(boardConfig);
    await client.initialize();
    const tasks = await client.listTasks();

    const notStartedStatus = boardConfig.board.statuses.notStarted;
    const inProgressStatus = boardConfig.board.statuses.inProgress;
    const doneStatus = boardConfig.board.statuses.done;

    const epics = tasks.filter((t) => isEpicTask(t, tasks, boardConfig));
    const sorted = sortCandidates(epics, queueOrder);

    const fixed = [];
    const fixedChildren = [];
    let foundFirstIncomplete = false;

    // Pass 1: Fix epic-level ordering (only one epic active at a time).
    for (const epic of sorted) {
      const status = (epic.status || '').trim().toLowerCase();
      const isDone = status === doneStatus.toLowerCase();
      const isInProgress = status === inProgressStatus.toLowerCase();

      if (isDone) continue;

      if (!foundFirstIncomplete) {
        foundFirstIncomplete = true;
        continue;
      }

      // Any subsequent non-Done epic that is In Progress needs to go back.
      if (isInProgress) {
        await client.updateTaskStatus(epic.id, notStartedStatus);

        // Also reset In Progress children back to Not Started.
        const children = tasks.filter((t) => t.parentId === epic.id);
        for (const child of children) {
          const childStatus = (child.status || '').trim().toLowerCase();
          if (childStatus === inProgressStatus.toLowerCase()) {
            await client.updateTaskStatus(child.id, notStartedStatus);
          }
        }

        fixed.push(epic.name);
      }
    }

    // Pass 2: Fix children ordering within every non-Done epic.
    // Re-read tasks after pass 1 may have changed statuses.
    const freshTasks = fixed.length > 0 ? await client.listTasks() : tasks;
    const allEpics = freshTasks.filter((t) => isEpicTask(t, freshTasks, boardConfig));

    for (const epic of allEpics) {
      const epicStatus = (epic.status || '').trim().toLowerCase();
      if (epicStatus === doneStatus.toLowerCase()) continue;

      const children = freshTasks.filter(
        (t) => t.parentId === epic.id && !isEpicTask(t, freshTasks, boardConfig)
      );
      if (children.length === 0) continue;

      const sortedChildren = sortCandidates(children, queueOrder);

      // Find the first non-Done child in sorted order.
      const firstPendingIdx = sortedChildren.findIndex((c) => {
        const cs = (c.status || '').trim().toLowerCase();
        return cs !== doneStatus.toLowerCase();
      });

      if (firstPendingIdx === -1) continue; // All children done.

      // Check if a later child is In Progress while this first pending child is not.
      const hasLaterInProgress = sortedChildren.slice(firstPendingIdx + 1).some((c) => {
        const cs = (c.status || '').trim().toLowerCase();
        return cs === inProgressStatus.toLowerCase();
      });

      if (!hasLaterInProgress) continue;

      // Out-of-order detected. Re-stamp: first pending -> In Progress, rest -> Not Started.
      for (let i = firstPendingIdx; i < sortedChildren.length; i++) {
        const child = sortedChildren[i];
        const cs = (child.status || '').trim().toLowerCase();
        if (cs === doneStatus.toLowerCase()) continue;

        const targetStatus = i === firstPendingIdx ? inProgressStatus : notStartedStatus;
        if (cs !== targetStatus.toLowerCase()) {
          await client.updateTaskStatus(child.id, targetStatus);
          if (cs === inProgressStatus.toLowerCase()) {
            fixedChildren.push(child.name);
          }
        }
      }
    }

    const totalFixes = fixed.length + fixedChildren.length;

    if (totalFixes > 0) {
      const messages = [];
      if (fixed.length > 0) {
        messages.push(`moved ${fixed.length} epic(s) back to Not Started: ${fixed.join(', ')}`);
      }
      if (fixedChildren.length > 0) {
        messages.push(`re-ordered ${fixedChildren.length} child task(s): ${fixedChildren.join(', ')}`);
      }
      pushLog('success', LOG_SOURCE.panel, `Board order fixed: ${messages.join('; ')}.`);

      // Restart the API process to interrupt any in-flight work on the wrong task.
      if (state.api.child) {
        pushLog('info', LOG_SOURCE.panel, 'Restarting API to interrupt out-of-order task execution...');
        const command = process.env.PANEL_API_START_COMMAND || 'npm start';
        try {
          await restartManagedProcess(state.api, 'api', command, getApiProcessEnvOverrides());
          pushLog('success', LOG_SOURCE.panel, 'API restarted. Orchestrator will pick up the correct task.');
        } catch (restartErr) {
          pushLog('error', LOG_SOURCE.panel, `API restart failed: ${restartErr.message}`);
        }
      }
    } else {
      pushLog('info', LOG_SOURCE.panel, 'Board order is already correct. No changes needed.');
    }

    res.json({ ok: true, fixed, fixedChildren });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Board fix-order failed: ${msg}`);
    res.status(500).json({ ok: false, message: msg });
  }
});

app.post('/api/board/fix-task', async (req, res) => {
  const { taskId } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ ok: false, message: 'taskId is required' });
    return;
  }

  pushLog('info', LOG_SOURCE.panel, `Task fix requested for: ${taskId}`);

  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);
  const claudeWorkdir = env.CLAUDE_WORKDIR || '.';

  const boardConfig = {
    board: {
      dir: boardDir,
      statuses: {
        notStarted: env.BOARD_STATUS_NOT_STARTED || 'Not Started',
        inProgress: env.BOARD_STATUS_IN_PROGRESS || 'In Progress',
        done: env.BOARD_STATUS_DONE || 'Done'
      },
      typeValues: { epic: env.BOARD_TYPE_EPIC || 'Epic' }
    }
  };

  try {
    const client = new LocalBoardClient(boardConfig);
    await client.initialize();
    const tasks = await client.listTasks();
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      pushLog('error', LOG_SOURCE.panel, `Task not found: ${taskId}`);
      res.status(404).json({ ok: false, message: `Task not found: ${taskId}` });
      return;
    }

    // Check if this is an Epic
    const isEpic = task.type?.toLowerCase() === 'epic' || tasks.some((t) => t.parentId === task.id);
    const childTasks = isEpic ? tasks.filter((t) => t.parentId === task.id) : [];

    // Read task markdown content using the internal _filePath
    if (!task._filePath) {
      pushLog('error', LOG_SOURCE.panel, `Task has no file path: ${taskId}`);
      res.status(500).json({ ok: false, message: `Task has no file path: ${taskId}` });
      return;
    }
    const taskContent = await fs.readFile(task._filePath, 'utf-8');

    // Build prompt for Claude to verify and fix ACs
    const prompt = isEpic
      ? buildEpicFixPrompt(taskId, task.name, taskContent, task._filePath, childTasks)
      : buildFixTaskPrompt(taskId, task.name, taskContent, task._filePath);

    // Execute Claude in one-shot mode
    pushLog('info', LOG_SOURCE.panel, `Running Claude to verify and fix ACs for: ${taskId}`);

    const claudeModel = task.model || env.CLAUDE_DEFAULT_MODEL || 'claude-sonnet-4-5-20250929';

    // Build command string (claude CLI uses shell command parsing)
    let command = '/opt/homebrew/bin/claude --print';

    if (claudeModel) {
      command += ` --model ${claudeModel}`;
    }

    if (env.CLAUDE_FULL_ACCESS === 'true') {
      command += ' --dangerously-skip-permissions';
    }

    // Escape single quotes in prompt and wrap in single quotes
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    command += ` '${escapedPrompt}'`;

    const spawnOpts = {
      cwd: claudeWorkdir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    };

    const child = spawn(command, [], spawnOpts);
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (env.CLAUDE_STREAM_OUTPUT === 'true') {
        pushLog('info', LOG_SOURCE.claude, text.trim());
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // Log stderr in real-time for debugging
      pushLog('error', LOG_SOURCE.claude, text.trim());
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    if (exitCode === 0) {
      if (isEpic) {
        // Process Epic: check all child tasks and update their statuses
        const childResults = [];
        for (const child of childTasks) {
          const childContent = await fs.readFile(child._filePath, 'utf-8');
          const unchecked = (childContent.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
          const checked = (childContent.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
          const total = unchecked + checked;

          // Update child status
          let childStatus = null;
          if (total > 0) {
            if (unchecked === 0) {
              childStatus = boardConfig.board.statuses.done;
              await client.updateTaskStatus(child.id, childStatus);
              pushLog('success', LOG_SOURCE.panel, `  ${child.id} → Done (${checked}/${total} ACs)`);
            } else if (checked > 0) {
              const currentStatus = child.status.trim().toLowerCase();
              const inProgressStatus = boardConfig.board.statuses.inProgress.toLowerCase();
              if (currentStatus !== inProgressStatus) {
                childStatus = boardConfig.board.statuses.inProgress;
                await client.updateTaskStatus(child.id, childStatus);
                pushLog('info', LOG_SOURCE.panel, `  ${child.id} → In Progress (${checked}/${total} ACs)`);
              }
            } else {
              const currentStatus = child.status.trim().toLowerCase();
              const notStartedStatus = boardConfig.board.statuses.notStarted.toLowerCase();
              if (currentStatus !== notStartedStatus) {
                childStatus = boardConfig.board.statuses.notStarted;
                await client.updateTaskStatus(child.id, childStatus);
                pushLog('info', LOG_SOURCE.panel, `  ${child.id} → Not Started (0/${total} ACs)`);
              }
            }
          }

          childResults.push({ id: child.id, checked, total, status: childStatus });
        }

        // Check Epic's own ACs
        const epicContent = await fs.readFile(task._filePath, 'utf-8');
        const epicUnchecked = (epicContent.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
        const epicChecked = (epicContent.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
        const epicTotal = epicUnchecked + epicChecked;

        // Update Epic status based on children
        const allChildrenDone = childTasks.every((child) => {
          const result = childResults.find((r) => r.id === child.id);
          return result && result.checked === result.total && result.total > 0;
        });

        let epicStatus = null;
        if (allChildrenDone && childTasks.length > 0) {
          epicStatus = boardConfig.board.statuses.done;
          await client.updateTaskStatus(taskId, epicStatus);
          pushLog('success', LOG_SOURCE.panel, `Epic ${taskId} → Done (all children complete)`);
        } else if (childResults.some((r) => r.checked > 0)) {
          const currentStatus = task.status.trim().toLowerCase();
          const inProgressStatus = boardConfig.board.statuses.inProgress.toLowerCase();
          if (currentStatus !== inProgressStatus) {
            epicStatus = boardConfig.board.statuses.inProgress;
            await client.updateTaskStatus(taskId, epicStatus);
            pushLog('info', LOG_SOURCE.panel, `Epic ${taskId} → In Progress (some children have progress)`);
          }
        }

        pushLog('success', LOG_SOURCE.panel, `Epic fix completed: ${taskId} (${childTasks.length} children processed)`);
        res.json({
          ok: true,
          taskId,
          isEpic: true,
          summary: `Epic: ${epicChecked}/${epicTotal} ACs, ${childResults.length} children updated`,
          children: childResults,
          statusChanged: epicStatus !== null,
          newStatus: epicStatus
        });
      } else {
        // Regular task: check its ACs and update status
        const updatedContent = await fs.readFile(task._filePath, 'utf-8');
        const uncheckedACs = (updatedContent.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
        const checkedACs = (updatedContent.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
        const totalACs = uncheckedACs + checkedACs;

        // Update task status based on AC completion
        let newStatus = null;
        if (totalACs > 0) {
          if (uncheckedACs === 0) {
            // All ACs are complete -> move to Done
            newStatus = boardConfig.board.statuses.done;
            await client.updateTaskStatus(taskId, newStatus);
            pushLog('success', LOG_SOURCE.panel, `Task ${taskId} moved to Done (all ${checkedACs} ACs completed)`);
          } else if (checkedACs > 0) {
            // Some ACs complete but not all -> move to In Progress if not already
            const currentStatus = task.status.trim().toLowerCase();
            const doneStatus = boardConfig.board.statuses.done.toLowerCase();
            const inProgressStatus = boardConfig.board.statuses.inProgress.toLowerCase();

            if (currentStatus !== doneStatus && currentStatus !== inProgressStatus) {
              newStatus = boardConfig.board.statuses.inProgress;
              await client.updateTaskStatus(taskId, newStatus);
              pushLog('info', LOG_SOURCE.panel, `Task ${taskId} moved to In Progress (${checkedACs}/${totalACs} ACs completed)`);
            }
          } else {
            // No ACs completed -> move to Not Started if not already
            const currentStatus = task.status.trim().toLowerCase();
            const notStartedStatus = boardConfig.board.statuses.notStarted.toLowerCase();

            if (currentStatus !== notStartedStatus) {
              newStatus = boardConfig.board.statuses.notStarted;
              await client.updateTaskStatus(taskId, newStatus);
              pushLog('info', LOG_SOURCE.panel, `Task ${taskId} moved to Not Started (0 ACs completed)`);
            }
          }
        }

        pushLog('success', LOG_SOURCE.panel, `Task fix completed successfully: ${taskId}`);
        res.json({
          ok: true,
          taskId,
          isEpic: false,
          summary: `${checkedACs}/${totalACs} ACs completed`,
          statusChanged: newStatus !== null,
          newStatus
        });
      }
    } else {
      pushLog('error', LOG_SOURCE.panel, `Task fix failed for ${taskId} (exit code ${exitCode}): ${stderr.slice(0, 200)}`);
      res.status(500).json({ ok: false, message: `Claude execution failed (exit code ${exitCode})`, stderr: stderr.slice(0, 500) });
    }
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Task fix error for ${taskId}: ${msg}`);
    res.status(500).json({ ok: false, message: msg });
  }
});

function buildEpicFixPrompt(epicId, epicName, epicContent, epicFilePath, childTasks) {
  const childTasksList = childTasks
    .map((child) => `  - ${child.id}: ${child.name} (${child._filePath})`)
    .join('\n');

  const childTasksDetails = childTasks
    .map((child) => {
      return `### ${child.id}: ${child.name}
File: ${child._filePath}
Priority: ${child.priority || 'N/A'}
Status: ${child.status || 'N/A'}`;
    })
    .join('\n\n');

  return `You are verifying acceptance criteria for Epic "${epicName}" (${epicId}) and all its child tasks.

**Epic file**: ${epicFilePath}

**Child tasks** (${childTasks.length} total):
${childTasksList}

Your goal is to:
1. For EACH child task, read its file and examine the acceptance criteria
2. Examine the codebase to determine which ACs have been implemented for each child
3. Update EACH child task file to check off (\`- [x]\`) completed ACs
4. Update the Epic file's ACs to reflect overall progress
5. Provide a summary of progress for each child and the Epic

**IMPORTANT**:
- Process ALL child tasks - don't skip any
- Only mark an AC as complete if the code/implementation clearly satisfies it
- If unsure or if implementation is incomplete, leave the AC unchecked
- Use the Edit tool to update each file
- After updating all files, provide a summary (e.g., "Child 1: 3/5 ACs, Child 2: 2/4 ACs, Epic: 5/9 ACs")

**AC Completion Rules**:
- AC is COMPLETE if: code exists, tests pass (if applicable), functionality works as described
- AC is INCOMPLETE if: code is missing, implementation is partial, tests fail, or you're uncertain

**Epic information**:
${childTasksDetails}

**Epic file content**:
\`\`\`markdown
${epicContent}
\`\`\`

Now examine the codebase and update ALL task files (epic + children) with accurate AC completion status.`;
}

function buildFixTaskPrompt(taskId, taskName, taskContent, taskFilePath) {
  return `You are verifying acceptance criteria for task "${taskName}" (${taskId}).

The task file is located at: ${taskFilePath}

Your goal is to:
1. Read the task acceptance criteria (markdown checkboxes: \`- [ ]\` or \`- [x]\`)
2. Examine the codebase to determine which ACs have been implemented
3. Update the task file to check off (\`- [x]\`) any completed ACs
4. Leave unchecked (\`- [ ]\`) any ACs that are not yet implemented

**IMPORTANT**:
- Only mark an AC as complete if the code/implementation clearly satisfies it
- If unsure or if the implementation is incomplete, leave the AC unchecked
- Use the Edit tool to update the task file
- After updating, provide a brief summary (e.g., "3/5 ACs completed")

**AC Completion Rules**:
- AC is COMPLETE if: code exists, tests pass (if applicable), functionality works as described
- AC is INCOMPLETE if: code is missing, implementation is partial, tests fail, or you're uncertain

Current task file content:
\`\`\`markdown
${taskContent}
\`\`\`

Now examine the codebase and update the task file with accurate AC completion status.`;
}

app.post('/api/claude/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const model = req.body?.model || '';

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
    const { reply, workdir } = await runClaudePrompt(message, model);
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
  const defaults = { streamOutput: false, logPrompt: true };

  try {
    const response = await fetch(`${baseUrl}/settings/runtime`, {
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.json(defaults);
      return;
    }

    res.json(payload);
  } catch {
    res.json(defaults);
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

// ── Usage endpoints ────────────────────────────────────────────────────

function getISOWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function readUsageFromDisk() {
  const usagePath = path.join(cwd, '.data', 'usage.json');
  const empty = {
    ok: true,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    taskCount: 0,
    tasks: {}
  };

  try {
    if (!fsSync.existsSync(usagePath)) return empty;
    const raw = fsSync.readFileSync(usagePath, 'utf-8');
    const data = JSON.parse(raw);
    const weekKey = getISOWeekKey(new Date());
    const week = data?.weeks?.[weekKey];
    if (!week) return empty;

    return {
      ok: true,
      weekKey,
      inputTokens: week.inputTokens || 0,
      outputTokens: week.outputTokens || 0,
      cacheCreationInputTokens: week.cacheCreationInputTokens || 0,
      cacheReadInputTokens: week.cacheReadInputTokens || 0,
      totalTokens: week.totalTokens || 0,
      totalCostUsd: week.totalCostUsd || 0,
      taskCount: week.taskCount || 0,
      tasks: week.tasks || {}
    };
  } catch {
    return empty;
  }
}

app.get('/api/usage/weekly', async (_req, res) => {
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/usage/weekly`, {
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.ok) {
      res.json(payload);
      return;
    }
  } catch {
    // API unreachable — fall through to disk read
  }

  res.json(readUsageFromDisk());
});

// ── Git endpoints ──────────────────────────────────────────────────────

function runGitCommand(args, workdir) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: workdir,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const error = new Error(stderr.trim() || `git command failed with exit=${code}`);
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

// git log format: fields separated by RS (\x1E), records separated by GS (\x1D)
// We use %x1E and %x1D as git format placeholders — git outputs the actual bytes.
const GIT_LOG_FORMAT = '--format=%H%x1E%h%x1E%an%x1E%ae%x1E%aI%x1E%s%x1E%b%x1E%D%x1D';
const GIT_FIELD_SEPARATOR = '\x1E';
const GIT_RECORD_SEPARATOR = '\x1D';
const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;
const TASK_ID_REGEX = /\[([A-Z0-9._-]+)\]\s*$/i;
const CO_AUTHORED_CLAUDE_REGEX = /co-authored-by:.*(?:claude|anthropic)/i;

function parseGitCommit(raw) {
  const parts = raw.split(GIT_FIELD_SEPARATOR);
  if (parts.length < 6) return null;

  const [hash, shortHash, authorName, authorEmail, date, subject, body, refsRaw] = parts;
  const trimmedBody = (body || '').trim();

  const isAutomation = CO_AUTHORED_CLAUDE_REGEX.test(trimmedBody);

  let conventional = null;
  const conventionalMatch = subject.match(CONVENTIONAL_COMMIT_REGEX);
  if (conventionalMatch) {
    conventional = {
      type: conventionalMatch[1],
      scope: conventionalMatch[2] || null,
      description: conventionalMatch[3]
    };
  }

  const taskIdMatch = subject.match(TASK_ID_REGEX);

  const refs = refsRaw
    ? refsRaw.split(',').map((r) => r.trim()).filter(Boolean)
    : [];

  return {
    hash,
    shortHash,
    authorName,
    authorEmail,
    date,
    subject,
    body: trimmedBody,
    refs,
    isAutomation,
    conventional,
    taskId: taskIdMatch ? taskIdMatch[1] : null
  };
}

app.get('/api/git/log', async (req, res) => {
  const env = await readEnvPairs();
  const workdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');

  try {
    await fs.access(workdir);
  } catch {
    res.status(400).json({
      ok: false,
      code: 'NO_WORKDIR',
      message: 'CLAUDE_WORKDIR is not configured or the directory does not exist. Configure it in the Setup tab.'
    });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const [logOutput, branchOutput] = await Promise.all([
      runGitCommand(['log', GIT_LOG_FORMAT, `-n`, String(limit), `--skip`, String(offset)], workdir),
      runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workdir)
    ]);

    const records = logOutput
      .split(GIT_RECORD_SEPARATOR)
      .map((r) => r.trim())
      .filter(Boolean);

    const commits = records.map(parseGitCommit).filter(Boolean);
    const branch = branchOutput.trim();

    res.json({ ok: true, commits, branch });
  } catch (error) {
    const msg = error.message || String(error);
    const isNotGit = msg.includes('not a git repository') || msg.includes('fatal:');

    res.status(isNotGit ? 400 : 500).json({
      ok: false,
      code: isNotGit ? 'NOT_GIT_REPO' : 'GIT_ERROR',
      message: isNotGit
        ? 'The configured working directory is not a git repository.'
        : `Git error: ${msg}`
    });
  }
});

app.get('/api/git/diff', async (req, res) => {
  const hash = String(req.query.hash || '').trim();
  if (!hash || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    res.status(400).json({ ok: false, message: 'A valid commit hash is required.' });
    return;
  }

  const env = await readEnvPairs();
  const workdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');

  try {
    const stat = await runGitCommand(['show', '--stat', '--format=', hash], workdir);
    res.json({ ok: true, stat: stat.trim() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || String(error) });
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
  loadLogsFromDisk();
  await ensurePanelBuild();

  // Log Board directory on startup for debugging
  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);
  const claudeWorkdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');

  const server = app.listen(panelPort, () => {
    const url = `http://localhost:${panelPort}`;
    console.log(`✅ Joy UI panel started: ${url}`);
    console.log('ℹ️ Use this panel to configure .env, start app, and watch live logs.');
    console.log(`📁 Board directory: ${boardDir}`);
    console.log(`🔧 Claude working directory: ${claudeWorkdir}`);
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
