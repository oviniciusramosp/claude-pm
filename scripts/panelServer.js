import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { LocalBoardClient } from '../src/local/client.js';
import { isEpicTask, sortCandidates } from '../src/selectTask.js';
import { parseFrontmatter } from '../src/local/frontmatter.js';
import { generateStoryFileName } from '../src/local/helpers.js';
import { configurePassport, getEnabledProviders } from '../src/auth/passport-config.js';
import { generateToken, getCookieOptions } from '../src/auth/jwt.js';
import { requireAuth, optionalAuth } from '../src/auth/middleware.js';
import { isPasskeyEnabled, verifyPasskey, generatePasskeyToken } from '../src/auth/passkey.js';

dotenv.config();

const cwd = process.cwd();
const envFilePath = path.join(cwd, '.env');
const panelDistPath = path.join(cwd, 'panel', 'dist');
const panelPort = Number(process.env.PANEL_PORT || 4100);
const DEFAULT_CLAUDE_COMMAND = 'claude --print';
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
const isPublicMode = process.argv.includes('--public');

// ── Network helpers ────────────────────────────────────────────────────

function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

const tunnelState = {
  child: null,
  url: null,
  status: 'inactive', // inactive | starting | active | error
  error: null
};

function startCloudflaredTunnel() {
  tunnelState.status = 'starting';
  tunnelState.error = null;

  execFile('which', ['cloudflared'], (err) => {
    if (err) {
      tunnelState.status = 'error';
      tunnelState.error = 'cloudflared not found. Install with: brew install cloudflared';
      console.error('❌ cloudflared not found. Install with: brew install cloudflared');
      return;
    }

    const tunnelChild = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${panelPort}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    tunnelState.child = tunnelChild;

    const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

    tunnelChild.stderr.on('data', (data) => {
      const line = data.toString();
      const match = line.match(urlPattern);
      if (match && tunnelState.status !== 'active') {
        tunnelState.url = match[0];
        tunnelState.status = 'active';
        console.log(`🌐 Cloudflare Tunnel active: ${tunnelState.url}`);
        // Reconfigure Passport with tunnel URL for OAuth callbacks
        if (isPublicMode) {
          configurePassport(tunnelState.url);
        }
      }
    });

    tunnelChild.stdout.on('data', (data) => {
      const line = data.toString();
      const match = line.match(urlPattern);
      if (match && tunnelState.status !== 'active') {
        tunnelState.url = match[0];
        tunnelState.status = 'active';
        console.log(`🌐 Cloudflare Tunnel active: ${tunnelState.url}`);
        // Reconfigure Passport with tunnel URL for OAuth callbacks
        if (isPublicMode) {
          configurePassport(tunnelState.url);
        }
      }
    });

    tunnelChild.on('error', (error) => {
      tunnelState.status = 'error';
      tunnelState.error = error.message;
      console.error(`❌ Cloudflare Tunnel error: ${error.message}`);
    });

    tunnelChild.on('close', (code) => {
      if (tunnelState.status === 'active') {
        console.log('🛑 Cloudflare Tunnel closed.');
      }
      tunnelState.child = null;
      tunnelState.url = null;
      tunnelState.status = 'inactive';
    });
  });
}

function stopCloudflaredTunnel() {
  if (tunnelState.child) {
    tunnelState.child.kill('SIGTERM');
    tunnelState.child = null;
    tunnelState.url = null;
    tunnelState.status = 'inactive';
  }
}

const state = {
  api: {
    child: null,
    status: 'stopped',
    startedAt: null,
    pid: null
  },
  fixTasks: new Map() // taskId -> { status: 'running'|'success'|'failed', startedAt: ISO string, error?: string }
};

const claudeChatState = {
  running: false
};
const reviewTaskState = {
  running: false
};
const generateStoriesState = {
  running: false
};
const fixEpicStoriesState = {
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
  /^Server started on port \d+$/i
];

// Patterns that identify startup-phase log messages to be collapsed into a
// single "Automation App started." bubble with expandable details.
const STARTUP_LOG_PATTERNS = [
  /^Board directory:/i,
  /^Claude working directory:/i,
  /^Board structure validated successfully$/i,
  /^CLAUDE\.md managed section/i,
  /^Created CLAUDE\.md/i,
  /^Updated CLAUDE\.md/i,
  /^Appended managed section/i,
  /^Periodic reconciliation (enabled|disabled)/i,
  /^Automatic reconciliation/i,
  /^Startup reconciliation disabled/i,
  /^\[VALIDATION_REPORT\]/i,
];
const STARTUP_BUFFER_WINDOW_MS = 3000;
const CLAUDE_RAW_NOISE_PATTERNS = [
  /you(?:'|’)ve hit your limit/i,
  /hit your limit/i
];

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(passport.initialize());

// Configure Passport with OAuth strategies (only in public mode)
if (isPublicMode) {
  // Note: callbackBaseUrl will be updated once tunnel URL is available
  const callbackBaseUrl = `http://localhost:${panelPort}`;
  configurePassport(callbackBaseUrl);
}

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many authentication attempts, please try again later'
});

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
    const fullMessage = String(loggerMatch[2] || '')
      .replace(LOGGER_TIMESTAMP_SUFFIX_REGEX, '')
      .trim();

    // Extract metadata from message format: "message | key=value | key=value"
    const parts = fullMessage.split('|').map(p => p.trim());
    const parsedMessage = parts[0] || clean;
    const meta = {};

    // Parse key=value pairs from remaining parts
    for (let i = 1; i < parts.length; i++) {
      const pair = parts[i];
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        const key = pair.slice(0, eqIndex).trim();
        let value = pair.slice(eqIndex + 1).trim();

        // Try to parse JSON values
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value === 'null') value = null;
        else if (/^\d+$/.test(value)) value = Number(value);
        else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        meta[key] = value;
      }
    }

    return {
      level: parsedLevel,
      message: parsedMessage,
      fromLogger: true,
      ...(Object.keys(meta).length > 0 && { meta })
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

function buildProcessStopLog(source, code, signal, debugInfo = {}) {
  const name = processDisplayName(source);
  const normalizedSignal = String(signal || '').toUpperCase();
  const expectedSignals = new Set(['SIGTERM', 'SIGINT']);
  const isExpectedStop = code === 0 || expectedSignals.has(normalizedSignal);

  // Build reason label from caller context
  const reasonLabel = debugInfo.caller ? ` (triggered by: ${debugInfo.caller})` : '';

  if (isExpectedStop) {
    return {
      level: 'info',
      message: `${name} stopped${reasonLabel}.`,
      caller: debugInfo.caller
    };
  }

  const exitCode = code === null || code === undefined ? 'unknown' : String(code);
  const signalLabel = signal ? `, signal: ${signal}` : '';

  return {
    level: 'error',
    message: `${name} stopped unexpectedly (exit code: ${exitCode}${signalLabel})${reasonLabel}.`,
    exitCode,
    signal,
    stderr: debugInfo.stderr,
    stdout: debugInfo.stdout,
    caller: debugInfo.caller
  };
}

function createProcessLogForwarder({ fallbackLevel = 'info', onLog }) {
  const safeOnLog = typeof onLog === 'function' ? onLog : () => {};
  let activePromptBlock = null;

  // Buffer for unstructured lines (e.g. Node.js stack traces on stderr).
  // Lines arriving within UNSTRUCTURED_DEBOUNCE_MS of each other are grouped
  // into a single log message instead of producing one bubble per line.
  const UNSTRUCTURED_DEBOUNCE_MS = 150;
  let unstructuredBuffer = [];
  let unstructuredTimer = null;
  let unstructuredLevel = null;

  function flushUnstructuredBuffer() {
    if (unstructuredTimer) {
      clearTimeout(unstructuredTimer);
      unstructuredTimer = null;
    }
    if (unstructuredBuffer.length === 0) {
      return;
    }
    const joined = unstructuredBuffer.join('\n');
    const level = unstructuredLevel || normalizeUiLogLevel(fallbackLevel);
    unstructuredBuffer = [];
    unstructuredLevel = null;
    safeOnLog({ level, message: joined, fromLogger: false });
  }

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
      flushUnstructuredBuffer();
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

    // Structured lines (from our logger, AC markers, progress markers) are
    // emitted immediately — flush any pending unstructured buffer first.
    if (parsed.fromLogger || parsed.isAcComplete || parsed.isToolUse) {
      flushUnstructuredBuffer();
      safeOnLog(parsed);
      return;
    }

    // Unstructured lines: buffer and debounce so multi-line output (like
    // stack traces) is emitted as a single log message.
    if (!unstructuredLevel) {
      unstructuredLevel = parsed.level;
    }
    unstructuredBuffer.push(parsed.message);
    if (unstructuredTimer) {
      clearTimeout(unstructuredTimer);
    }
    unstructuredTimer = setTimeout(flushUnstructuredBuffer, UNSTRUCTURED_DEBOUNCE_MS);
  }

  return {
    handleLine,
    flush() {
      flushUnstructuredBuffer();
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

  function buildLogExtra(parsed) {
    if (parsed.isPrompt) return { isPrompt: true, promptTitle: parsed.promptTitle };
    if (parsed.isAcComplete) return { isAcComplete: true };
    if (parsed.isToolUse) return { isToolUse: true };
    return undefined;
  }

  // Startup log collector: buffers startup-phase messages and emits them as a
  // single "Automation App started." bubble with collapsible detail lines.
  const startupCollector = {
    buffer: [],
    timer: null,
    flushed: false,

    isStartupMessage(message) {
      const clean = String(message || '').trim();
      return STARTUP_LOG_PATTERNS.some((pattern) => pattern.test(clean));
    },

    flush() {
      if (this.flushed) return;
      this.flushed = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const extra = this.buffer.length > 0
        ? { meta: { collapsibleLines: this.buffer } }
        : undefined;
      pushLog('success', source, `${processDisplayName(source)} started.`, extra);
    },

    resetTimer() {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => this.flush(), STARTUP_BUFFER_WINDOW_MS);
    },

    /** Returns true if the message was consumed (buffered or triggered flush). */
    handle(parsed) {
      if (this.flushed) return false;

      if (this.isStartupMessage(parsed.message)) {
        this.buffer.push({ level: parsed.level, text: parsed.message });
        this.resetTimer();
        return true;
      }

      // Non-startup message arrived — flush the startup bubble first, then let
      // the caller emit the non-startup message normally.
      this.flush();
      return false;
    }
  };

  function forwardLog(parsed) {
    if (shouldSuppressProcessMessage(source, parsed.message)) {
      return;
    }
    if (startupCollector.handle(parsed)) {
      return;
    }
    pushLog(parsed.level, resolveProcessLogSource(source, parsed), parsed.message, buildLogExtra(parsed));
  }

  // Capture output buffers for debugging (last 5000 chars of each stream)
  const outputBuffers = { stdout: [], stderr: [] };
  const MAX_DEBUG_BUFFER_CHARS = 5000;

  const stdoutForwarder = createProcessLogForwarder({
    fallbackLevel: 'info',
    onLog: forwardLog
  });

  const stderrForwarder = createProcessLogForwarder({
    fallbackLevel: 'warn',
    onLog: forwardLog
  });

  const stdoutReader = readLines(child.stdout, (line) => {
    // Buffer output for debug info
    outputBuffers.stdout.push(line);
    const totalChars = outputBuffers.stdout.reduce((sum, l) => sum + l.length, 0);
    if (totalChars > MAX_DEBUG_BUFFER_CHARS) {
      outputBuffers.stdout.shift();
    }
    stdoutForwarder.handleLine(line);
  });

  const stderrReader = readLines(child.stderr, (line) => {
    // Buffer output for debug info
    outputBuffers.stderr.push(line);
    const totalChars = outputBuffers.stderr.reduce((sum, l) => sum + l.length, 0);
    if (totalChars > MAX_DEBUG_BUFFER_CHARS) {
      outputBuffers.stderr.shift();
    }
    stderrForwarder.handleLine(line);
  });

  child.on('close', (code, signal) => {
    stdoutForwarder.flush();
    stderrForwarder.flush();
    startupCollector.flush();
    stdoutReader.close();
    stderrReader.close();

    const debugInfo = {
      stdout: outputBuffers.stdout.join('\n').trim(),
      stderr: outputBuffers.stderr.join('\n').trim(),
      caller: target.stopCaller || 'process-exit'
    };

    const stopLog = buildProcessStopLog(source, code, signal, debugInfo);
    pushLog(stopLog.level, source, stopLog.message, {
      exitCode: stopLog.exitCode,
      signal: stopLog.signal,
      stderr: stopLog.stderr,
      stdout: stopLog.stdout,
      caller: stopLog.caller
    });
    target.child = null;
    target.status = 'stopped';
    target.startedAt = null;
    target.pid = null;
    target.stopCaller = null; // Clear caller after use
  });

  child.on('error', (error) => {
    pushLog('error', source, `Process error: ${error.message}`, {
      stack: error.stack
    });
  });

  return true;
}

function stopManagedProcess(target, source, caller = 'unknown') {
  if (!target.child) {
    return false;
  }

  pushLog('info', source, `Stopping process (triggered by: ${caller})...`);

  // Store caller in target so it's available in the 'close' event handler
  target.stopCaller = caller;

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
  stopManagedProcess(target, source, 'restart-operation');
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
    CLAUDE_COMMAND: DEFAULT_CLAUDE_COMMAND
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
  let command = DEFAULT_CLAUDE_COMMAND;

  if (envEnabled(process.env.CLAUDE_FULL_ACCESS, false) && !command.includes('--dangerously-skip-permissions')) {
    command = `${command} --dangerously-skip-permissions`;
  }

  if (model && model.trim()) {
    command = `${command} --model ${model.trim()}`;
  }

  return command;
}

async function runClaudePromptViaApi(prompt, model) {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    throw new Error('CLAUDE_CODE_OAUTH_TOKEN is required to use Anthropic API directly');
  }

  const workdir = path.resolve(cwd, process.env.CLAUDE_WORKDIR || '.');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const reply = data.content?.[0]?.text || '';

  return {
    reply: reply.trim(),
    workdir
  };
}

function runClaudePrompt(prompt, model, customTimeoutMs) {
  return new Promise((resolve, reject) => {
    const command = buildClaudePromptCommand(model);
    const workdir = path.resolve(cwd, process.env.CLAUDE_WORKDIR || '.');
    const timeoutMs = customTimeoutMs || resolveClaudeTimeoutMs();
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

// ── Auth Routes ────────────────────────────────────────────────────

// OAuth initiation
app.get('/auth/login/:provider', authLimiter, (req, res, next) => {
  const { provider } = req.params;
  const enabledProviders = getEnabledProviders();

  if (!enabledProviders.includes(provider)) {
    return res.status(400).json({ error: `Provider ${provider} is not configured` });
  }

  passport.authenticate(provider, { session: false })(req, res, next);
});

// GitHub OAuth callback
app.get('/auth/github/callback', authLimiter, passport.authenticate('github', { session: false }), (req, res) => {
  const token = generateToken(req.user);
  res.cookie('pm_auth_token', token, getCookieOptions());

  // Redirect to original requested page or default to /panel/feed
  const returnTo = req.query.state || '/panel/feed';
  const safeReturnTo = returnTo.startsWith('/panel/') ? returnTo : '/panel/feed';
  res.redirect(safeReturnTo);
});

// Google OAuth callback
app.get('/auth/google/callback', authLimiter, passport.authenticate('google', { session: false }), (req, res) => {
  const token = generateToken(req.user);
  res.cookie('pm_auth_token', token, getCookieOptions());

  // Redirect to original requested page or default to /panel/feed
  const returnTo = req.query.state || '/panel/feed';
  const safeReturnTo = returnTo.startsWith('/panel/') ? returnTo : '/panel/feed';
  res.redirect(safeReturnTo);
});

// Passkey login
app.post('/auth/passkey', authLimiter, (req, res) => {
  const { passkey } = req.body;

  if (!passkey) {
    return res.status(400).json({ error: 'Passkey is required' });
  }

  if (!verifyPasskey(passkey)) {
    return res.status(401).json({ error: 'Invalid passkey' });
  }

  const token = generatePasskeyToken();
  res.cookie('pm_auth_token', token, getCookieOptions());
  res.json({ success: true });
});

// Logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('pm_auth_token');
  res.json({ success: true });
});

// Current user info
app.get('/api/auth/user', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, user: req.user });
});

// Available auth providers and methods
app.get('/api/auth/providers', (_req, res) => {
  res.json({
    providers: getEnabledProviders(),
    passkeyEnabled: isPasskeyEnabled()
  });
});

// ── Server Info & API Routes ───────────────────────────────────────

app.get('/api/server/info', (_req, res) => {
  const lanIp = getLocalNetworkIp();
  res.json({
    localUrl: `http://localhost:${panelPort}`,
    lanUrl: lanIp ? `http://${lanIp}:${panelPort}` : null,
    tunnelUrl: tunnelState.url,
    tunnelStatus: tunnelState.status,
    tunnelError: tunnelState.error,
    isPublicMode,
    authEnabled: isPublicMode,
    authProviders: isPublicMode ? getEnabledProviders() : []
  });
});

// Protect all /api/* routes (except /api/auth/* which handle their own auth)
app.use('/api', (req, res, next) => {
  // Skip auth check for auth-related endpoints
  if (req.path.startsWith('/auth/') || req.path === '/server/info') {
    return next();
  }

  // Apply auth middleware
  requireAuth(isPublicMode)(req, res, next);
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
      CLAUDE_COMMAND: DEFAULT_CLAUDE_COMMAND,
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
    CLAUDE_COMMAND: DEFAULT_CLAUDE_COMMAND
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

app.post('/api/process/api/start', async (req, res) => {
  if (state.api.child) {
    res.status(409).json({ ok: false, message: 'API process already running' });
    return;
  }

  const apiBaseUrl = getApiBaseUrl();
  const health = await probeApiHealth(apiBaseUrl);

  if (health.ok) {
    pushLog('warn', LOG_SOURCE.panel, `Port already in use — an API is already running at ${apiBaseUrl}. Stop it first or use that instance.`);
    res.status(409).json({ ok: false, message: `Port already in use. An API is already running at ${apiBaseUrl}.` });
    return;
  }

  const command = process.env.PANEL_API_START_COMMAND || 'npm start';
  const started = startManagedProcess(state.api, command, 'api', getApiProcessEnvOverrides());

  if (!started) {
    res.status(409).json({ ok: false, message: 'API process already running' });
    return;
  }

  res.json({ ok: true });
});

app.post('/api/process/api/stop', (req, res) => {
  const stopped = stopManagedProcess(state.api, 'api', 'panel-stop-button');
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
    pushLog('error', LOG_SOURCE.panel, `Manual run error: ${error.message}`, {
      stack: error.stack
    });
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

app.post('/api/automation/pause', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    await ensureApiRunning();
    const response = await fetch(`${baseUrl}/pause`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Pause failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Orchestrator paused successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Pause error: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/automation/unpause', async (_req, res) => {
  const baseUrl = getApiBaseUrl();
  try {
    await ensureApiRunning();
    const response = await fetch(`${baseUrl}/unpause`, {
      method: 'POST',
      headers: getAutomationHeaders()
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pushLog('warn', LOG_SOURCE.panel, `Unpause failed (${response.status})`);
      res.status(response.status).json({ ok: false, payload });
      return;
    }

    pushLog('success', LOG_SOURCE.panel, 'Orchestrator unpaused successfully');
    res.json({ ok: true, payload });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Unpause error: ${error.message}`);
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

app.get('/api/board/fix-status', (_req, res) => {
  // Return current fix status for all tasks being fixed
  const fixStatus = {};
  for (const [taskId, status] of state.fixTasks.entries()) {
    fixStatus[taskId] = status;
  }
  res.json({ ok: true, fixStatus });
});

app.get('/api/board/has-active-fixes', (_req, res) => {
  // Check if any AC fix operation is currently running
  let hasActive = false;
  for (const [, status] of state.fixTasks.entries()) {
    if (status.status === 'running') {
      hasActive = true;
      break;
    }
  }
  res.json({ hasActiveFixes: hasActive });
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

app.get('/validate-board', async (_req, res) => {
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

    const errors = [];
    const warnings = [];
    let tasksWithoutStatus = 0;
    let tasksWithInvalidStatus = 0;

    const validStatuses = [
      boardConfig.board.statuses.notStarted,
      boardConfig.board.statuses.inProgress,
      boardConfig.board.statuses.done
    ];

    for (const task of tasks) {
      if (!task.status) {
        tasksWithoutStatus++;
        errors.push({
          type: 'missing_status',
          message: `Task "${task.name}" (${task.id}) is missing a status field`,
          severity: 'error',
          suggestion: 'Add a status field to the frontmatter',
          path: task.url
        });
      } else if (!validStatuses.includes(task.status)) {
        tasksWithInvalidStatus++;
        errors.push({
          type: 'invalid_status',
          message: `Task "${task.name}" (${task.id}) has invalid status: "${task.status}"`,
          severity: 'error',
          suggestion: `Use one of: ${validStatuses.join(', ')}`,
          path: task.url
        });
      }
    }

    const epics = tasks.filter((t) => isEpicTask(t, tasks, boardConfig));

    res.json({
      valid: errors.length === 0,
      errors,
      warnings,
      info: {
        totalTasks: tasks.length,
        totalEpics: epics.length,
        tasksWithoutStatus,
        tasksWithInvalidStatus
      }
    });
  } catch (error) {
    const msg = error.message || String(error);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/board/exists', async (_req, res) => {
  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);

  try {
    const stat = await fs.stat(boardDir);
    res.json({ ok: true, exists: stat.isDirectory(), boardDir });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({ ok: true, exists: false, boardDir });
    } else {
      res.status(500).json({ ok: false, message: error.message });
    }
  }
});

app.post('/api/board/create-directory', async (_req, res) => {
  const env = await readEnvPairs();
  const boardDir = resolveBoardDir(env);

  try {
    await fs.mkdir(boardDir, { recursive: true });
    pushLog('info', LOG_SOURCE.panel, `Board directory created: ${boardDir}`);
    res.json({ ok: true, boardDir });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Failed to create Board directory: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
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

  // Check if this task is already being fixed
  if (state.fixTasks.has(taskId)) {
    const existingStatus = state.fixTasks.get(taskId);
    if (existingStatus.status === 'running') {
      res.status(409).json({ ok: false, message: `Task ${taskId} is already being fixed` });
      return;
    }
  }

  // Mark task as being fixed
  state.fixTasks.set(taskId, {
    status: 'running',
    startedAt: new Date().toISOString()
  });

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
    let command = env.CLAUDE_COMMAND || DEFAULT_CLAUDE_COMMAND;

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

    // Add timeout for Claude execution (5 minutes for AC fix)
    const AC_FIX_TIMEOUT_MS = 300000; // 5 minutes
    let timeoutId;
    let timedOut = false;

    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);

      timeoutId = setTimeout(() => {
        timedOut = true;
        pushLog('error', LOG_SOURCE.panel, `Task fix timeout for ${taskId} (${AC_FIX_TIMEOUT_MS}ms exceeded)`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, AC_FIX_TIMEOUT_MS);
    });

    clearTimeout(timeoutId);

    if (timedOut) {
      const errorMsg = `Task fix timed out after ${AC_FIX_TIMEOUT_MS / 1000}s`;
      pushLog('error', LOG_SOURCE.panel, `${errorMsg}: ${taskId}`);

      // Mark task as failed
      state.fixTasks.set(taskId, {
        status: 'failed',
        startedAt: state.fixTasks.get(taskId)?.startedAt,
        completedAt: new Date().toISOString(),
        error: errorMsg
      });

      res.status(504).json({ ok: false, message: errorMsg });
      return;
    }

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

        // Mark task as successfully fixed
        state.fixTasks.set(taskId, {
          status: 'success',
          startedAt: state.fixTasks.get(taskId)?.startedAt,
          completedAt: new Date().toISOString()
        });

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

        // Mark task as successfully fixed
        state.fixTasks.set(taskId, {
          status: 'success',
          startedAt: state.fixTasks.get(taskId)?.startedAt,
          completedAt: new Date().toISOString()
        });

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
      const errorMsg = `Claude execution failed (exit code ${exitCode})`;
      pushLog('error', LOG_SOURCE.panel, `Task fix failed for ${taskId} (exit code ${exitCode}): ${stderr.slice(0, 200)}`);

      // Mark task as failed
      state.fixTasks.set(taskId, {
        status: 'failed',
        startedAt: state.fixTasks.get(taskId)?.startedAt,
        completedAt: new Date().toISOString(),
        error: errorMsg
      });

      res.status(500).json({ ok: false, message: errorMsg, stderr: stderr.slice(0, 500) });
    }
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Task fix error for ${taskId}: ${msg}`, {
      stack: error.stack,
      exitCode: error.exitCode,
      stderr: error.stderr
    });

    // Mark task as failed
    state.fixTasks.set(taskId, {
      status: 'failed',
      startedAt: state.fixTasks.get(taskId)?.startedAt,
      completedAt: new Date().toISOString(),
      error: msg
    });

    res.status(500).json({ ok: false, message: msg });
  }
});

app.post('/api/board/update-status', async (req, res) => {
  const { taskId, status } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ ok: false, message: 'taskId is required' });
    return;
  }

  if (!status || typeof status !== 'string') {
    res.status(400).json({ ok: false, message: 'status is required' });
    return;
  }

  // Validate status value
  const validStatuses = ['Not Started', 'In Progress', 'Done'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ ok: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  pushLog('info', LOG_SOURCE.panel, `Updating task status: ${taskId} → ${status}`);

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
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      pushLog('error', LOG_SOURCE.panel, `Task not found: ${taskId}`);
      res.status(404).json({ ok: false, message: `Task not found: ${taskId}` });
      return;
    }

    // Update task status
    await client.updateTaskStatus(taskId, status);
    pushLog('success', LOG_SOURCE.panel, `Task status updated: ${taskId} → ${status}`);

    res.json({
      ok: true,
      taskId,
      status,
      message: `Task status updated to "${status}"`
    });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Failed to update task status for ${taskId}: ${msg}`, {
      stack: error.stack
    });

    res.status(500).json({ ok: false, message: msg });
  }
});

// --- Save task markdown content ---
app.post('/api/board/task-markdown', async (req, res) => {
  const { taskId, content } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ ok: false, message: 'taskId is required' });
    return;
  }

  if (content === undefined || content === null || typeof content !== 'string') {
    res.status(400).json({ ok: false, message: 'content is required' });
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
    await client.writeTaskMarkdown(taskId, content);
    pushLog('success', LOG_SOURCE.panel, `Task file updated: ${taskId}`);
    res.json({ ok: true, taskId });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Failed to save task markdown for ${taskId}: ${msg}`);
    const status = msg.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, message: msg });
  }
});

// --- Delete task ---
app.delete('/api/board/task', async (req, res) => {
  const { taskId, deleteEpicFolder } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ ok: false, message: 'taskId is required' });
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
    const deleted = await client.deleteTask(taskId, { deleteEpicFolder: !!deleteEpicFolder });
    pushLog('success', LOG_SOURCE.panel, `Task deleted: ${taskId}`);
    res.json({ ok: true, taskId, deleted });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Failed to delete task ${taskId}: ${msg}`);
    const status = msg.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, message: msg });
  }
});

// --- Create new task ---
app.post('/api/board/create-task', async (req, res) => {
  const { name, priority, type, status, model, agents, body, fileName, epicId } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ ok: false, message: 'name is required' });
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
    const result = await client.createTask(
      { name: name.trim(), priority, type, status, model, agents },
      body || '',
      { epicId: epicId || null, fileName: fileName || null }
    );
    pushLog('success', LOG_SOURCE.panel, `Task created: ${result.taskId}`);
    res.json({ ok: true, taskId: result.taskId, filePath: result.filePath });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Failed to create task: ${msg}`);
    const status = msg.includes('already exists') ? 409 : 500;
    res.status(status).json({ ok: false, message: msg });
  }
});

// --- List epic folders ---
app.get('/api/board/epic-folders', async (_req, res) => {
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
    const folders = await client.listEpicFolders();
    res.json({ ok: true, folders });
  } catch (error) {
    const msg = error.message || String(error);
    res.status(500).json({ ok: false, message: msg });
  }
});

// --- Next available numbers for auto-naming ---
app.get('/api/board/next-numbers', async (_req, res) => {
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
    const numbers = await client.getNextNumbers();
    res.json({ ok: true, ...numbers });
  } catch (error) {
    const msg = error.message || String(error);
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
  const model = req.body?.model || 'claude-sonnet-4-5-20250929';

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
    // Use Anthropic API directly to avoid "Claude Code cannot be launched inside another Claude Code session" error
    const { reply, workdir } = await runClaudePromptViaApi(message, model);
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

// ── Review Task with Claude ───────────────────────────────────────────

function buildReviewTaskPrompt({ name, priority, type, status, model, agents, body }) {
  const taskType = type || 'UserStory';
  const taskPriority = priority || 'P1';
  const taskModel = model || '(default)';
  const taskAgents = agents || '(none)';

  const metadataBlock = `<task_metadata>
- Name: ${name}
- Type: ${taskType}
- Priority: ${taskPriority}
- Status: ${status || 'Not Started'}
- Model: ${taskModel}
- Agents: ${taskAgents}
</task_metadata>

<current_task_body>
${body}
</current_task_body>`;

  const outputFormatBlock = `<output_format>
Return your response as a JSON object with this exact structure:

{"improvedBody": "The complete improved markdown body (everything after the YAML frontmatter). Use \\n for newlines.", "summary": "A 1-2 sentence summary of what was improved"}

IMPORTANT:
- Return ONLY the JSON object, no markdown code blocks around it
- The "improvedBody" must be the complete task body — do not omit sections
- Preserve any existing content that is already good
- Do not invent content unrelated to the task
- Keep the same task intent and scope — improve quality, not scope
- Use literal \\n for newlines inside the JSON string values
</output_format>`;

  // ── Epic-specific prompt ──────────────────────────────────────────────
  if (taskType === 'Epic') {
    return `You are an expert product manager reviewing an **Epic** definition for a Claude Code automation system.

<context>
This Epic will NOT be executed directly by Claude. Instead, it serves as a **parent container** that defines a high-level business goal. Child User Stories will be generated from this Epic and those stories will be executed individually by Claude Code.

The Epic must be written at the RIGHT level of abstraction:
- HIGH ENOUGH to describe business outcomes, not implementation details
- DETAILED ENOUGH to generate meaningful User Stories from it
</context>

${metadataBlock}

<review_instructions>
Review this Epic and produce an improved version. The output MUST follow the **Epic format** (NOT a User Story format).

**REQUIRED SECTIONS** (in this exact order):

1. **# [Epic Name] Epic** (h1 header)
   - Use the format: "# [Name] Epic"

2. **Epic Goal** (bold paragraph, NOT a section header)
   - One paragraph starting with "**Epic Goal**:" that describes the high-level business objective
   - Focus on WHAT will be delivered and WHY, not HOW
   - Example: "**Epic Goal**: Build a complete authentication system that allows users to securely create accounts, log in, and manage their sessions."

3. **## Scope**
   - Bullet list of what this Epic includes
   - Each bullet is a capability or feature area (NOT a technical task)
   - Example: "- User login with email/password" (NOT "- Create LoginForm.tsx component")

4. **## Acceptance Criteria**
   - Each AC must be a markdown checkbox: \`- [ ] Description\`
   - **CRITICAL**: ACs must describe business outcomes and user-visible results
   - DO NOT include technical details (file names, function names, component names, code patterns)
   - DO NOT write ACs that sound like unit tests or implementation steps
   - Good: "- [ ] Users can log in with valid credentials"
   - Bad: "- [ ] Login form component renders with email and password fields"
   - Good: "- [ ] Error messages are shown for invalid inputs"
   - Bad: "- [ ] Form validates email format using regex"
   - Typically 3-7 ACs for an Epic

5. **## Technical Approach**
   - Bullet list of high-level architectural decisions and technology choices
   - This guides the child stories but does NOT prescribe implementation
   - Example: "- Use JWT tokens for authentication" or "- Store state in React Context"
   - NO file paths, NO function signatures, NO code snippets

6. **## Dependencies**
   - List prerequisites, external services, or blocking items
   - Or "- None" if standalone

7. **## Child Tasks**
   - Always end with: "See individual user story files in this Epic folder."
   - This section is a placeholder — child stories are generated separately

**SECTIONS TO NEVER INCLUDE IN AN EPIC:**
- ❌ "User Story" / "As a [role], I want..." (that's for child stories)
- ❌ "Technical Tasks" with numbered implementation steps
- ❌ "Tests" with specific test files or test cases
- ❌ "Standard Completion Criteria" with build/lint/commit checks
- ❌ File paths, component names, or code references in ACs
</review_instructions>

${outputFormatBlock}`;
  }

  // ── Non-Epic prompt (UserStory, Bug, Chore, Discovery) ────────────────
  const descriptionGuidance = {
    UserStory: '- Start with: "**User Story**: As a [role], I want [goal] so that [benefit]"',
    Bug: '- Start with "**Bug**:" followed by a description of what happens\n   - Include: actual behavior, expected behavior, and reproduction steps',
    Chore: '- Describe the operational goal clearly and concisely',
    Discovery: '- Frame the research question or investigation goal\n   - Describe what decisions depend on the outcome'
  };

  const acGuidance = {
    UserStory: `   - Focus on specific, testable behaviors and technical requirements
   - Each AC must be concrete and verifiable through code, tests, or manual inspection
   - Include UI behavior, data validation, error handling, and edge cases
   - Reference specific elements when applicable (e.g., "Submit button is disabled when form is invalid")
   - ACs should guide implementation directly
   - Typically 4-10 ACs for a UserStory`,

    Bug: `   - First AC: describe the expected behavior after the fix
   - Additional ACs: edge cases, related scenarios that must still work
   - Include regression test requirements
   - Typically 3-6 ACs for a Bug`,

    Chore: `   - Focus on operational outcomes and verification steps
   - Each AC describes a successful completion criterion
   - Include verification steps (e.g., "Build passes without warnings")
   - Typically 2-5 ACs for a Chore`,

    Discovery: `   - Focus on research outcomes and documentation deliverables
   - Each AC describes a specific question answered or artifact produced
   - Include documentation requirements (e.g., "Decision document created with findings")
   - Typically 3-6 ACs for a Discovery task`
  };

  return `You are an expert prompt engineer and product manager reviewing a ${taskType} for a Claude Code automation system.

<context>
This task will be executed by Claude Code (an AI coding assistant). Claude reads the task file, follows the instructions, implements the acceptance criteria, and reports completion via JSON. The quality of the task file directly determines execution success.
</context>

${metadataBlock}

<review_instructions>
Review this ${taskType} and produce an improved version. Follow these quality criteria:

1. **Task Description**:
   ${descriptionGuidance[taskType] || descriptionGuidance.UserStory}

2. **Acceptance Criteria Quality**:
   - Each AC must be a markdown checkbox: \`- [ ] Description\`
   - Each AC must be testable, specific, and unambiguous
   - Avoid vague ACs like "works correctly" — specify exact behavior
${acGuidance[taskType] || acGuidance.UserStory}

3. **Technical Tasks Section**:
   - Break implementation into numbered, sequential steps
   - Reference specific file paths when possible (e.g., "Create \`src/components/LoginForm.tsx\`")
   - Each step should be actionable by Claude Code
   - Include command-line steps when relevant (e.g., "Run \`npm install react-hook-form\`")

4. **Tests Section**:
   - Specify test file path (e.g., "\`__tests__/LoginForm.test.tsx\`")
   - List specific test cases to write
   - Include edge case tests
   - For infrastructure/chore tasks, state "N/A — no business logic to test"

5. **Dependencies Section**:
   - List any prerequisites or blocking tasks
   - Mention required APIs, packages, or configuration
   - State "None" if there are no dependencies

6. **Standard Completion Criteria**:
   - Include checkboxes for: tests passing, TypeScript compilation, linting
   - Include a commit message suggestion following conventional commits: \`feat|fix|chore(scope): description\`

7. **Prompt Optimization for Claude Code**:
   - Instructions must be explicit — Claude Code executes literally
   - Avoid ambiguous language ("consider", "maybe", "if possible")
   - Use imperative language ("Create", "Add", "Implement", "Run")
   - Structure content with clear markdown headers (##)
   - If the task involves modifying existing files, specify which files and what changes
</review_instructions>

${outputFormatBlock}`;
}

function normalizeMarkdownNewlines(text) {
  // Replace literal \n (two-char sequence from double-escaped JSON) with real newlines
  // Only replace when the string contains literal \n but no real newlines (sign of double-escaping)
  if (typeof text !== 'string') return text;
  const hasRealNewlines = text.includes('\n');
  const hasLiteralEscapes = text.includes('\\n');
  if (!hasRealNewlines && hasLiteralEscapes) {
    return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  return text;
}

function looksLikeJson(text) {
  const trimmed = (text || '').trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function extractMarkdownFromRawJson(text) {
  // Last resort: if Claude returned JSON but we couldn't parse the field,
  // try to find anything that looks like markdown inside the string
  try {
    const parsed = JSON.parse(text);
    // Walk all string values looking for one with markdown markers
    const candidates = Object.values(parsed).filter(
      (v) => typeof v === 'string' && v.length > 50
    );
    // Prefer one with markdown headers or checkboxes
    const best = candidates.find((v) => /^#|## |^\- \[/m.test(v));
    if (best) return normalizeMarkdownNewlines(best);
    // Fall back to longest string value
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length);
      return normalizeMarkdownNewlines(candidates[0]);
    }
  } catch { /* not valid JSON after all */ }
  return null;
}

function parseReviewResponse(reply) {
  const text = String(reply || '').trim();

  // Try to extract JSON from the response (may be wrapped in code blocks)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  try {
    const parsed = JSON.parse(jsonStr);
    const rawBody = parsed.improvedBody || parsed.improved_body;

    if (rawBody && typeof rawBody === 'string') {
      return {
        improvedBody: normalizeMarkdownNewlines(rawBody),
        summary: parsed.summary || 'Review completed'
      };
    }

    // JSON parsed but no improvedBody field — try to extract markdown from other fields
    const extracted = extractMarkdownFromRawJson(jsonStr);
    if (extracted) {
      return {
        improvedBody: extracted,
        summary: parsed.summary || 'Review completed'
      };
    }

    // Nothing usable found in the JSON
    throw new Error('Response JSON has no improvedBody field');
  } catch {
    // If the raw text looks like JSON, try to extract markdown from it
    if (looksLikeJson(text)) {
      const extracted = extractMarkdownFromRawJson(text);
      if (extracted) {
        return {
          improvedBody: extracted,
          summary: 'Review completed'
        };
      }
      // JSON but no extractable markdown — reject it
      throw new Error('Claude returned JSON instead of the expected review format. Please try again.');
    }

    // Raw text is not JSON — use it directly as markdown
    return {
      improvedBody: normalizeMarkdownNewlines(text),
      summary: 'Review completed (raw response)'
    };
  }
}

const REVIEW_TIMEOUT_MS = 120000; // 2 minutes

app.post('/api/board/review-task', async (req, res) => {
  const { name, priority, type, status, model, agents, body, reviewModel } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ ok: false, message: 'Task name is required for review.' });
    return;
  }

  if (!body || typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ ok: false, message: 'Task body is required for review.' });
    return;
  }

  if (reviewTaskState.running) {
    res.status(409).json({ ok: false, message: 'A review is already in progress. Please wait.' });
    return;
  }

  reviewTaskState.running = true;
  pushLog('info', LOG_SOURCE.panel, `Task review requested: "${name.trim()}"`);

  try {
    const prompt = buildReviewTaskPrompt({ name: name.trim(), priority, type, status, model, agents, body: body.trim() });
    const selectedModel = reviewModel || 'claude-sonnet-4-5-20250929';
    const { reply } = await runClaudePrompt(prompt, selectedModel, REVIEW_TIMEOUT_MS);
    const parsed = parseReviewResponse(reply);

    pushLog('success', LOG_SOURCE.claude, `Task review completed: "${name.trim()}" — ${parsed.summary}`);
    res.json({ ok: true, improvedBody: parsed.improvedBody, summary: parsed.summary });
  } catch (error) {
    pushLog('error', LOG_SOURCE.claude, `Task review failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    reviewTaskState.running = false;
  }
});

// --- Generate Stories from Epic ---

const GENERATE_STORIES_TIMEOUT_MS = 180000; // 3 minutes

function buildGenerateStoriesPrompt({ epicName, epicBody, existingChildren }) {
  const childList = existingChildren.length > 0
    ? existingChildren.map((c) => `- ${c.name}`).join('\n')
    : '(none)';

  return `You are a senior product manager and prompt engineering expert. Your job is to analyze an Epic description and break it down into concrete, actionable user stories.

<epic>
<name>${epicName}</name>
<body>
${epicBody}
</body>
</epic>

<existing_children>
${childList}
</existing_children>

<instructions>
1. Analyze the Epic description and identify all distinct features, behaviors, or capabilities.
2. For each feature, create a user story with:
   - A clear, concise name (imperative form, e.g., "Implement login form")
   - A priority: P0 (critical), P1 (high), P2 (medium), P3 (low)
   - A complete markdown body following this structure:

     # [Story Name]

     **User Story**: As a [role], I want [goal] so that [benefit].

     ## Acceptance Criteria
     - [ ] First acceptance criterion (specific, testable, checkbox format)
     - [ ] Second acceptance criterion
     (... more as needed, typically 3-8 per story)

     ## Technical Tasks
     1. First implementation step with specific file paths when possible
     2. Second implementation step
     (... numbered, sequential steps)

     ## Tests
     - Describe what should be tested
     - Mention specific test file paths if applicable
     - Or "N/A — infrastructure task" if no tests needed

     ## Dependencies
     - List any prerequisites, blocking tasks, or required packages
     - Or "None" if standalone

     ## Standard Completion Criteria
     - [ ] Tests written and passing (or N/A)
     - [ ] TypeScript compiles without errors
     - [ ] Linter passes
     - [ ] Commit message follows conventional commits format

3. DO NOT duplicate stories that already exist (see existing_children above).
4. Each story should be small enough for a single developer to complete in one session.
5. Order stories logically — foundational work first, then features that build on it.
6. Generate between 2 and 15 stories. Do not generate more than 15.
7. Use imperative language: "Implement X", "Add Y", "Create Z".
</instructions>

<output_format>
Return ONLY a valid JSON array. No markdown code blocks, no explanation text — just the raw JSON.

Each element must have:
- "name": string (story name)
- "priority": string ("P0", "P1", "P2", or "P3")
- "body": string (complete markdown body with \\n for newlines)

Example:
[
  {
    "name": "Implement user registration form",
    "priority": "P1",
    "body": "# Implement User Registration Form\\n\\n**User Story**: As a new user, I want to register ...\\n\\n## Acceptance Criteria\\n- [ ] Registration form renders ...\\n..."
  }
]
</output_format>`;
}

function parseGenerateStoriesResponse(reply) {
  const text = String(reply || '').trim();

  // Try to extract JSON from code blocks if wrapped
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let stories;
  try {
    stories = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON. Raw response: ' + text.slice(0, 500));
  }

  if (!Array.isArray(stories)) {
    throw new Error('Expected a JSON array of stories but got: ' + typeof stories);
  }

  // Validate and normalize
  const normalized = [];
  for (const s of stories) {
    if (!s.name || typeof s.name !== 'string') continue;
    if (!s.body || typeof s.body !== 'string') continue;
    normalized.push({
      name: s.name.trim(),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(s.priority) ? s.priority : 'P1',
      body: s.body
    });
    if (normalized.length >= 15) break; // Hard cap
  }

  if (normalized.length === 0) {
    throw new Error('Claude returned no valid stories. Raw response: ' + text.slice(0, 500));
  }

  return normalized;
}

function buildFixEpicStoriesPrompt({ epicName, stories }) {
  const storiesList = stories.map((s, i) => {
    const issues = [];
    if (!s.hasTitle) issues.push('missing title');
    if (!s.hasNumber) issues.push('missing number in filename');
    if (!s.hasContent) issues.push('empty or too short content');
    if (!s.hasAcs) issues.push('no acceptance criteria');
    if (!s.hasModel) issues.push('no model defined');
    if (!s.hasAgents) issues.push('no agents defined');
    if (!s.hasType) issues.push('no type defined');
    if (!s.hasPriority) issues.push('no priority defined');

    return `Story ${i + 1}: ${s.name || '(no name)'}
File: ${s.fileName}
Issues: ${issues.length > 0 ? issues.join(', ') : 'none (content OK, needs ordering)'}

Current frontmatter:
---
name: ${s.frontmatter?.name || '(missing)'}
priority: ${s.frontmatter?.priority || '(missing)'}
type: ${s.frontmatter?.type || '(missing)'}
status: ${s.frontmatter?.status || '(missing)'}
model: ${s.frontmatter?.model || '(missing)'}
agents: ${s.frontmatter?.agents || '(missing)'}
---

Current body:
${s.body?.slice(0, 500) || '(empty)'}
`;
  }).join('\n---\n\n');

  return `You are a senior product manager and prompt engineering expert. Your job is to fix and reorder ALL user stories in an Epic.

<epic_name>${epicName}</epic_name>

<total_stories>${stories.length}</total_stories>

<all_stories>
${storiesList}
</all_stories>

<instructions>
CRITICAL FIRST STEP: Before fixing individual stories, analyze all stories together and determine the LOGICAL EXECUTION ORDER. Consider:
- Dependencies between stories (which stories must be completed before others?)
- Development flow (setup → core features → polish → testing)
- Technical prerequisites (infrastructure before features, data models before UI)
- User journey flow (authentication → core actions → secondary features)

Once you've determined the correct order, proceed with fixing each story:

1. For each story, fix all the issues listed:
   - If missing title: generate a clear, concise name (imperative form, e.g., "Implement login form")
   - If missing number: assign the filename following the pattern S{epic}-{story}-{slug} where {story} is the sequential number based on the LOGICAL ORDER you determined (e.g., S1-1-implement-login, S1-2-add-validation)
   - If missing content: generate a complete markdown body following this structure:

     # [Story Name]

     **User Story**: As a [role], I want [goal] so that [benefit].

     ## Acceptance Criteria
     - [ ] First acceptance criterion (specific, testable, checkbox format)
     - [ ] Second acceptance criterion
     - [ ] Third acceptance criterion
     (at least 3-5 ACs)

     ## Technical Tasks
     1. First technical task
     2. Second technical task
     (concrete implementation steps)

     ## Tests
     - Test case 1
     - Test case 2
     (specific test scenarios)

     ## Dependencies
     - Dependency 1 (or "None")

     ## Standard Completion Criteria
     - [ ] Tests written and passing
     - [ ] TypeScript compiles without errors
     - [ ] Linter passes
     - [ ] Commit: \`feat(scope): story name [STORY-ID]\`

   - If missing ACs: add 3-5 testable acceptance criteria as markdown checkboxes (\`- [ ] ...\`)
   - If missing model: set \`model: claude-sonnet-4-5-20250929\`
   - If missing agents: analyze the story and assign appropriate agents (e.g., "frontend", "backend", "design", "devops")
   - If missing type: set \`type: UserStory\`
   - If missing priority: analyze the story and assign P0 (critical), P1 (high), P2 (medium), or P3 (low)

2. IMPORTANT: Return ALL ${stories.length} stories in the JSON array, not just the ones with issues. Every story must appear in the output, in the CORRECT LOGICAL ORDER (the order they should be executed in). The array order determines the final sequential numbering (first story = S{epic}-1, second = S{epic}-2, etc.).

Each story object must include the ORIGINAL fileName (so the system can match it to the file on disk) plus the fixed fields:
   - fileName: the ORIGINAL filename from the input (e.g., "${stories[0]?.fileName || 'example-story'}" — this is used for matching, NOT the new name)
   - name: the story title
   - priority: P0, P1, P2, or P3
   - type: UserStory
   - model: claude-sonnet-4-5-20250929 (or keep existing if valid)
   - agents: array of agent names (e.g., ["frontend", "backend"])
   - body: the complete markdown body with all sections
</instructions>

<output_format>
Return ONLY a JSON array in this exact format (no markdown, no code blocks, no extra text):

[
  {
    "fileName": "s1-1-implement-login",
    "name": "Implement Login Page",
    "priority": "P1",
    "type": "UserStory",
    "model": "claude-sonnet-4-5-20250929",
    "agents": ["frontend", "design"],
    "body": "# Implement Login Page\\n\\n**User Story**: As a user, I want to log in with my email and password so that I can access my account.\\n\\n## Acceptance Criteria\\n- [ ] Login form renders with email and password fields\\n- [ ] Form validates email format\\n- [ ] Submit button is disabled when form is invalid\\n\\n## Technical Tasks\\n1. Create login page component\\n2. Add form validation\\n\\n## Tests\\n- Login form renders correctly\\n- Validation works\\n\\n## Dependencies\\n- None\\n\\n## Standard Completion Criteria\\n- [ ] Tests written and passing\\n- [ ] TypeScript compiles without errors\\n- [ ] Linter passes\\n- [ ] Commit: \`feat(auth): implement login page [S1-1]\`"
  }
]
</output_format>

Important rules:
- You MUST return ALL ${stories.length} stories. Do NOT skip any.
- ANALYZE ALL STORIES FIRST to determine the logical execution order
- The fileName field must contain the ORIGINAL filename from the input (used for matching to the file on disk)
- Keep existing good content when possible (don't regenerate everything if only a few fields are missing)
- Ensure all acceptance criteria use checkbox format: \`- [ ] ...\`
- Use proper escaping for newlines in the JSON body field
- Return ONLY valid JSON, nothing else

Example of reordering:
Input stories (random order):
  - "Add user profile page" (file: s1-3-profile)
  - "Implement logout" (file: s1-1-logout)
  - "Setup authentication" (file: s1-2-auth)

Output (sorted by logical order, fileName = ORIGINAL name for matching):
[
  { "fileName": "s1-2-auth", "name": "Setup authentication", ... },
  { "fileName": "s1-3-profile", "name": "Add user profile page", ... },
  { "fileName": "s1-1-logout", "name": "Implement logout", ... }
]

The system will rename them to S1-1, S1-2, S1-3 based on array position.`;
}

function parseFixEpicStoriesResponse(reply) {
  const text = String(reply || '').trim();

  // Try to extract JSON from code blocks if wrapped
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let stories;
  try {
    stories = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON. Raw response: ' + text.slice(0, 500));
  }

  if (!Array.isArray(stories)) {
    throw new Error('Expected a JSON array of stories but got: ' + typeof stories);
  }

  // Validate and normalize
  const normalized = [];
  for (const s of stories) {
    if (!s.fileName || typeof s.fileName !== 'string') continue;
    if (!s.name || typeof s.name !== 'string') continue;
    if (!s.body || typeof s.body !== 'string') continue;

    normalized.push({
      fileName: s.fileName.trim(),
      name: s.name.trim(),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(s.priority) ? s.priority : 'P1',
      type: s.type || 'UserStory',
      model: s.model || 'claude-sonnet-4-5-20250929',
      agents: Array.isArray(s.agents) ? s.agents : [],
      body: s.body
    });
  }

  if (normalized.length === 0) {
    throw new Error('Claude returned no valid stories. Raw response: ' + text.slice(0, 500));
  }

  return normalized;
}

app.post('/api/board/generate-stories', async (req, res) => {
  const { epicId } = req.body;

  if (!epicId || typeof epicId !== 'string' || !epicId.trim()) {
    res.status(400).json({ ok: false, message: 'epicId is required.' });
    return;
  }

  if (generateStoriesState.running) {
    res.status(409).json({ ok: false, message: 'Story generation is already in progress. Please wait.' });
    return;
  }

  generateStoriesState.running = true;
  pushLog('info', LOG_SOURCE.panel, `Generating stories for Epic: "${epicId}"`);

  try {
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

    const client = new LocalBoardClient(boardConfig);
    await client.initialize();

    // Read epic markdown
    const epicMarkdown = await client.getTaskMarkdown(epicId);
    if (!epicMarkdown) {
      res.status(404).json({ ok: false, message: `Epic not found: ${epicId}` });
      return;
    }

    const { frontmatter: epicFields, body: epicBody } = parseFrontmatter(epicMarkdown);
    const epicName = (epicFields && epicFields.name) || epicId;

    if (!epicBody || epicBody.trim().length < 20) {
      res.status(400).json({ ok: false, message: 'Epic has no description or description is too short. Add content to the Epic before generating stories.' });
      return;
    }

    // Find existing children to avoid duplication
    const allTasks = await client.listTasks();
    const existingChildren = allTasks.filter((t) => t.parentId === epicId);

    // Build prompt and call Claude
    const prompt = buildGenerateStoriesPrompt({
      epicName,
      epicBody: epicBody.trim(),
      existingChildren: existingChildren.map((c) => ({ name: c.name }))
    });

    const { reply } = await runClaudePrompt(prompt, 'claude-sonnet-4-5-20250929', GENERATE_STORIES_TIMEOUT_MS);
    const stories = parseGenerateStoriesResponse(reply);

    // Create each story as a task file with numbered pattern S{epic}-{story}-{slug}
    const created = [];
    let failed = 0;

    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      try {
        const fileName = generateStoryFileName(epicId, i, story.name);
        await client.createTask(
          { name: story.name, priority: story.priority, type: 'UserStory', status: 'Not Started' },
          story.body,
          { epicId, fileName }
        );
        created.push({ name: story.name, fileName });
      } catch (err) {
        pushLog('warn', LOG_SOURCE.panel, `Failed to create story "${story.name}": ${err.message}`);
        failed++;
      }
    }

    const summary = `Generated ${created.length} stories for "${epicName}"${failed > 0 ? ` (${failed} failed)` : ''}`;
    pushLog('success', LOG_SOURCE.claude, summary);
    res.json({ ok: true, created, total: stories.length, failed });
  } catch (error) {
    pushLog('error', LOG_SOURCE.claude, `Story generation failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    generateStoriesState.running = false;
  }
});

app.post('/api/board/fix-epic-stories', async (req, res) => {
  const { epicId } = req.body;

  if (!epicId || typeof epicId !== 'string' || !epicId.trim()) {
    res.status(400).json({ ok: false, message: 'epicId is required.' });
    return;
  }

  if (fixEpicStoriesState.running) {
    res.status(409).json({ ok: false, message: 'Story fix is already in progress. Please wait.' });
    return;
  }

  fixEpicStoriesState.running = true;
  pushLog('info', LOG_SOURCE.panel, `Fixing stories for Epic: "${epicId}"`);

  try {
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

    const client = new LocalBoardClient(boardConfig);
    await client.initialize();

    // Read epic markdown
    const epicMarkdown = await client.getTaskMarkdown(epicId);
    if (!epicMarkdown) {
      res.status(404).json({ ok: false, message: `Epic not found: ${epicId}` });
      return;
    }

    const { frontmatter: epicFields } = parseFrontmatter(epicMarkdown);
    const epicName = (epicFields && epicFields.name) || epicId;

    // Find ALL children (not just broken ones — Claude needs all to determine order)
    const allTasks = await client.listTasks();
    const children = allTasks.filter((t) => t.parentId === epicId);

    if (children.length === 0) {
      res.status(400).json({ ok: false, message: 'Epic has no child stories to fix.' });
      return;
    }

    // Gather info for ALL children
    const allStories = [];
    for (const child of children) {
      const childMarkdown = await client.getTaskMarkdown(child.id);
      if (!childMarkdown) continue;

      const { frontmatter, body } = parseFrontmatter(childMarkdown);
      const fileName = child.id.split('/').pop();

      const hasTitle = !!(frontmatter?.name && frontmatter.name.trim());
      const hasNumber = /^s\d+-\d+/i.test(fileName || '');
      const hasContent = !!(body && body.trim().length >= 20);
      const hasAcs = body ? /- \[ \]/g.test(body) : false;
      const hasModel = !!(frontmatter?.model);
      const hasAgents = !!(frontmatter?.agents && (Array.isArray(frontmatter.agents) ? frontmatter.agents.length > 0 : String(frontmatter.agents).trim().length > 0));
      const hasType = !!(frontmatter?.type);
      const hasPriority = !!(frontmatter?.priority);

      allStories.push({
        id: child.id,
        name: child.name,
        fileName,
        frontmatter,
        body,
        hasTitle,
        hasNumber,
        hasContent,
        hasAcs,
        hasModel,
        hasAgents,
        hasType,
        hasPriority
      });
    }

    if (allStories.length === 0) {
      res.json({ ok: true, message: 'No stories found.', fixed: 0 });
      return;
    }

    // Build prompt with ALL stories and call Claude
    const prompt = buildFixEpicStoriesPrompt({
      epicName,
      stories: allStories
    });

    const { reply } = await runClaudePrompt(prompt, 'claude-sonnet-4-5-20250929', GENERATE_STORIES_TIMEOUT_MS);
    const fixedStories = parseFixEpicStoriesResponse(reply);

    // Phase 1: Update content for each story
    const fixed = [];
    let failed = 0;

    // Build a mapping: original index → fixed story, matched by fileName or name
    const matchedPairs = [];
    for (let i = 0; i < fixedStories.length; i++) {
      const story = fixedStories[i];
      // Match by original fileName first, then by name
      const original = allStories.find((s) => s.fileName === story.fileName)
        || allStories.find((s) => s.name === story.name);

      if (!original) {
        pushLog('warn', LOG_SOURCE.panel, `Could not match fixed story "${story.name}" to an existing file`);
        failed++;
        continue;
      }

      matchedPairs.push({ original, fixed: story, newIndex: i });
    }

    // Update content for matched stories
    for (const { original, fixed: story } of matchedPairs) {
      try {
        await client.updateTask(
          original.id,
          {
            name: story.name,
            priority: story.priority,
            type: story.type,
            status: original.frontmatter?.status || 'Not Started',
            model: story.model,
            agents: story.agents
          },
          story.body
        );
      } catch (err) {
        pushLog('warn', LOG_SOURCE.panel, `Failed to update story "${story.name}": ${err.message}`);
        failed++;
      }
    }

    // Phase 2: Rename files to correct sequential names
    // We need to use temp names first to avoid conflicts (e.g., renaming A→B when B exists)
    const { generateStoryFileName } = await import('../src/local/helpers.js');

    // Refresh task index after content updates
    await client.listTasks();

    // Step 2a: Rename all files to temporary names
    const renameOps = [];
    for (const { original, fixed: story, newIndex } of matchedPairs) {
      const correctFileName = generateStoryFileName(epicId, newIndex, story.name) + '.md';
      const currentFileName = original.fileName + '.md';

      if (currentFileName === correctFileName) {
        fixed.push({ id: original.id, name: story.name, fileName: correctFileName });
        continue; // Already has the correct name
      }

      renameOps.push({
        currentId: original.id,
        currentFileName: currentFileName,
        tempFileName: `_temp_fix_${newIndex}_${Date.now()}.md`,
        correctFileName,
        storyName: story.name
      });
    }

    // Rename to temp names first
    for (const op of renameOps) {
      try {
        const result = await client.renameTask(op.currentId, op.tempFileName);
        if (result.renamed) {
          op.tempId = result.newId;
        } else {
          op.tempId = op.currentId;
        }
      } catch (err) {
        pushLog('warn', LOG_SOURCE.panel, `Failed to temp-rename "${op.currentFileName}": ${err.message}`);
        op.tempId = op.currentId;
        op.skipFinalRename = true;
        failed++;
      }
    }

    // Refresh index after temp renames
    if (renameOps.length > 0) {
      await client.listTasks();
    }

    // Rename from temp names to final correct names
    for (const op of renameOps) {
      if (op.skipFinalRename) continue;
      try {
        const result = await client.renameTask(op.tempId, op.correctFileName);
        if (result.renamed) {
          pushLog('info', LOG_SOURCE.panel, `Renamed "${op.currentFileName}" → "${op.correctFileName}"`);
          fixed.push({ id: result.newId, name: op.storyName, fileName: op.correctFileName });
        }
      } catch (err) {
        pushLog('warn', LOG_SOURCE.panel, `Failed to rename "${op.tempFileName}" → "${op.correctFileName}": ${err.message}`);
        failed++;
      }
    }

    const summary = `Fixed ${fixed.length} of ${allStories.length} stories for "${epicName}"${failed > 0 ? ` (${failed} failed)` : ''}`;
    pushLog('success', LOG_SOURCE.claude, summary);
    res.json({ ok: true, fixed: fixed.length, total: allStories.length, failed });
  } catch (error) {
    pushLog('error', LOG_SOURCE.claude, `Story fix failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    fixEpicStoriesState.running = false;
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

    if (isPublicMode) {
      startCloudflaredTunnel();
    } else {
      const lanIp = getLocalNetworkIp();
      if (lanIp) {
        console.log(`📱 LAN access: http://${lanIp}:${panelPort}`);
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

  // Graceful shutdown handlers
  function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    // Stop Cloudflare Tunnel if running
    stopCloudflaredTunnel();

    // Stop managed API process if running
    if (state.api.child) {
      console.log('   Stopping API process...');
      stopManagedProcess(state.api, 'api', `panel-graceful-shutdown-${signal}`);
    }

    // Close server
    server.close(() => {
      console.log('✅ Panel server closed.');
      process.exit(0);
    });

    // Force exit after 5s if graceful shutdown fails
    setTimeout(() => {
      console.error('⚠️ Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

startServer().catch((error) => {
  console.error(`❌ Failed to initialize panel server: ${error.message}`);
  process.exit(1);
});
