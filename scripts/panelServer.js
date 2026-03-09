import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { LocalBoardClient } from '../src/local/client.js';
import { isEpicTask, sortCandidates } from '../src/selectTask.js';
import { parseFrontmatter } from '../src/local/frontmatter.js';
import { generateStoryFileName, slugFromTitle } from '../src/local/helpers.js';
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
const PANEL_DEFAULT_MODEL = 'claude-sonnet-4-6';

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

// ── HTTPS cert paths (generated via `npm run panel:certs`) ─────────────
const certFile = process.env.PANEL_HTTPS_CERT || path.join(cwd, '.certs', 'cert.pem');
const keyFile = process.env.PANEL_HTTPS_KEY || path.join(cwd, '.certs', 'key.pem');
let httpsEnabled = false;

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

// ── GitHub Version Check ────────────────────────────────────────────────
const GITHUB_REPO = 'oviniciusramosp/claude-pm';
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const versionCheckState = {
  latestVersion: null,
  hasUpdate: false,
  updateUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
  lastChecked: null,
  error: null
};

async function fetchLatestGithubVersion() {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'claude-pm-panel' }
    });
    if (!response.ok) {
      versionCheckState.error = `GitHub API returned ${response.status}`;
      return;
    }
    const data = await response.json();
    const tag = (data.tag_name || '').replace(/^v/, '');
    if (!tag) return;
    versionCheckState.latestVersion = tag;
    versionCheckState.updateUrl = data.html_url || versionCheckState.updateUrl;
    versionCheckState.lastChecked = new Date().toISOString();
    versionCheckState.error = null;

    const parseSemver = (v) => v.split('.').map(Number);
    const [lMaj, lMin, lPat] = parseSemver(tag);
    const [cMaj, cMin, cPat] = parseSemver(APP_VERSION);
    versionCheckState.hasUpdate =
      lMaj > cMaj ||
      (lMaj === cMaj && lMin > cMin) ||
      (lMaj === cMaj && lMin === cMin && lPat > cPat);
  } catch (err) {
    versionCheckState.error = err.message;
  }
}

// Read local version from package.json at startup
let APP_VERSION = '0.0.0';
try {
  const pkgPath = path.join(cwd, 'package.json');
  const pkgRaw = fsSync.readFileSync(pkgPath, 'utf8');
  APP_VERSION = JSON.parse(pkgRaw).version || '0.0.0';
} catch {
  // fallback
}

// Initial check (non-blocking) + periodic recheck
fetchLatestGithubVersion();
setInterval(fetchLatestGithubVersion, VERSION_CHECK_INTERVAL_MS);

// ── GitHub Changelog ────────────────────────────────────────────────
const changelogState = {
  commits: null,
  lastFetched: null,
  error: null
};

async function fetchChangelog() {
  try {
    const headers = { 'User-Agent': 'claude-pm-panel' };

    // Fetch recent commits and the list of commits that touched package.json in parallel
    const [commitsRes, pkgCommitsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=50`, { headers }),
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?path=package.json&per_page=50`, { headers })
    ]);

    if (!commitsRes.ok) {
      changelogState.error = `GitHub API returned ${commitsRes.status}`;
      return;
    }

    const commitsData = await commitsRes.json();
    const pkgCommitsData = pkgCommitsRes.ok ? await pkgCommitsRes.json() : [];

    // Fetch package.json content for version-bumping commits (limit to 10 parallel calls)
    const pkgShasToFetch = pkgCommitsData.slice(0, 10).map((c) => c.sha);
    const versionMap = new Map(); // fullSha → semver string

    await Promise.all(
      pkgShasToFetch.map(async (sha) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/package.json?ref=${sha}`,
            { headers }
          );
          if (!res.ok) return;
          const data = await res.json();
          const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
          const pkg = JSON.parse(decoded);
          if (pkg.version) versionMap.set(sha, pkg.version);
        } catch {
          // ignore individual fetch errors
        }
      })
    );

    changelogState.commits = commitsData.map((c) => ({
      sha: c.sha.slice(0, 7),
      fullSha: c.sha,
      message: c.commit.message,
      date: c.commit.committer.date,
      author: c.commit.author.name,
      url: c.html_url,
      version: versionMap.get(c.sha) || null
    }));

    changelogState.lastFetched = new Date().toISOString();
    changelogState.error = null;
  } catch (err) {
    changelogState.error = err.message;
  }
}

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

    const tunnelArgs = ['tunnel', '--url', `${httpsEnabled ? 'https' : 'http'}://localhost:${panelPort}`];
    if (httpsEnabled) tunnelArgs.push('--no-tls-verify');
    const tunnelChild = spawn('cloudflared', tunnelArgs, {
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
// Map from epicId -> session state — allows multiple epics to generate concurrently
const generateStoriesSessions = new Map();

function getGenerateSession(epicId) {
  if (!generateStoriesSessions.has(epicId)) {
    generateStoriesSessions.set(epicId, {
      running: false,
      epicId,
      epicName: null,
      created: 0,
      total: 0,
      failed: 0,
      phase: null, // 'planning' | 'generating'
      errors: [],
      plan: null,      // saved Phase 1 result — preserved across runs for resume
      canResume: false // true when Phase 1 succeeded but Phase 2 had failures
    });
  }
  return generateStoriesSessions.get(epicId);
}
// ── Generate Stories — Disk Persistence ───────────────────────────────
// Plan files survive process restarts, allowing Phase 2 to resume without re-running Phase 1.
const GENERATE_PLANS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../.data/generate-stories');

async function loadGeneratePlan(epicId) {
  const safeName = epicId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(GENERATE_PLANS_DIR, `${safeName}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveGeneratePlan(epicId, data) {
  await fs.mkdir(GENERATE_PLANS_DIR, { recursive: true });
  const safeName = epicId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(GENERATE_PLANS_DIR, `${safeName}.json`);
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function deleteGeneratePlan(epicId) {
  const safeName = epicId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(GENERATE_PLANS_DIR, `${safeName}.json`);
  try { await fs.unlink(filePath); } catch { /* file may not exist */ }
}

const fixEpicStoriesState = {
  running: false
};
const fixEpicState = {
  running: false,
  type: null // 'all' | 'models' | 'agents' | 'status' | 'stories' | 'acs'
};
const fixTaskState = {
  running: false,
  type: null // 'all' | 'model' | 'agents' | 'status' | 'acs'
};
const ideaChatState = {
  running: false
};
const generateEpicsState = {
  running: false,
  sessionId: null,     // session that triggered this run
  created: 0,
  total: 0,
  failed: 0,
  phase: null,         // 'planning' | 'generating'
  errors: [],          // names of failed epics
  plan: null,          // saved Phase 1 result for resume
  canResume: false     // true when Phase 1 succeeded but Phase 2 had failures
};

// In-memory session store for Idea to Epics brainstorming
const ideaSessions = new Map(); // sessionId -> { messages: [], plan: '', createdAt: number }
const IDEA_SESSION_FILE = path.join(cwd, '.data', 'idea-session.json');

async function saveIdeaSessionToDisk(sessionId, session) {
  try {
    await fs.mkdir(path.dirname(IDEA_SESSION_FILE), { recursive: true });
    const data = { sessionId, messages: session.messages, plan: session.plan || '', createdAt: session.createdAt };
    const tempPath = `${IDEA_SESSION_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, IDEA_SESSION_FILE);
  } catch {
    // Non-fatal: session just won't survive restart
  }
}

async function loadIdeaSessionFromDisk() {
  try {
    const content = await fs.readFile(IDEA_SESSION_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

const IDEA_SESSION_ARCHIVE_DIR = path.join(cwd, '.data', 'idea-sessions');

/**
 * Archive the active session file with enriched metadata.
 * The archived file is saved to .data/idea-sessions/ with archivedAt
 * and epicNames fields so the history picker can display useful info.
 */
async function archiveIdeaSession(epicNames) {
  try {
    await fs.access(IDEA_SESSION_FILE);
  } catch {
    return null; // No active session to archive
  }

  try {
    await fs.mkdir(IDEA_SESSION_ARCHIVE_DIR, { recursive: true });

    // Read and enrich with archive metadata
    const content = await fs.readFile(IDEA_SESSION_FILE, 'utf8');
    const session = JSON.parse(content);
    session.archivedAt = Date.now();
    session.epicNames = epicNames || [];

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const slug = (epicNames && epicNames.length > 0)
      ? '-' + epicNames[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      : '';
    const archiveName = `session_${ts}${slug}.json`;
    const archivePath = path.join(IDEA_SESSION_ARCHIVE_DIR, archiveName);

    // Write enriched archive (instead of just renaming)
    await fs.writeFile(archivePath, JSON.stringify(session, null, 2), 'utf8');
    try { await fs.unlink(IDEA_SESSION_FILE); } catch { /* ignore */ }
    return archiveName;
  } catch {
    // Fallback: delete active file if archiving fails
    try { await fs.unlink(IDEA_SESSION_FILE); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Delete the active session file (used when user explicitly discards).
 */
async function deleteIdeaSessionFromDisk() {
  try {
    await fs.unlink(IDEA_SESSION_FILE);
  } catch {
    // File may not exist
  }
}

// Cleanup stale sessions every 30 minutes (sessions older than 2 hours)
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of ideaSessions) {
    if (session.createdAt < twoHoursAgo) ideaSessions.delete(id);
  }
}, 30 * 60 * 1000);

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
const NPM_SCRIPT_LINE_REGEX = /^>\s/;
const PROGRESS_MARKER_REGEX = /^\[PM_PROGRESS]\s+(.+)$/;
const AC_COMPLETE_MARKER_REGEX = /^\[PM_AC_COMPLETE]\s+(.+)$/;
const COMPACT_MARKER_REGEX = /^\[PM_COMPACT]\s+(.+)$/;
const API_STATUS_NOISE_PATTERNS = [
  /^Server started on port \d+$/i
];

// Patterns that identify startup-phase log messages to be collapsed into a
// single "API started." bubble with expandable details.
const STARTUP_LOG_PATTERNS = [
  /^API (was )?started/i,
  /^Board directory:/i,
  /^Claude working directory:/i,
  /^Board structure validated successfully$/i,
  /^CLAUDE\.md managed section/i,
  /^Created CLAUDE\.md/i,
  /^Updated CLAUDE\.md/i,
  /^Appended managed section/i,
  /^Periodic reconciliation (enabled|disabled)/i,
  /^Automatic reconciliation/i,
  /^Startup reconciliation (is )?disabled/i,
  /^\[VALIDATION_REPORT\]/i,
  /^>\s+[\w-]+@[\d.]+\s+start$/i, // npm script line like "> product-manager-automation@1.60.0 start"
  /^>\s+NODE_OPTIONS=/i, // npm script command line
];

// Startup message grouping: each process start gets a unique groupId
let currentStartupGroupId = null;
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

function isStartupMessage(message) {
  if (!message) return false;
  const clean = String(message).trim();
  return STARTUP_LOG_PATTERNS.some((pattern) => pattern.test(clean));
}

function pushLog(level, source, message, extra) {
  // Tag startup messages with a groupId so the frontend can group them
  if (source === 'api' && isStartupMessage(message)) {
    if (!currentStartupGroupId) {
      currentStartupGroupId = `startup-${Date.now()}`;
    }
    extra = {
      ...extra,
      meta: {
        ...(extra?.meta || {}),
        startupGroupId: currentStartupGroupId
      }
    };
  } else if (currentStartupGroupId) {
    // Non-startup message arrived, close the group for future starts
    currentStartupGroupId = null;
  }

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

  const compactMatch = clean.match(COMPACT_MARKER_REGEX);
  if (compactMatch) {
    return {
      level: 'warn',
      message: compactMatch[1].trim(),
      fromLogger: false
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

        // Special handling for expandableContent (comes as Base64-encoded JSON)
        if (key === 'expandableContent') {
          try {
            // Decode Base64 and parse JSON
            if (value.startsWith('base64:')) {
              const base64 = value.slice(7); // Remove 'base64:' prefix
              const json = Buffer.from(base64, 'base64').toString('utf8');
              value = JSON.parse(json);
            } else {
              // Fallback for old format (direct JSON)
              value = JSON.parse(value);
            }
          } catch {
            // If parsing fails, keep as-is
          }
        }
        // Try to parse JSON values
        else if (value === 'true') value = true;
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
    return 'API';
  }

  return 'Process';
}

function shouldSuppressProcessMessage(source, message) {
  const clean = String(message || '').trim();
  if (!clean) {
    return true;
  }

  // Don't suppress startup messages - they will be grouped
  if (source === 'api' && isStartupMessage(clean)) {
    return false;
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
    const extra = {};

    // Include special flags
    if (parsed.isPrompt) {
      extra.isPrompt = true;
      extra.promptTitle = parsed.promptTitle;
    }
    if (parsed.isAcComplete) extra.isAcComplete = true;
    if (parsed.isToolUse) extra.isToolUse = true;

    // Include meta if present (contains expandableContent, progressive flags, etc)
    if (parsed.meta && Object.keys(parsed.meta).length > 0) {
      extra.meta = parsed.meta;

      // Promote debug fields from expandableContent to top-level so the Debug Errors modal
      // can render entry.stderr, entry.stdout, entry.exitCode, entry.signal, entry.stack.
      const ec = parsed.meta.expandableContent;
      if (ec && typeof ec === 'object' && !Array.isArray(ec)) {
        if (ec.stderr != null) extra.stderr = ec.stderr;
        if (ec.stdout != null) extra.stdout = ec.stdout;
        if (ec.exitCode != null) extra.exitCode = ec.exitCode;
        if (ec.signal != null) extra.signal = ec.signal;
        if (ec.stack != null) extra.stack = ec.stack;
      }
    }

    return Object.keys(extra).length > 0 ? extra : undefined;
  }

  function forwardLog(parsed) {
    if (shouldSuppressProcessMessage(source, parsed.message)) {
      return;
    }

    // Filter logs based on feedEnabled flag (defaults to true if not specified)
    const feedEnabled = parsed.meta?.feedEnabled !== false;
    if (!feedEnabled) {
      return; // Skip sending to Feed, but log still appears in Terminal
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

function runClaudePromptViaApi(prompt, model, customTimeoutMs) {
  return new Promise((resolve, reject) => {
    let command = DEFAULT_CLAUDE_COMMAND;

    if (envEnabled(process.env.CLAUDE_FULL_ACCESS, false) && !command.includes('--dangerously-skip-permissions')) {
      command = `${command} --dangerously-skip-permissions`;
    }

    if (model && model.trim()) {
      const cleanModel = model.trim();
      if (!/^claude-[a-z0-9.-]+$/.test(cleanModel)) {
        return reject(new Error(`Invalid model name: "${cleanModel}". Model must match pattern: claude-<alphanumeric/dots/hyphens>`));
      }
      command = `${command} --model ${cleanModel}`;
    }

    const workdir = path.resolve(cwd, process.env.CLAUDE_WORKDIR || '.');
    const timeoutMs = customTimeoutMs || null;

    // Strip env vars that trigger Claude Code's nested-session detection.
    // Also remove CLAUDE_CODE_OAUTH_TOKEN so the CLI authenticates via its
    // own stored credentials (~/.config/claude/auth.json) rather than an
    // automation token that is not valid for interactive CLI auth.
    const commandEnv = { ...process.env };
    delete commandEnv.CLAUDECODE;
    delete commandEnv.CLAUDE_CODE_ENTRYPOINT;
    delete commandEnv.CLAUDE_AGENT_SDK_VERSION;
    delete commandEnv.CLAUDE_CODE_OAUTH_TOKEN;

    let child;
    try {
      child = spawn(command, {
        shell: true,
        cwd: workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: commandEnv
      });
    } catch (spawnErr) {
      return reject(new Error(`Failed to spawn Claude process: ${spawnErr.message}`));
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let escalationTimer = null;

    function finish(error, payload) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (error) { reject(error); return; }
      resolve(payload);
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          // Escalate to SIGKILL if process ignores SIGTERM
          escalationTimer = setTimeout(() => {
            try { if (!child.killed) child.kill('SIGKILL'); } catch { /* ignore */ }
          }, 10_000);
          escalationTimer.unref?.();
          const err = new Error(`Claude prompt timed out after ${timeoutMs}ms`);
          err.stderr = stderr.trim() || null;
          err.stdout = stdout.trim() || null;
          finish(err);
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { finish(error); });

    child.on('close', (code, signal) => {
      if (code !== 0) {
        const err = new Error(`Claude command failed (exit=${code}${signal ? `, signal=${signal}` : ''})`);
        err.stderr = String(stderr || '').trim() || null;
        err.stdout = String(stdout || '').trim() || null;
        err.exitCode = code;
        err.signal = signal || null;
        finish(err);
        return;
      }
      finish(null, { reply: String(stdout || stderr || '').trim(), workdir });
    });

    child.stdin.on('error', (err) => {
      // Only suppress EPIPE (process exited before reading stdin).
      if (err.code !== 'EPIPE') finish(err);
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
    pushLog('info', LOG_SOURCE.panel, 'API was started automatically when the panel opened.');
    return;
  }

  pushLog('warn', LOG_SOURCE.panel, 'API auto-start skipped because process is already running.');
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
  const scheme = httpsEnabled ? 'https' : 'http';
  res.json({
    localUrl: `${scheme}://localhost:${panelPort}`,
    lanUrl: lanIp ? `${scheme}://${lanIp}:${panelPort}` : null,
    tunnelUrl: tunnelState.url,
    tunnelStatus: tunnelState.status,
    tunnelError: tunnelState.error,
    isPublicMode,
    authEnabled: isPublicMode,
    authProviders: isPublicMode ? getEnabledProviders() : [],
    currentVersion: APP_VERSION,
    latestVersion: versionCheckState.latestVersion,
    hasUpdate: versionCheckState.hasUpdate,
    updateUrl: versionCheckState.updateUrl
  });
});

app.get('/api/changelog', async (_req, res) => {
  const stale =
    !changelogState.lastFetched ||
    Date.now() - new Date(changelogState.lastFetched).getTime() > VERSION_CHECK_INTERVAL_MS;

  if (stale) {
    await fetchChangelog();
  }

  if (changelogState.error && !changelogState.commits) {
    return res.status(502).json({ error: changelogState.error });
  }

  res.json({ commits: changelogState.commits || [], error: changelogState.error || null });
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

app.get('/api/claude/cli-status', async (_req, res) => {
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;
  delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  delete childEnv.CLAUDE_AGENT_SDK_VERSION;
  delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;

  // Check CLI is installed and get version.
  const cliInstalled = await new Promise((resolve) => {
    const child = spawn(`${DEFAULT_CLAUDE_COMMAND.split(' ')[0]} --version`, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    });
    let output = '';
    child.stdout.on('data', (d) => { output += String(d); });
    child.stderr.on('data', (d) => { output += String(d); });
    child.on('close', (code) => resolve(code === 0 ? output.trim() : null));
    child.on('error', () => resolve(null));
  });

  // Check if user is logged in via `claude auth status`.
  let loggedIn = false;
  let authEmail = null;
  if (cliInstalled) {
    const authResult = await new Promise((resolve) => {
      const child = spawn(`${DEFAULT_CLAUDE_COMMAND.split(' ')[0]} auth status`, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv
      });
      let output = '';
      child.stdout.on('data', (d) => { output += String(d); });
      child.stderr.on('data', (d) => { output += String(d); });
      child.on('close', () => {
        try {
          const parsed = JSON.parse(output.trim());
          resolve(parsed);
        } catch {
          resolve(null);
        }
      });
      child.on('error', () => resolve(null));
    });
    if (authResult) {
      loggedIn = authResult.loggedIn === true;
      authEmail = authResult.email || null;
    }
  }

  res.json({
    cliInstalled: cliInstalled !== null,
    cliVersion: cliInstalled || null,
    loggedIn,
    authEmail
  });
});

app.post('/api/skills/install', async (req, res) => {
  const { url, installPath, scope, installMethod, npxRepo, npxSkill } = req.body || {};

  // --- npx skills add (skills.sh registry) ---
  if (installMethod === 'npx-skills') {
    if (!npxRepo || typeof npxRepo !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing npxRepo' });
    }

    const displayName = npxSkill || installPath || npxRepo;
    const isGlobal = scope !== 'local';

    let cwd = process.cwd();
    if (!isGlobal) {
      const env = await readEnvPairs();
      const workdir = env.CLAUDE_WORKDIR;
      if (!workdir) {
        return res.json({ ok: false, error: 'CLAUDE_WORKDIR is not configured. Set it in Setup first.' });
      }
      cwd = workdir;
    }

    const args = ['skills', 'add', npxRepo];
    if (npxSkill) args.push('--skill', npxSkill);
    if (isGlobal) args.push('--global');
    args.push('-y');

    const result = await new Promise((resolve) => {
      const child = spawn('npx', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd
      });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('close', (code) => resolve({ code, stderr, stdout }));
      child.on('error', (err) => resolve({ code: 1, stderr: err.message, stdout: '' }));
    });

    if (result.code !== 0) {
      pushLog('error', LOG_SOURCE.panel, `Failed to install skill "${displayName}"`, { stderr: result.stderr, stdout: result.stdout });
      return res.json({ ok: false, error: result.stderr || 'npx skills add failed' });
    }

    pushLog('success', LOG_SOURCE.panel, `Skill installed: ${displayName}`);
    return res.json({ ok: true });
  }

  // --- github-subdir: clone repo and extract a specific subdirectory ---
  if (installMethod === 'github-subdir') {
    const { subdir } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ ok: false, error: 'Missing url' });
    if (!subdir || typeof subdir !== 'string') return res.status(400).json({ ok: false, error: 'Missing subdir' });

    const name = (installPath && typeof installPath === 'string') ? installPath : subdir;

    let skillsDir;
    if (scope === 'local') {
      const env = await readEnvPairs();
      const workdir = env.CLAUDE_WORKDIR;
      if (!workdir) return res.json({ ok: false, error: 'CLAUDE_WORKDIR is not configured. Set it in Setup first.' });
      skillsDir = path.join(workdir, '.claude', 'skills');
    } else {
      skillsDir = path.join(os.homedir(), '.claude', 'skills');
    }

    const targetDir = path.join(skillsDir, name);

    try { await fs.access(targetDir); return res.json({ ok: true, already: true }); } catch {}

    await fs.mkdir(skillsDir, { recursive: true });

    const tmpDir = path.join(os.tmpdir(), `claude-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      const cloneResult = await new Promise((resolve) => {
        const child = spawn('git', ['clone', '--depth=1', url, tmpDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('close', (code) => resolve({ code, stderr }));
        child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
      });

      if (cloneResult.code !== 0) {
        pushLog('error', LOG_SOURCE.panel, `Failed to install skill "${name}"`, { stderr: cloneResult.stderr });
        return res.json({ ok: false, error: cloneResult.stderr || 'git clone failed' });
      }

      const subdirPath = path.join(tmpDir, subdir);
      const cpResult = await new Promise((resolve) => {
        const child = spawn('cp', ['-r', subdirPath, targetDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('close', (code) => resolve({ code, stderr }));
        child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
      });

      if (cpResult.code !== 0) {
        pushLog('error', LOG_SOURCE.panel, `Failed to install skill "${name}"`, { stderr: cpResult.stderr });
        return res.json({ ok: false, error: cpResult.stderr || 'cp failed' });
      }

      pushLog('success', LOG_SOURCE.panel, `Skill installed: ${name}`);
      return res.json({ ok: true });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // --- git clone ---
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing url' });
  }

  const name = (installPath && typeof installPath === 'string')
    ? installPath
    : (url.split('/').pop() || 'skill');

  let skillsDir;
  if (scope === 'local') {
    const env = await readEnvPairs();
    const workdir = env.CLAUDE_WORKDIR;
    if (!workdir) {
      return res.json({ ok: false, error: 'CLAUDE_WORKDIR is not configured. Set it in Setup first.' });
    }
    skillsDir = path.join(workdir, '.claude', 'skills');
  } else {
    skillsDir = path.join(os.homedir(), '.claude', 'skills');
  }

  const targetDir = path.join(skillsDir, name);

  // Already installed
  try {
    await fs.access(targetDir);
    return res.json({ ok: true, already: true });
  } catch {
    // Not yet installed
  }

  await fs.mkdir(skillsDir, { recursive: true });

  const result = await new Promise((resolve) => {
    const child = spawn('git', ['clone', url, targetDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => resolve({ code, stderr }));
    child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
  });

  if (result.code !== 0) {
    pushLog('error', LOG_SOURCE.panel, `Failed to install skill "${name}"`, { stderr: result.stderr });
    return res.json({ ok: false, error: result.stderr || 'git clone failed' });
  }

  pushLog('success', LOG_SOURCE.panel, `Skill installed: ${name}`);
  res.json({ ok: true });
});

app.get('/api/skills/status', async (req, res) => {
  const id = String(req.query.installPath || req.query.id || '');
  const scope = String(req.query.scope || 'global');
  if (!id) return res.status(400).json({ installed: false });

  let baseDir;
  if (scope === 'local') {
    const env = await readEnvPairs();
    const workdir = env.CLAUDE_WORKDIR;
    if (!workdir) return res.json({ installed: false });
    baseDir = path.join(workdir, '.claude', 'skills');
  } else {
    baseDir = path.join(os.homedir(), '.claude', 'skills');
  }

  const targetDir = path.join(baseDir, id);
  try {
    await fs.access(targetDir);
    res.json({ installed: true });
  } catch {
    res.json({ installed: false });
  }
});

app.post('/api/skills/status-batch', async (req, res) => {
  const { ids, scope } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ results: {} });

  let baseDir;
  if (scope === 'local') {
    const env = await readEnvPairs();
    const workdir = env.CLAUDE_WORKDIR;
    if (!workdir) {
      const results = Object.fromEntries(ids.map((id) => [id, false]));
      return res.json({ results });
    }
    baseDir = path.join(workdir, '.claude', 'skills');
  } else {
    baseDir = path.join(os.homedir(), '.claude', 'skills');
  }

  const results = {};
  await Promise.all(ids.map(async (id) => {
    const targetDir = path.join(baseDir, String(id));
    try {
      await fs.access(targetDir);
      results[id] = true;
    } catch {
      results[id] = false;
    }
  }));

  res.json({ results });
});

// ── MCP Server Management ──────────────────────────────────────────────────

app.post('/api/mcp/install', async (req, res) => {
  const { id, command, args, scope } = req.body || {};
  if (!id || !command) {
    return res.status(400).json({ ok: false, error: 'Missing id or command' });
  }

  const mcpScope = scope === 'local' ? 'project' : 'user';
  const displayName = id;

  // For project scope, we need CLAUDE_WORKDIR
  let cwd = process.cwd();
  if (mcpScope === 'project') {
    const env = await readEnvPairs();
    const workdir = env.CLAUDE_WORKDIR;
    if (!workdir) {
      return res.json({ ok: false, error: 'CLAUDE_WORKDIR is not configured. Set it in Setup first.' });
    }
    cwd = workdir;
  }

  // claude mcp add <name> -s <scope> -- <command> [args...]
  const cliArgs = ['mcp', 'add', id, '-s', mcpScope, '--', command, ...(args || [])];

  try {
    const result = await new Promise((resolve) => {
      const child = spawn('claude', cliArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
    });

    if (result.code !== 0) {
      pushLog('error', LOG_SOURCE.panel, `Failed to add MCP server "${displayName}"`, {
        stderr: result.stderr || null,
        stdout: result.stdout || null
      });
      return res.json({ ok: false, error: result.stderr || 'claude mcp add failed' });
    }

    pushLog('success', LOG_SOURCE.panel, `MCP server added: ${displayName}`);
    return res.json({ ok: true });
  } catch (err) {
    pushLog('error', LOG_SOURCE.panel, `Failed to add MCP server "${displayName}"`, {
      stderr: err.message || null
    });
    return res.json({ ok: false, error: err.message });
  }
});

app.get('/api/mcp/check-prereq', async (req, res) => {
  const command = String(req.query.command || '');
  if (!command) return res.status(400).json({ available: false, error: 'Missing command' });

  // Reject anything that isn't a simple command name
  if (!/^[a-zA-Z0-9_-]+$/.test(command)) {
    return res.status(400).json({ available: false, error: 'Invalid command name' });
  }

  try {
    const result = await new Promise((resolve) => {
      const child = spawn('which', [command], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.on('close', (code) => resolve({ code, stdout: stdout.trim() }));
      child.on('error', () => resolve({ code: 1, stdout: '' }));
    });

    res.json({ available: result.code === 0, path: result.stdout || null });
  } catch {
    res.json({ available: false });
  }
});

app.post('/api/mcp/install-prereq', async (req, res) => {
  const { installCommand } = req.body || {};
  if (!installCommand || typeof installCommand !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing installCommand' });
  }

  // Only allow known safe install commands
  const allowedPatterns = [
    /^brew install [a-zA-Z0-9_-]+$/,
  ];
  if (!allowedPatterns.some((p) => p.test(installCommand))) {
    return res.status(400).json({ ok: false, error: `Install command not allowed: "${installCommand}". Please run it manually.` });
  }

  const parts = installCommand.split(' ');
  const cmd = parts[0];
  const cmdArgs = parts.slice(1);

  pushLog('info', LOG_SOURCE.panel, `Installing prerequisite: ${installCommand}`);

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(cmd, cmdArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
    });

    if (result.code !== 0) {
      pushLog('error', LOG_SOURCE.panel, `Prerequisite install failed: ${installCommand}`, {
        stderr: result.stderr || null,
        stdout: result.stdout || null
      });
      return res.json({ ok: false, error: result.stderr || 'Install failed' });
    }

    pushLog('success', LOG_SOURCE.panel, `Prerequisite installed: ${installCommand}`);
    return res.json({ ok: true });
  } catch (err) {
    pushLog('error', LOG_SOURCE.panel, `Prerequisite install failed: ${installCommand}`, {
      stderr: err.message || null
    });
    return res.json({ ok: false, error: err.message });
  }
});

app.get('/api/mcp/status', async (req, res) => {
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ installed: false });

  try {
    const result = await new Promise((resolve) => {
      const child = spawn('claude', ['mcp', 'get', id], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.on('close', (code) => resolve({ code, stdout }));
      child.on('error', () => resolve({ code: 1, stdout: '' }));
    });

    res.json({ installed: result.code === 0 });
  } catch {
    res.json({ installed: false });
  }
});

app.post('/api/mcp/status-batch', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ results: {} });

  const results = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const result = await new Promise((resolve) => {
        const child = spawn('claude', ['mcp', 'get', String(id)], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        child.on('close', (code) => resolve({ code }));
        child.on('error', () => resolve({ code: 1 }));
      });
      results[id] = result.code === 0;
    } catch {
      results[id] = false;
    }
  }));

  res.json({ results });
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
      CLAUDE_WORKDIR: env.CLAUDE_WORKDIR || '',
      CLAUDE_MODEL_OVERRIDE: env.CLAUDE_MODEL_OVERRIDE || '',
      PLATFORM_PRESET: env.PLATFORM_PRESET || '',
      CLAUDE_FULL_ACCESS: env.CLAUDE_FULL_ACCESS || 'true',
      CLAUDE_STREAM_OUTPUT: env.CLAUDE_STREAM_OUTPUT || 'true',
      CLAUDE_LOG_PROMPT: env.CLAUDE_LOG_PROMPT || 'true',
      OPUS_REVIEW_ENABLED: env.OPUS_REVIEW_ENABLED || 'false',
      EPIC_REVIEW_ENABLED: env.EPIC_REVIEW_ENABLED || 'false',
      FORCE_TEST_CREATION: env.FORCE_TEST_CREATION || 'false',
      FORCE_TEST_RUN: env.FORCE_TEST_RUN || 'false',
      FORCE_COMMIT: env.FORCE_COMMIT || 'false',
      AUTO_VERSION_ENABLED: env.AUTO_VERSION_ENABLED || 'false',
      ENABLE_MULTI_AGENTS: env.ENABLE_MULTI_AGENTS || 'false',
      MANUAL_RUN_TOKEN: env.MANUAL_RUN_TOKEN || '',
      CLAUDE_AUTO_COMPACT: env.CLAUDE_AUTO_COMPACT || 'true',
      CLAUDE_COMPACT_THRESHOLD: env.CLAUDE_COMPACT_THRESHOLD || '80',
      CLAUDE_MAX_COMPACT_CYCLES: env.CLAUDE_MAX_COMPACT_CYCLES || '3'
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

    pushLog('success', LOG_SOURCE.panel, 'Orchestrator activated. Checking for tasks to execute...');
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

// ── Task Fix Functions ──────────────────────────────────────────────

/**
 * Fix Model — Use Claude to analyze a single task and assign the best model.
 */
async function fixTaskModel(client, task) {
  const markdown = await client.getTaskMarkdown(task.id);
  if (!markdown) throw new Error(`Task not found: ${task.id}`);
  const { frontmatter, body } = parseFrontmatter(markdown);

  if (frontmatter.model && frontmatter.model.trim()) {
    return { changes: 0, total: 1, failed: 0, message: 'Task already has a model assigned' };
  }

  const prompt = `You are assigning a Claude AI model to a development task based on its complexity.

Available models (choose the most appropriate):
- claude-opus-4-6 — Most capable. Use for: complex architecture, multi-file refactors, intricate business logic, security-critical code, tasks with many acceptance criteria, debugging hard-to-reproduce bugs, tasks requiring deep reasoning.
- claude-sonnet-4-5-20250929 — Balanced. Use for: standard feature implementation, moderate complexity tasks, CRUD operations, UI components, API endpoints, most typical development work.
- claude-haiku-4-5-20251001 — Fast and lightweight. Use for: simple chores, dependency installs, config changes, renaming/reformatting, documentation, small fixes, boilerplate generation.

Task: "${task.name}"
${(body || '').slice(0, 800)}

Return ONLY a JSON object (no markdown, no code blocks):
{ "model": "claude-sonnet-4-5-20250929", "reason": "brief reason" }

Rules:
- "model" must be one of the three model IDs listed above (exact string)
- "reason" is a brief explanation (max 15 words) of why that model fits
- Return valid JSON only, no extra text`;

  const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);

  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for model assignment');
  }

  const validModels = ['claude-opus-4-6', PANEL_DEFAULT_MODEL, 'claude-haiku-4-5-20251001'];
  if (!parsed.model || !validModels.includes(parsed.model)) {
    throw new Error(`Invalid model returned: ${parsed.model}`);
  }

  frontmatter.model = parsed.model;
  await client.updateTask(task.id, frontmatter, body);
  const shortModel = parsed.model.replace('claude-', '').replace(/-\d{8}$/, '');
  pushLog('info', LOG_SOURCE.panel, `Set model for "${task.name}" → ${shortModel}${parsed.reason ? ` (${parsed.reason})` : ''}`);

  return { changes: 1, total: 1, failed: 0, message: `Assigned model: ${shortModel}` };
}

/**
 * Fix Agents — Use Claude to analyze a single task and assign/reassign agents.
 */
async function fixTaskAgents(client, task) {
  const markdown = await client.getTaskMarkdown(task.id);
  if (!markdown) throw new Error(`Task not found: ${task.id}`);
  const { frontmatter, body } = parseFrontmatter(markdown);

  const currentAgents = frontmatter.agents
    ? (Array.isArray(frontmatter.agents) ? frontmatter.agents.join(', ') : String(frontmatter.agents).trim())
    : '';

  const prompt = `You are assigning developer agents to a task based on its content.

Available agent types: frontend, backend, design, devops, qa, database, security, api

Task: "${task.name}"${currentAgents ? ` [current agents: ${currentAgents}]` : ' [no agents assigned]'}
${(body || '').slice(0, 800)}

Return ONLY a JSON object (no markdown, no code blocks):
{ "agents": ["frontend", "design"], "reason": "brief reason" }

Rules:
- Assign 1-3 agents from the available list
- "reason" is a brief explanation (max 15 words) of why those agents fit
- If current agents are already correct, return the same agents
- Return valid JSON only, no extra text`;

  const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);

  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for agents assignment');
  }

  if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
    throw new Error('Invalid agents returned');
  }

  const newAgents = parsed.agents.join(', ');
  if (newAgents === currentAgents) {
    return { changes: 0, total: 1, failed: 0, message: 'Agents are already correct' };
  }

  frontmatter.agents = newAgents;
  await client.updateTask(task.id, frontmatter, body);
  pushLog('info', LOG_SOURCE.panel, `Set agents for "${task.name}" → ${newAgents}${parsed.reason ? ` (${parsed.reason})` : ''}`);

  return { changes: 1, total: 1, failed: 0, message: `Assigned agents: ${newAgents}` };
}

/**
 * Fix Status — Analyze a single task's AC completion and sync status accordingly.
 */
async function fixTaskStatus(client, task, boardConfig) {
  const { notStarted, inProgress, done } = boardConfig.board.statuses;
  const markdown = await client.getTaskMarkdown(task.id);
  if (!markdown) throw new Error(`Task not found: ${task.id}`);

  const { frontmatter, body } = parseFrontmatter(markdown);
  const unchecked = (body.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
  const checked = (body.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
  const total = unchecked + checked;
  const currentStatus = (frontmatter.status || '').trim();

  if (total === 0) {
    return { changes: 0, total: 1, failed: 0, message: `No ACs found, status "${currentStatus}" unchanged` };
  }

  let newStatus = null;
  if (unchecked === 0 && checked > 0 && currentStatus !== done) {
    newStatus = done;
  } else if (checked > 0 && unchecked > 0 && currentStatus === notStarted) {
    newStatus = inProgress;
  } else if (checked === 0 && unchecked > 0 && currentStatus === done) {
    newStatus = notStarted;
  }

  if (newStatus) {
    await client.updateTaskStatus(task.id, newStatus);
    pushLog('info', LOG_SOURCE.panel, `"${task.name}": ${checked}/${total} ACs done — ${currentStatus} → ${newStatus}`);
    return { changes: 1, total: 1, failed: 0, message: `Status changed: ${currentStatus} → ${newStatus}` };
  }

  return { changes: 0, total: 1, failed: 0, message: `Status "${currentStatus}" is correct (${checked}/${total} ACs done)` };
}

/**
 * Fix All — Run all task fix types sequentially for a single task.
 */
async function fixTaskAll(client, task, env, boardConfig) {
  const results = [];
  pushLog('info', LOG_SOURCE.panel, `Running all fixes for "${task.name}"...`);

  // Step 1: Fix model
  try {
    results.push(await fixTaskModel(client, task));
  } catch (err) {
    pushLog('warn', LOG_SOURCE.panel, `Fix model failed for "${task.name}": ${err.message}`);
    results.push({ changes: 0, total: 1, failed: 1, message: err.message });
  }

  // Step 2: Fix status
  try {
    results.push(await fixTaskStatus(client, task, boardConfig));
  } catch (err) {
    pushLog('warn', LOG_SOURCE.panel, `Fix status failed for "${task.name}": ${err.message}`);
    results.push({ changes: 0, total: 1, failed: 1, message: err.message });
  }

  // Step 3: Fix agents
  try {
    results.push(await fixTaskAgents(client, task));
  } catch (err) {
    pushLog('warn', LOG_SOURCE.panel, `Fix agents failed for "${task.name}": ${err.message}`);
    results.push({ changes: 0, total: 1, failed: 1, message: err.message });
  }

  // Step 4: Verify ACs (use Claude API with the fix task prompt)
  try {
    if (task._filePath) {
      const taskContent = await fs.readFile(task._filePath, 'utf-8');
      const hasAcs = /^\s*-\s*\[[ xX]\]/m.test(taskContent);
      if (hasAcs) {
        const prompt = buildFixTaskPrompt(task.id, task.name, taskContent, task._filePath);
        await runClaudePromptViaApi(prompt, env.CLAUDE_DEFAULT_MODEL || PANEL_DEFAULT_MODEL);
        results.push({ changes: 1, total: 1, failed: 0, message: 'ACs verified' });
      } else {
        results.push({ changes: 0, total: 1, failed: 0, message: 'No ACs to verify' });
      }
    }
  } catch (err) {
    pushLog('warn', LOG_SOURCE.panel, `AC verification failed for "${task.name}": ${err.message}`);
    results.push({ changes: 0, total: 1, failed: 1, message: err.message });
  }

  const totalChanges = results.reduce((sum, r) => sum + r.changes, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

  return {
    changes: totalChanges,
    total: results.length,
    failed: totalFailed,
    message: `All fixes complete: ${totalChanges} change(s), ${totalFailed} failure(s)`
  };
}

// ── Task Fix Endpoint ───────────────────────────────────────────────

app.post('/api/board/fix-task', async (req, res) => {
  const { taskId, fixType: rawFixType } = req.body;
  const fixType = rawFixType || 'acs';

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ ok: false, message: 'taskId is required' });
    return;
  }

  const validTaskFixTypes = ['all', 'model', 'agents', 'status', 'acs'];
  if (!validTaskFixTypes.includes(fixType)) {
    res.status(400).json({ ok: false, message: `fixType must be one of: ${validTaskFixTypes.join(', ')}` });
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

  if (fixEpicState.running) {
    res.status(409).json({ ok: false, message: 'An epic fix is already in progress.' });
    return;
  }

  // Mark task as being fixed
  fixTaskState.running = true;
  fixTaskState.type = fixType;
  state.fixTasks.set(taskId, {
    status: 'running',
    startedAt: new Date().toISOString()
  });

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

    // Handle non-acs fix types
    if (fixType !== 'acs') {
      try {
        let result;
        switch (fixType) {
          case 'model':
            result = await fixTaskModel(client, task);
            break;
          case 'agents':
            result = await fixTaskAgents(client, task);
            break;
          case 'status':
            result = await fixTaskStatus(client, task, boardConfig);
            break;
          case 'all':
            result = await fixTaskAll(client, task, env, boardConfig);
            break;
        }

        const typeLabel = { model: 'Fix Model', agents: 'Fix Agents', status: 'Fix Status', all: 'Fix All' }[fixType];
        pushLog('success', LOG_SOURCE.panel, `${typeLabel} completed for "${task.name}": ${result.message}`);

        state.fixTasks.set(taskId, {
          status: 'success',
          completedAt: new Date().toISOString()
        });

        res.json({ ok: true, ...result });
      } catch (error) {
        pushLog('error', LOG_SOURCE.panel, `Fix "${fixType}" failed for "${task.name}": ${error.message}`);
        state.fixTasks.set(taskId, {
          status: 'failed',
          error: error.message,
          completedAt: new Date().toISOString()
        });
        res.status(500).json({ ok: false, message: error.message });
      } finally {
        fixTaskState.running = false;
        fixTaskState.type = null;
      }
      return;
    }

    // Build prompt for Claude to verify and fix ACs
    const prompt = isEpic
      ? buildEpicFixPrompt(taskId, task.name, taskContent, task._filePath, childTasks)
      : buildFixTaskPrompt(taskId, task.name, taskContent, task._filePath);

    // Generate unique group ID for progressive log tracking
    const groupId = `ac-fix-${taskId}-${Date.now()}`;
    const claudeModel = task.model || env.CLAUDE_DEFAULT_MODEL || PANEL_DEFAULT_MODEL;
    const startTime = Date.now();

    // Emit progressive log: start
    pushLog('info', LOG_SOURCE.panel, `Task fix requested for: "${task.name}"`, {
      meta: {
        progressive: true,
        groupId,
        state: 'start',
        taskId,
        taskName: task.name,
        model: claudeModel,
        expandableContent: null
      }
    });

    // Build command string (claude CLI uses shell command parsing)
    let command = env.CLAUDE_COMMAND || DEFAULT_CLAUDE_COMMAND;

    if (claudeModel) {
      if (!/^claude-[a-z0-9.-]+$/.test(claudeModel)) {
        throw new Error(`Invalid model name: "${claudeModel}". Model must match pattern: claude-<alphanumeric/dots/hyphens>`);
      }
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
      const duration = `${Math.round((Date.now() - startTime) / 1000)}s`;

      // Emit progressive log: error (timeout)
      pushLog('error', LOG_SOURCE.panel, `Task fix timed out: "${task.name}"`, {
        meta: {
          progressive: true,
          groupId,
          state: 'error',
          taskId,
          taskName: task.name,
          model: claudeModel,
          duration,
          error: errorMsg
        }
      });

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

        const duration = `${Math.round((Date.now() - startTime) / 1000)}s`;

        // Emit progressive log: complete
        pushLog('success', LOG_SOURCE.panel, `Epic fix completed: "${task.name}"`, {
          meta: {
            progressive: true,
            groupId,
            state: 'complete',
            taskId,
            taskName: task.name,
            model: claudeModel,
            duration
          }
        });

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

        const duration = `${Math.round((Date.now() - startTime) / 1000)}s`;

        // Emit progressive log: complete
        pushLog('success', LOG_SOURCE.panel, `Task fix completed: "${task.name}"`, {
          meta: {
            progressive: true,
            groupId,
            state: 'complete',
            taskId,
            taskName: task.name,
            model: claudeModel,
            duration
          }
        });

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
      const duration = `${Math.round((Date.now() - startTime) / 1000)}s`;

      // Emit progressive log: error (execution failure)
      pushLog('error', LOG_SOURCE.panel, `Task fix failed: "${task.name}"`, {
        meta: {
          progressive: true,
          groupId,
          state: 'error',
          taskId,
          taskName: task.name,
          model: claudeModel,
          duration,
          error: errorMsg
        }
      });

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
  } finally {
    fixTaskState.running = false;
    fixTaskState.type = null;
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

// --- Reorder epics ---
app.post('/api/board/reorder-epics', async (req, res) => {
  const { epicIds, status } = req.body;

  if (!Array.isArray(epicIds) || epicIds.length === 0) {
    res.status(400).json({ ok: false, message: 'epicIds must be a non-empty array' });
    return;
  }

  pushLog('info', LOG_SOURCE.panel, `Reordering ${epicIds.length} epics in status "${status}"`);

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

    // Update order field for each epic (1-based)
    for (let i = 0; i < epicIds.length; i++) {
      const epicId = epicIds[i];
      const orderValue = i + 1;

      try {
        await client.updateEpicOrder(epicId, orderValue);
      } catch (err) {
        pushLog('error', LOG_SOURCE.panel, `Failed to update order for ${epicId}: ${err.message}`);
        // Continue with other epics
      }
    }

    pushLog('success', LOG_SOURCE.panel, `Reordered ${epicIds.length} epics successfully`);

    res.json({
      ok: true,
      updatedCount: epicIds.length,
      status
    });
  } catch (error) {
    const msg = error.message || String(error);
    pushLog('error', LOG_SOURCE.panel, `Failed to reorder epics: ${msg}`, { stack: error.stack });
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
  return `🔍 ACCEPTANCE CRITERIA VERIFICATION FOR: "${taskName}" (${taskId})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CONTEXT: The previous execution completed but did NOT mark Acceptance Criteria.
⚠️  This means the model (likely Sonnet) ignored AC tracking instructions.
⚠️  Your job is to verify the actual codebase and mark ACs that ARE genuinely complete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 Task file location: ${taskFilePath}

🎯 YOUR MISSION:
1. Read the task file to extract all Acceptance Criteria (markdown checkboxes)
2. For EACH AC, examine the codebase to determine if it's actually implemented
3. Use the Edit tool to update the task file and check off (\`- [x]\`) any completed ACs
4. Leave unchecked (\`- [ ]\`) any ACs that are NOT yet implemented

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 AC COMPLETION CRITERIA (Use these to judge if an AC is done)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Mark AC as COMPLETE (\`- [x]\`) ONLY if:
   - The code/files described in the AC exist in the codebase
   - The functionality described in the AC is implemented and working
   - Tests (if mentioned in the AC) exist and would pass
   - The AC's requirements are genuinely satisfied

❌ Leave AC as INCOMPLETE (\`- [ ]\`) if:
   - The code/files are missing or don't exist
   - The implementation is partial or incomplete
   - Tests are missing or would fail
   - You're uncertain or the AC is ambiguous
   - The AC describes future work or planning (not actual implementation)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 VERIFICATION WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH AC in the task file:
1. Read the AC text carefully
2. Use Grep/Glob/Read to search for evidence of implementation
3. Determine if the AC's requirements are met
4. Record your decision (complete = check, incomplete = leave unchecked)

After reviewing ALL ACs:
- Use the Edit tool to update the task file with your findings
- Provide a summary (e.g., "Verified 3/5 ACs complete, 2 remain unchecked")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 CURRENT TASK FILE CONTENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`markdown
${taskContent}
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now examine the codebase and update the task file with accurate AC completion status.`;
}

app.post('/api/claude/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const model = req.body?.model || PANEL_DEFAULT_MODEL;

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
    // Use Claude CLI via subprocess
    const { reply, workdir } = await runClaudePromptViaApi(message, model);
    const normalizedReply = reply || '(Claude returned empty output)';
    pushLog('info', LOG_SOURCE.chatClaude, truncateText(normalizedReply));
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

// ── Cross-Epic Board Context Helpers ──────────────────────────────────

/**
 * Extract the Epic Goal and Scope sections from an epic's markdown body.
 * Truncates to ~500 characters to keep prompts concise.
 */
function extractEpicGoalScope(markdown) {
  if (!markdown) return '(no description available)';

  const { body } = parseFrontmatter(markdown);
  if (!body || body.trim().length === 0) return '(no description available)';

  // Try to extract the Epic Goal line (bold paragraph pattern)
  const goalMatch = body.match(/\*\*Epic Goal\*\*:\s*(.+?)(?:\n\n|\n##)/s);
  const goalText = goalMatch ? goalMatch[1].trim() : '';

  // Try to extract the ## Scope section
  const scopeMatch = body.match(/##\s*Scope\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/);
  const scopeText = scopeMatch ? scopeMatch[1].trim() : '';

  let result = '';
  if (goalText) result += goalText;
  if (scopeText) result += (result ? '\n' : '') + scopeText;

  // Fallback: if neither pattern matched, take the first ~500 chars of the body
  if (!result) {
    result = body.trim();
  }

  // Truncate to ~500 characters
  if (result.length > 500) {
    result = result.slice(0, 497) + '...';
  }

  return result;
}

/**
 * Build a concise XML block summarizing all OTHER epics on the board.
 * Used to give cross-epic context to story generation and epic review prompts.
 *
 * @param {LocalBoardClient} client - An initialized board client
 * @param {string|null} currentEpicId - The ID of the epic being processed (excluded from output)
 * @returns {Promise<string>} XML string or empty string if no other epics
 */
async function buildBoardContext(client, currentEpicId) {
  const allTasks = await client.listTasks();

  // Identify epics: tasks with type === 'Epic' or tasks that are parents of other tasks
  const parentIds = new Set(allTasks.filter(t => t.parentId).map(t => t.parentId));
  const epics = allTasks.filter(t =>
    (t.type === 'Epic' || parentIds.has(t.id)) && t.id !== currentEpicId
  );

  if (epics.length === 0) {
    return '';
  }

  const epicSummaries = [];

  for (const epic of epics) {
    const markdown = await client.getTaskMarkdown(epic.id);
    const goalScope = extractEpicGoalScope(markdown);

    const children = allTasks
      .filter(t => t.parentId === epic.id)
      .map(t => `    - ${t.name} [${t.status}]`)
      .join('\n');

    epicSummaries.push(
      `  <epic id="${epic.id}">` +
      `\n    <name>${epic.name}</name>` +
      `\n    <status>${epic.status}</status>` +
      `\n    <goal_scope>${goalScope}</goal_scope>` +
      (children ? `\n    <children>\n${children}\n    </children>` : '\n    <children>(none)</children>') +
      `\n  </epic>`
    );
  }

  return `<board_context>
The following epics already exist on the board. Use this context to:
- Avoid generating stories that duplicate work from other epics
- Identify dependencies between this epic and others
- Maintain consistent scope and granularity across the backlog

${epicSummaries.join('\n\n')}
</board_context>`;
}

// ── Review Task with Claude ───────────────────────────────────────────

function buildReviewTaskPrompt({ name, priority, type, status, model, agents, body, boardContext }) {
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
    return `You are a technical architect reviewing an **Epic** definition for a Claude Code automation system. Your goal is to produce an Epic optimized for generating **concrete, executable child tasks** (Discovery tasks and implementation tasks) for an AI coding assistant.

<context>
This Epic will NOT be executed directly by Claude Code. It serves as a **parent container** from which child tasks are generated and executed individually.

**How child tasks work:**
- **Discovery tasks** (type: Discovery, model: claude-opus-4-6): Research tasks that investigate implementation approaches. Output saved to a \`.md\` file that subsequent tasks reference.
- **Implementation tasks** (type: UserStory): Tasks executed by Claude Code based on concrete specifications, often referencing Discovery output.

The Epic must be written at the RIGHT level of abstraction:
- DETAILED ENOUGH that each scope item maps directly to 1+ executable child tasks
- SPECIFIC ENOUGH with technical details (frameworks, APIs, patterns) to avoid generic tasks
- FOCUSED on actionable implementation detail — no narrative, motivation, or UX prose
</context>

${metadataBlock}

${boardContext || ''}

<review_instructions>
Review this Epic and produce an improved version optimized for Claude Code task generation.

**YOUR PRIMARY GOAL**: Make this Epic specific enough that the task generation step can produce **concrete, executable tasks** — not vague ones like "Implement authentication" but specific ones like "Research JWT vs session-based auth" followed by "Implement JWT token generation endpoint".

**REQUIRED SECTIONS** (in this exact order):

1. **# [Epic Name] Epic** (h1 header)

2. **Goal** (bold paragraph, NOT a section header)
   - One line starting with "**Goal**:" — concise, technical description of what this epic delivers
   - Focus on WHAT will be built, not WHY
   - Bad: "**Goal**: Build an authentication system."
   - Good: "**Goal**: Implement a complete authentication system with email/password login, signup, logout, session persistence via JWT, and password recovery via email with rate limiting."

3. **## Scope**
   - Bullet list of capabilities/features to implement
   - Each bullet = a **specific feature area** that maps to 1+ child tasks
   - Include technical specifics (frameworks, patterns, APIs) where known
   - Flag complex items with "(needs Discovery)" suffix
   - Bad: "- Authentication" / "- User management"
   - Good: "- JWT-based login with email/password, returning httpOnly cookie (needs Discovery: auth strategy)"
   - Good: "- Password recovery flow via email with time-limited tokens using nodemailer"

4. **## Acceptance Criteria**
   - Each AC must be a markdown checkbox: \`- [ ] Description\`
   - ACs must be **technically verifiable** — checkable by automated tests, build commands, or code inspection
   - Each AC should map to one or more child tasks
   - Good: "- [ ] POST /api/auth/login returns JWT on valid credentials and 401 on invalid"
   - Good: "- [ ] Account locks after 5 failed login attempts for 15 minutes"
   - Bad: "- [ ] Authentication works correctly"
   - Typically 5-10 ACs (cover error handling, edge cases, data validation)

5. **## Technical Approach**
   - Architecture decisions, libraries, frameworks, patterns
   - Flag areas needing Discovery with "(needs Discovery)" suffix
   - Include data flow, API design, state management guidance
   - This section directly informs child task generation

6. **## Dependencies**
   - Prerequisites, external services, other epics, or "- None"

7. **## Child Tasks**
   - Always: "See individual user story files in this Epic folder."

**SECTIONS TO NEVER INCLUDE:**
- ❌ "Motivation & Objectives" — Claude Code doesn't need motivation
- ❌ "User Experience & Design" — UX details go into individual child tasks
- ❌ "Open Questions & Risks" — Claude Code executes, it doesn't deliberate
- ❌ "User Story" / "As a [role], I want..."
- ❌ "Technical Tasks" / "Implementation" with numbered steps
- ❌ "Tests" with specific test files
- ❌ "Completion" / "Standard Completion Criteria"
- ❌ Manual testing or manual QA references

**TASK CONSOLIDATION PRINCIPLE:**
- The Epic should be written so that task generation produces **2-7 consolidated tasks** (not 10-15 micro-tasks).
- Each Scope bullet should map to a substantial, one-shot task — not a micro-step.
- Trivial steps (install deps, config files, TypeScript types) are STEPS within a larger task, never standalone tasks.
- Only flag "(needs Discovery)" when a genuine research decision is needed — not for every technical choice.
- Write Scope bullets with enough technical detail that a simpler model (Sonnet) can execute the resulting tasks without ambiguity.

**CROSS-EPIC AWARENESS:**
- If <board_context> is provided, check for scope overlap and note dependencies on other epics
</review_instructions>

${outputFormatBlock}`;
  }

  // ── Non-Epic prompt (UserStory, Bug, Chore, Discovery) ────────────────
  const descriptionGuidance = {
    UserStory: '- Start with 1-3 imperative sentences describing what to build. Be specific about scope and expected outcome.\n   - Do NOT use "As a [role], I want..." format — write direct implementation instructions.',
    Bug: '- Start with "**Bug**:" followed by actual behavior, expected behavior, and reproduction steps',
    Chore: '- Describe the operational goal with direct imperative instructions',
    Discovery: '- State the research goal directly and list what decisions depend on the outcome'
  };

  const acGuidance = {
    UserStory: `   - Every AC must be assertable via an automated test (unit, integration, or e2e assertion)
   - Do NOT write ACs that require manual human observation ("UI looks correct", "user sees X", "page renders", "visually verify")
   - Do NOT duplicate what the Completion section already covers (TypeScript compiling, linting, tests passing)
   - No redundancy: each AC must test a distinct behavior or code path — merge or remove overlapping ACs
   - Keep it tight: 3-8 ACs — only what meaningfully defines "done" for this task
   - GOOD: "Submit button is disabled when form has validation errors" / "POST /api/login returns 401 for invalid credentials" / "AuthContext.isAuthenticated is true after successful login"
   - BAD: "Login form renders correctly" / "User can see the dashboard" / "The component works as expected"`,

    Bug: `   - First AC: the expected behavior after the fix, assertable in a regression test
   - Additional ACs: edge cases and related scenarios that must keep working
   - Every AC must be assertable in a test — no "verify manually" or "check visually"
   - Include a regression test AC: "Regression test added to prevent recurrence"
   - Typically 3-5 ACs for a Bug`,

    Chore: `   - ACs describe a verifiable completed state (e.g., "npm ci exits with code 0", "package.json lists X as dependency")
   - For pure config/infra tasks with nothing automatable, operational verification ACs are acceptable
   - Do NOT duplicate what the Completion section covers
   - Keep it tight: 2-4 ACs for a Chore`,

    Discovery: `   - Each AC describes a specific deliverable: a decision documented, a question answered, a spike completed
   - Reference the expected artifact (e.g., "Research document created at docs/discoveries/topic.md with decision and rationale")
   - Typically 3-5 ACs for a Discovery task`
  };

  return `You are a technical architect reviewing a ${taskType} for a Claude Code automation system.

<context>
This task will be executed autonomously by Claude Code (an AI coding assistant). Claude reads the task file, follows the instructions literally, implements the acceptance criteria, and reports completion. The quality of the task file directly determines execution success. Write instructions as direct orders — no narrative or agile ceremony format.
</context>

${metadataBlock}

<review_instructions>
Review this ${taskType} and produce an improved version optimized for Claude Code execution. Follow these criteria:

1. **Task Description**:
   ${descriptionGuidance[taskType] || descriptionGuidance.UserStory}

2. **Acceptance Criteria Quality**:
   - Each AC must be a markdown checkbox: \`- [ ] Description\`
   - Each AC must be technically verifiable and unambiguous
   - Avoid vague ACs like "works correctly" — specify exact verifiable behavior
${acGuidance[taskType] || acGuidance.UserStory}

3. **Implementation Section**:
   - Break implementation into numbered, sequential steps
   - Reference specific file paths (e.g., "Create \`src/components/LoginForm.tsx\`")
   - Each step should be a concrete action Claude Code executes
   - Include commands when relevant (e.g., "Run \`npm install react-hook-form\`")

4. **Tests Section**:
   - Specify test file path (e.g., "\`__tests__/LoginForm.test.tsx\`")
   - List specific automated test cases (unit, integration, e2e)
   - Include edge case tests
   - For infrastructure/chore tasks, state "N/A — no business logic to test"
   - For Discovery tasks, state "N/A — research task, no automated tests"
   - NEVER include manual testing or manual QA steps

5. **Dependencies Section**:
   - List prerequisites, blocking tasks, required packages
   - Reference Discovery output files when applicable
   - State "None" if no dependencies

6. **Completion Section**:
   - Include checkboxes for: tests passing, build passing
   - Include a commit message following conventional commits: \`type(scope): description\`

7. **Claude Code Optimization**:
   - Instructions must be explicit — Claude Code executes literally
   - Avoid ambiguous language ("consider", "maybe", "if possible")
   - Use imperative language ("Create", "Add", "Implement", "Run")
   - No "As a user..." or "User Story" format — write direct instructions
   - Use section header "## Implementation" (not "## Technical Tasks")
   - Use section header "## Completion" (not "## Standard Completion Criteria")

8. **Task Sizing** (non-Epic types):
   - Flag tasks that are too SMALL: "Install X dependency", "Create config file", "Add TypeScript types" — these should be steps within a larger task, not standalone tasks.
   - Flag tasks that are too LARGE: tasks with 10+ ACs or 15+ implementation steps should be split.
   - Ideal size: 3-6 ACs, 4-8 implementation steps, completable in one Claude session.
   - If the task is too small, suggest merging it into a related implementation task.

9. **Model Recommendation**:
   - If the task is mechanical (install deps, rename files, config changes), suggest \`model: claude-haiku-4-5-20251001\` in the summary.
   - If the task requires deep reasoning, architectural trade-offs, or multi-file coordination, suggest \`model: claude-opus-4-6\`.
   - Default: Sonnet. Write instructions so Sonnet can execute without ambiguity — explicit paths, exact commands, concrete examples.
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
    // Gather cross-epic context only for Epic reviews
    let boardContext = '';
    if (type === 'Epic') {
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
        const allTasks = await client.listTasks();
        const matchingEpic = allTasks.find(t => t.name === name.trim() && t.type === 'Epic');
        boardContext = await buildBoardContext(client, matchingEpic ? matchingEpic.id : null);
      } catch (err) {
        pushLog('warn', LOG_SOURCE.panel, `Could not gather board context for epic review: ${err.message}`);
      }
    }

    const prompt = buildReviewTaskPrompt({ name: name.trim(), priority, type, status, model, agents, body: body.trim(), boardContext });
    const selectedModel = reviewModel || PANEL_DEFAULT_MODEL;
    const { reply } = await runClaudePromptViaApi(prompt, selectedModel);
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

// --- Generate Stories from Epic (two-phase: plan then generate one by one) ---

/**
 * Returns true if a task markdown file has complete content:
 * valid frontmatter + at least one AC checkbox + minimum body length.
 */
function isStoryComplete(markdown) {
  if (!markdown || markdown.trim().length < 200) return false;
  if (!/^---[\s\S]*?---/.test(markdown)) return false;
  return markdown.includes('- [ ]') || markdown.includes('- [x]');
}

/**
 * Phase 1: Ask Claude for story outlines only (no full bodies).
 * Fast call that returns a plan: [{name, priority, type, model, brief, dependsOn}]
 */
function buildStoryPlanPrompt({ epicName, epicBody, existingChildren, boardContext, epicAgents }) {
  const childList = existingChildren.length > 0
    ? existingChildren.map((c) => `- ${c.name}`).join('\n')
    : '(none)';

  const agentsList = epicAgents
    ? (Array.isArray(epicAgents) ? epicAgents.join(', ') : String(epicAgents))
    : null;

  return `You are a technical architect planning the task breakdown for an Epic.

<epic>
<name>${epicName}</name>
<body>
${epicBody}
</body>
</epic>

<existing_children>
${childList}
</existing_children>

${boardContext || ''}

<methodology>
**DISCOVERY-FIRST:** For complex features where the implementation approach is unclear, create a Discovery task BEFORE the implementation task. Discovery tasks use \`model: claude-opus-4-6\`.

**INCREMENTAL DELIVERY:** Order tasks so each builds on the previous — Discoveries first, then foundations, then features.

**AI-EXECUTABLE:** Every task must be fully executable by an AI agent without human intervention. Each task must have clear, unambiguous inputs and expected outputs, be completable in a single automated session, require no interactive decisions or human judgment during execution, and be self-contained or explicitly reference what prior task output it depends on.
</methodology>

<consolidation>
**MINIMIZE TASKS — AIM FOR ONE-SHOT EXECUTION:**
- Each task must deliver a MEANINGFUL increment, not a micro-step.
- MERGE trivial steps into the first implementation task (dependency installs, config changes, boilerplate setup, TypeScript types/interfaces).
- NEVER create standalone tasks for: installing packages, creating config files, setting up project structure, adding types/interfaces, renaming files. These are steps WITHIN a larger task.
- Only split into separate tasks when there is a genuine dependency boundary (Discovery output needed before implementation, or fundamentally different domain).
- Target: 2-7 tasks per Epic. If you have more than 7, consolidate.
- A task completable by Claude in under 5 minutes is too small — merge it into its neighbor.

**OPTIMIZE FOR SIMPLER MODELS:**
- Write task specifications so that claude-sonnet or claude-haiku can execute them.
- Include explicit file paths, exact commands, concrete expected outputs.
- Avoid ambiguous language requiring reasoning ("consider", "maybe", "if appropriate").
- Default to claude-sonnet. Use claude-haiku for mechanical tasks. Reserve claude-opus ONLY for Discovery and complex architectural reasoning.
</consolidation>

<model_selection>
- **claude-opus-4-6** — Discovery tasks, complex architectural work, large refactors.
- **claude-sonnet-4-5-20250929** — Standard implementation tasks: features, tests, endpoints, components.
- **claude-haiku-4-5-20251001** — Simple/mechanical tasks: config changes, dependency installs, boilerplate.
</model_selection>

${agentsList ? `<available_agents>
The following agents are defined for this Epic: ${agentsList}
Assign the most appropriate agent(s) to each task as a comma-separated string (e.g., "frontend" or "frontend, design").
Only assign agents that make sense for the task. Leave agents empty ("") if none apply.
</available_agents>` : ''}

<instructions>
1. Analyze the Epic and identify all distinct tasks needed.
2. Order tasks: Discoveries first, then foundational tasks, then features.
3. Cap at 7 tasks total. Prefer fewer, larger tasks. Do NOT include tasks from <existing_children>.
4. For each task, provide: name, priority, type, model, a brief one-sentence summary, dependsOn (list of other task names this task requires to be done first)${agentsList ? ', and agents (comma-separated string from the available agents list)' : ''}.

Return ONLY a JSON array with NO additional text or code blocks:
[
  {
    "name": "Task name (imperative form)",
    "priority": "P0|P1|P2|P3",
    "type": "Discovery|UserStory|Bug|Chore",
    "model": "claude-opus-4-6|claude-sonnet-4-5-20250929|claude-haiku-4-5-20251001",
    "brief": "One sentence describing what this task implements or researches.",
    "dependsOn": ["Name of prerequisite task"]${agentsList ? ',\n    "agents": "agent1, agent2"' : ''}
  }
]

Rules:
- Return ONLY valid JSON array, no markdown, no code blocks, no explanation.
- 2-7 tasks maximum (prefer fewer, consolidated tasks). Hard cap: 10.
- Use imperative task names: "Research X", "Implement Y", "Add Z".
- Do NOT include any task whose name matches an existing child.${agentsList ? '\n- Assign agents only from the available_agents list.' : ''}
</instructions>`;
}

function parseStoryPlanResponse(reply) {
  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let plan;
  try {
    plan = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for story plan. Raw: ' + text.slice(0, 500));
  }

  if (!Array.isArray(plan)) {
    throw new Error('Expected a JSON array for story plan but got: ' + typeof plan);
  }

  return plan
    .filter((s) => s.name && typeof s.name === 'string')
    .map((s) => ({
      name: s.name.trim(),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(s.priority) ? s.priority : 'P1',
      type: ['Discovery', 'UserStory', 'Bug', 'Chore'].includes(s.type) ? s.type : 'UserStory',
      model: s.model || PANEL_DEFAULT_MODEL,
      brief: s.brief || '',
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
      agents: s.agents && typeof s.agents === 'string' && s.agents.trim() ? s.agents.trim() : null
    }))
    .slice(0, 10);
}

/**
 * Phase 2: Generate the full markdown body for a single story.
 */
function buildSingleStoryBodyPrompt({ outline, epicName, epicBody, allOutlines, position }) {
  // Extract goal line from epic body for compact context
  const epicLines = (epicBody || '').split('\n');
  const goalLine = epicLines.find(l => l.startsWith('**Goal**') || l.startsWith('# ')) || epicName;

  // Only include direct dependencies + immediate neighbors for context
  const relevantOutlines = allOutlines.filter((t, i) => {
    if (outline.dependsOn?.includes(t.name)) return true;
    if (Math.abs(i - position) <= 1) return true;
    return false;
  });
  const relevantTasksList = relevantOutlines
    .map((t) => `[${t.type}] ${t.name} — ${t.brief}`)
    .join('\n');

  const depNotes = outline.dependsOn && outline.dependsOn.length > 0
    ? `Depends on: ${outline.dependsOn.join(', ')}.`
    : 'No dependencies.';

  const isDiscovery = outline.type === 'Discovery';

  const template = isDiscovery
    ? `# [Task Name]

Research and document the recommended approach for [topic].

## Research Questions
- [ ] What are the available options for [topic]?
- [ ] What are the trade-offs of each option?
- [ ] Which option is recommended for this project and why?

## Acceptance Criteria
- [ ] Research document created at \`docs/discoveries/[topic-slug].md\`
- [ ] Document includes comparison of alternatives with pros/cons
- [ ] Document includes a clear recommendation with justification
- [ ] Document includes implementation guidelines for the recommended approach

## Output
Save findings to: \`docs/discoveries/[topic-slug].md\`

## Dependencies
- [List prerequisite tasks or "None"]

## Completion
- [ ] Research document created and complete
- [ ] Commit: \`docs(discovery): research [topic]\``
    : `# [Task Name]

[1-3 sentences: imperative description of what to build. Be specific about scope and expected outcome. No "As a user..." format.]

## Acceptance Criteria
- [ ] [Technically verifiable condition — checkable by tests, build, or code inspection]
(3-6 ACs. Each must be specific, verifiable, and actionable.)

## Implementation
1. [Step with specific file path, e.g., "Create \`src/components/LoginForm.tsx\`"]
2. [Concrete implementation step]
(Numbered, sequential. Each step is a concrete action Claude Code executes.)

## Tests
- File: \`[specific test file path]\`
- [Specific test case 1]
- [Specific test case 2]
- Or "N/A — infrastructure/research task"
- NEVER include manual testing steps

## Dependencies
- [Reference Discovery output files: e.g., "See \`docs/discoveries/auth-strategy.md\`"]
- [Or "None"]

## Completion
- [ ] Tests pass (or N/A)
- [ ] Build passes
- [ ] Commit: \`type(scope): description\``;

  return `You are writing a detailed task specification for an AI coding assistant (Claude Code). The task will be executed autonomously in a single session. Write instructions as direct commands.

<epic_context>
Epic: ${epicName}
${goalLine}
</epic_context>

<related_tasks>
${relevantTasksList}
</related_tasks>

<current_task>
Position: ${position + 1} of ${allOutlines.length}
Name: ${outline.name}
Type: ${outline.type}
Priority: ${outline.priority}
Brief: ${outline.brief}
${depNotes}
</current_task>

<ac_rules>
STRICT rules for Acceptance Criteria:
1. Every AC must be assertable via an automated test — GOOD: "POST /api/login returns 401 for invalid credentials" / BAD: "User sees an error message".
2. Do NOT include "TypeScript compiles", "linter passes", or "tests pass" in ACs — those go in Completion.
3. No redundancy — each AC tests a distinct behavior.
4. Keep it tight: 3-6 ACs per story.
</ac_rules>

<instructions>
Write the complete markdown body for this task using the template below.

Template:
${template}

Rules:
- If this task depends on a Discovery, reference the Discovery output file in Dependencies (e.g., "See \`docs/discoveries/auth-strategy.md\`").
- Write implementation steps as direct commands (e.g., "Create src/auth.ts" not "You should create...").
- Return ONLY the markdown body — no YAML frontmatter, no wrapping code blocks.
- NEVER include manual tests — only automated tests (unit, integration, e2e).
- Use imperative language throughout.
</instructions>`;
}

function parseSingleStoryBodyResponse(reply) {
  const text = String(reply || '').trim();
  // Strip wrapping code blocks if Claude added them
  const codeBlockMatch = text.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/);
  return codeBlockMatch ? codeBlockMatch[1].trim() : text;
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

     [1-3 sentences: imperative description. No "As a user..." format.]

     ## Acceptance Criteria
     - [ ] [Technically verifiable condition]
     (3-6 ACs. Each must be specific, verifiable, and actionable.)

     ## Implementation
     1. [Step with specific file path]
     2. [Concrete implementation step]
     (Numbered, sequential.)

     ## Tests
     - File: \`[specific test file path]\`
     - [Specific test case]
     - Or "N/A — infrastructure task"
     - NEVER include manual tests

     ## Dependencies
     - [Reference or "None"]

     ## Completion
     - [ ] Tests pass (or N/A)
     - [ ] Build passes
     - [ ] Commit: \`type(scope): description\`

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
      model: s.model || PANEL_DEFAULT_MODEL,
      agents: Array.isArray(s.agents) ? s.agents : [],
      body: s.body
    });
  }

  if (normalized.length === 0) {
    throw new Error('Claude returned no valid stories. Raw response: ' + text.slice(0, 500));
  }

  return normalized;
}

app.get('/api/board/generate-stories/status', async (req, res) => {
  const { epicId } = req.query;
  if (epicId) {
    // Return session for a specific epic
    const session = generateStoriesSessions.get(epicId);
    if (!session) {
      // Check disk for a saved plan from a previous process
      const diskPlan = await loadGeneratePlan(epicId);
      if (diskPlan?.canResume && Array.isArray(diskPlan?.plan)) {
        res.json({ running: false, epicId, created: diskPlan.created || 0, total: diskPlan.plan.length, failed: diskPlan.failed || 0, phase: null, errors: diskPlan.errors || [], canResume: true });
      } else {
        res.json({ running: false, epicId, created: 0, total: 0, failed: 0, phase: null, errors: [], canResume: false });
      }
      return;
    }
    // If session is idle and has no plan, check disk (covers restart with session map entry present)
    if (!session.plan && !session.running) {
      const diskPlan = await loadGeneratePlan(epicId);
      if (diskPlan?.canResume && Array.isArray(diskPlan?.plan)) {
        session.plan = diskPlan.plan;
        session.canResume = true;
        session.epicName = diskPlan.epicName;
        session.errors = diskPlan.errors || [];
      }
    }
    res.json({ ...session, errors: [...session.errors] });
  } else {
    // Return all active sessions — used by frontend on mount to resume any in-progress generations
    const sessions = Array.from(generateStoriesSessions.values()).map((s) => ({ ...s, errors: [...s.errors] }));
    res.json({ sessions });
  }
});

app.post('/api/board/generate-stories', async (req, res) => {
  const { epicId } = req.body;

  if (!epicId || typeof epicId !== 'string' || !epicId.trim()) {
    res.status(400).json({ ok: false, message: 'epicId is required.' });
    return;
  }

  const session = getGenerateSession(epicId);

  if (session.running) {
    res.status(409).json({ ok: false, message: 'Story generation is already in progress for this epic. Please wait.' });
    return;
  }

  // Load from disk if in-memory has no plan (handles process restarts)
  if (!session.plan && !session.running) {
    const diskPlan = await loadGeneratePlan(epicId);
    if (diskPlan?.canResume && Array.isArray(diskPlan?.plan)) {
      session.plan = diskPlan.plan;
      session.canResume = true;
      session.epicName = diskPlan.epicName;
      session.errors = diskPlan.errors || [];
    }
  }

  // Check if we can resume from a saved Phase 1 plan (same epic, phase 1 already done)
  const isResuming = session.canResume && session.plan !== null;

  // Initialize state and respond immediately so the client never times out
  Object.assign(session, {
    running: true,
    epicId,
    epicName: isResuming ? session.epicName : null,
    created: 0,
    total: 0,
    failed: 0,
    phase: isResuming ? 'generating' : 'planning',
    errors: [],
    canResume: false
  });
  if (!isResuming) session.plan = null;

  pushLog('info', LOG_SOURCE.panel, isResuming
    ? `Resuming story generation for Epic: "${epicId}" (reusing Phase 1 plan)`
    : `Starting story generation for Epic: "${epicId}"`);
  res.json({ ok: true, started: true });

  // Run generation in background
  (async () => {
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

      const epicMarkdown = await client.getTaskMarkdown(epicId);
      if (!epicMarkdown) {
        pushLog('error', LOG_SOURCE.panel, `Story generation failed: Epic not found: ${epicId}`);
        return;
      }

      const { frontmatter: epicFields, body: epicBody } = parseFrontmatter(epicMarkdown);
      const epicName = (epicFields && epicFields.name) || epicId;
      session.epicName = epicName;

      if (!epicBody || epicBody.trim().length < 20) {
        pushLog('error', LOG_SOURCE.panel, `Story generation failed: Epic "${epicName}" has no description or description is too short.`);
        return;
      }

      const allTasks = await client.listTasks();
      const existingChildren = allTasks.filter((t) => t.parentId === epicId);

      // Check completeness of each existing child to detect files created but not fully written
      const childWithContent = await Promise.all(
        existingChildren.map(async (c) => {
          const md = await client.getTaskMarkdown(c.id);
          return { child: c, complete: isStoryComplete(md) };
        })
      );
      const incompleteChildren = childWithContent.filter((x) => !x.complete).map((x) => x.child);

      // Delete incomplete files so they are cleanly regenerated (no name-matching required)
      if (incompleteChildren.length > 0) {
        pushLog('warn', LOG_SOURCE.panel, `Deleting ${incompleteChildren.length} incomplete story file(s) for "${epicName}" before regenerating.`);
        for (const child of incompleteChildren) {
          await client.deleteTask(child.id);
        }
      }

      // Re-read children after deletions — only complete files remain
      const activeChildren = incompleteChildren.length > 0
        ? (await client.listTasks()).filter((t) => t.parentId === epicId)
        : existingChildren.filter((_, i) => childWithContent[i].complete);
      const activeChildNames = new Set(activeChildren.map((c) => c.name.toLowerCase().trim()));

      let storyPlan;
      let storiesToGenerate;

      if (isResuming) {
        // Reuse saved Phase 1 plan — skip Phase 1 entirely
        storyPlan = session.plan;
        // Skip stories that still have complete files — everything else needs to be generated
        storiesToGenerate = storyPlan.filter((s) => !activeChildNames.has(s.name.toLowerCase().trim()));
        session.total = storiesToGenerate.length;
        session.phase = 'generating';
        if (storiesToGenerate.length === 0) {
          pushLog('success', LOG_SOURCE.panel, `All stories already exist for "${epicName}". Nothing to resume.`);
          return;
        }
        pushLog('info', LOG_SOURCE.panel, `Resuming: ${storiesToGenerate.length} of ${storyPlan.length} stories remaining for "${epicName}". Generating one by one...`);
      } else {
        // Phase 1: Generate story plan (outlines only — fast call)
        // activeChildren only has complete files (incompletes were deleted above)
        const boardContext = await buildBoardContext(client, epicId);
        pushLog('info', LOG_SOURCE.panel, `Planning stories for "${epicName}"...`);
        const planPrompt = buildStoryPlanPrompt({
          epicName,
          epicBody: epicBody.trim(),
          existingChildren: activeChildren.map((c) => ({ name: c.name })),
          boardContext,
          epicAgents: epicFields && epicFields.agents ? epicFields.agents : null
        });
        let planReply;
        try {
          ({ reply: planReply } = await runClaudePromptViaApi(planPrompt, PANEL_DEFAULT_MODEL));
        } catch (planErr) {
          pushLog('error', LOG_SOURCE.claude, `Phase 1 (planning) failed for "${epicName}": ${planErr.message}`, {
            stderr: planErr.stderr || null,
            stdout: planErr.stdout || null,
            exitCode: planErr.exitCode || null,
            signal: planErr.signal || null
          });
          planErr._loggedByPhase1 = true;
          throw planErr;
        }
        storyPlan = parseStoryPlanResponse(planReply);
        session.plan = storyPlan; // save plan for potential resume
        // Persist plan to disk so it survives process restarts
        await saveGeneratePlan(epicId, {
          epicId,
          epicName: session.epicName,
          plan: storyPlan,
          canResume: true,
          created: 0,
          failed: 0,
          errors: [],
          savedAt: new Date().toISOString()
        });
        storiesToGenerate = storyPlan;
        session.total = storyPlan.length;
        session.phase = 'generating';
        pushLog('info', LOG_SOURCE.panel, `Story plan ready: ${storyPlan.length} tasks for "${epicName}". Generating one by one...`);
      }

      // Phase 2: Generate each story body individually
      // activeChildren.length = only complete children; new filenames are indexed after them
      for (let i = 0; i < storiesToGenerate.length; i++) {
        const outline = storiesToGenerate[i];
        try {
          const storyPrompt = buildSingleStoryBodyPrompt({
            outline,
            epicName,
            epicBody: epicBody.trim(),
            allOutlines: storyPlan,
            position: i
          });

          const { reply: storyReply } = await runClaudePromptViaApi(storyPrompt, PANEL_DEFAULT_MODEL);
          const storyBody = parseSingleStoryBodyResponse(storyReply);

          const taskFields = {
            name: outline.name,
            priority: outline.priority,
            type: outline.type || 'UserStory',
            status: 'Not Started',
            model: outline.model || (outline.type === 'Discovery' ? 'claude-opus-4-6' : PANEL_DEFAULT_MODEL),
            ...(outline.agents ? { agents: outline.agents } : {})
          };

          const fileName = generateStoryFileName(epicId, activeChildren.length + i, outline.name);
          await client.createTask(taskFields, storyBody, { epicId, fileName });

          session.created++;
          pushLog('success', LOG_SOURCE.claude, `Story created (${session.created}/${session.total}): "${outline.name}"`);
        } catch (err) {
          session.failed++;
          session.errors.push(outline.name);
          pushLog('error', LOG_SOURCE.claude, `Failed to create story "${outline.name}": ${err.message}`, {
            stderr: err.stderr || null,
            stdout: err.stdout || null,
            exitCode: err.exitCode || null,
            signal: err.signal || null
          });
        }
      }

      const discoveryCount = storiesToGenerate.filter((s) => s.type === 'Discovery').length;
      const storyCount = storiesToGenerate.filter((s) => s.type !== 'Discovery').length;
      const typeBreakdown = discoveryCount > 0 ? ` (${discoveryCount} Discovery, ${storyCount} UserStory)` : '';
      const summary = `Generated ${session.created}/${session.total} tasks${typeBreakdown} for "${epicName}"${session.failed > 0 ? ` (${session.failed} failed)` : ''}`;
      pushLog('success', LOG_SOURCE.claude, summary);
    } catch (error) {
      if (!error._loggedByPhase1) {
        pushLog('error', LOG_SOURCE.claude, `Story generation failed (${session.phase || 'setup'}): ${error.message}`, {
          stderr: error.stderr || null,
          stdout: error.stdout || null,
          exitCode: error.exitCode || null,
          signal: error.signal || null,
          stack: error.stack || null
        });
      }
      session.failed++;
    } finally {
      session.running = false;
      session.phase = null;
      // Preserve plan for resume if Phase 2 had failures; clear on full success or Phase 1 failure
      if (session.failed > 0 && session.plan !== null) {
        session.canResume = true;
        // Update disk state so resume survives a process restart
        await saveGeneratePlan(epicId, {
          epicId,
          epicName: session.epicName,
          plan: session.plan,
          canResume: true,
          created: session.created,
          failed: session.failed,
          errors: session.errors,
          savedAt: new Date().toISOString()
        });
      } else {
        session.canResume = false;
        session.plan = null;
        // Clean up disk file on full success or Phase 1 failure (nothing to resume)
        await deleteGeneratePlan(epicId);
        // Session is complete with no resume data — remove from map to free memory
        generateStoriesSessions.delete(epicId);
      }
    }
  })();
});

// ── Epic Fix Handlers ─────────────────────────────────────────────────

/**
 * Fix Models — Use Claude to analyze task complexity and assign the best model.
 */
async function fixEpicModels(client, children) {
  const needsFix = [];
  for (const child of children) {
    const markdown = await client.getTaskMarkdown(child.id);
    if (!markdown) continue;
    const { frontmatter, body } = parseFrontmatter(markdown);
    if (!frontmatter.model || !frontmatter.model.trim()) {
      needsFix.push({ id: child.id, name: child.name, frontmatter, body });
    }
  }

  if (needsFix.length === 0) {
    return { changes: 0, total: children.length, failed: 0, message: 'All tasks already have models' };
  }

  const prompt = `You are assigning Claude AI models to development tasks based on their complexity.

Available models (choose the most appropriate for each task):
- claude-opus-4-6 — Most capable. Use for: complex architecture, multi-file refactors, intricate business logic, security-critical code, tasks with many acceptance criteria, debugging hard-to-reproduce bugs, tasks requiring deep reasoning.
- claude-sonnet-4-5-20250929 — Balanced. Use for: standard feature implementation, moderate complexity tasks, CRUD operations, UI components, API endpoints, most typical development work.
- claude-haiku-4-5-20251001 — Fast and lightweight. Use for: simple chores, dependency installs, config changes, renaming/reformatting, documentation, small fixes, boilerplate generation.

For each task below, read the description and acceptance criteria carefully, then assign the best model.

Tasks:
${needsFix.map((t, i) => `${i + 1}. "${t.name}"\n${(t.body || '').slice(0, 500)}`).join('\n\n')}

Return ONLY a JSON array (no markdown, no code blocks):
[{ "index": 1, "model": "claude-sonnet-4-5-20250929", "reason": "brief reason" }, ...]

Rules:
- "index" is 1-based, matching the task number above
- "model" must be one of the three model IDs listed above (exact string)
- "reason" is a brief explanation (max 15 words) of why that model fits
- Return valid JSON only, no extra text`;

  const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);

  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for model assignment');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array for model assignment');
  }

  const validModels = ['claude-opus-4-6', PANEL_DEFAULT_MODEL, 'claude-haiku-4-5-20251001'];
  let fixed = 0;
  let failed = 0;

  for (const item of parsed) {
    const idx = (item.index || 0) - 1;
    const task = needsFix[idx];
    if (!task || !item.model || !validModels.includes(item.model)) continue;
    try {
      task.frontmatter.model = item.model;
      await client.updateTask(task.id, task.frontmatter, task.body);
      fixed++;
      const shortModel = item.model.replace('claude-', '').replace(/-\d{8}$/, '');
      pushLog('info', LOG_SOURCE.panel, `  Set model for "${task.name}" → ${shortModel}${item.reason ? ` (${item.reason})` : ''}`);
    } catch (err) {
      failed++;
      pushLog('warn', LOG_SOURCE.panel, `  Failed to set model for "${task.name}": ${err.message}`);
    }
  }

  return {
    changes: fixed,
    total: children.length,
    failed,
    message: fixed > 0 ? `Assigned models to ${fixed} task(s)` : 'No model changes made'
  };
}

/**
 * Fix Agents — Use Claude to analyze ALL child tasks and assign/reassign agents.
 */
async function fixEpicAgents(client, children) {
  const allTasks = [];
  for (const child of children) {
    const markdown = await client.getTaskMarkdown(child.id);
    if (!markdown) continue;
    const { frontmatter, body } = parseFrontmatter(markdown);
    const currentAgents = frontmatter.agents
      ? (Array.isArray(frontmatter.agents) ? frontmatter.agents.join(', ') : String(frontmatter.agents).trim())
      : '';
    allTasks.push({ id: child.id, name: child.name, frontmatter, body, currentAgents });
  }

  if (allTasks.length === 0) {
    return { changes: 0, total: children.length, failed: 0, message: 'No tasks found' };
  }

  const prompt = `You are assigning developer agents to user stories based on their content.

Available agent types: frontend, backend, design, devops, qa, database, security, api

For each task below, analyze the description, acceptance criteria, and technical tasks carefully, then assign 1-3 appropriate agents.

Tasks:
${allTasks.map((t, i) => `${i + 1}. "${t.name}"${t.currentAgents ? ` [current: ${t.currentAgents}]` : ' [no agents]'}\n${(t.body || '').slice(0, 500)}`).join('\n\n')}

Return ONLY a JSON array (no markdown, no code blocks):
[{ "index": 1, "agents": ["frontend", "design"], "reason": "brief reason" }, ...]

Rules:
- "index" is 1-based, matching the task number above
- Each task gets 1-3 agents from the available list
- "reason" is a brief explanation (max 15 words) of why those agents fit
- If a task's current agents are already correct, assign the same agents
- Return valid JSON only, no extra text`;

  const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);

  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for agents assignment');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array for agents assignment');
  }

  let fixed = 0;
  let failed = 0;

  for (const item of parsed) {
    const idx = (item.index || 0) - 1;
    const task = allTasks[idx];
    if (!task || !Array.isArray(item.agents) || item.agents.length === 0) continue;

    const newAgents = item.agents.join(', ');
    if (newAgents === task.currentAgents) continue; // No change needed

    try {
      task.frontmatter.agents = newAgents;
      await client.updateTask(task.id, task.frontmatter, task.body);
      fixed++;
      pushLog('info', LOG_SOURCE.panel, `  Set agents for "${task.name}" → ${newAgents}${item.reason ? ` (${item.reason})` : ''}`);
    } catch (err) {
      failed++;
      pushLog('warn', LOG_SOURCE.panel, `  Failed to set agents for "${task.name}": ${err.message}`);
    }
  }

  return {
    changes: fixed,
    total: allTasks.length,
    failed,
    message: fixed > 0 ? `Updated agents on ${fixed} task(s)` : 'All agents are already correct'
  };
}

/**
 * Fix Status — Analyze each task's AC completion and sync status accordingly.
 */
async function fixEpicStatus(client, children, boardConfig) {
  const { notStarted, inProgress, done } = boardConfig.board.statuses;
  let fixed = 0;
  let analyzed = 0;

  for (const child of children) {
    const markdown = await client.getTaskMarkdown(child.id);
    if (!markdown) continue;

    const { frontmatter, body } = parseFrontmatter(markdown);
    const unchecked = (body.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
    const checked = (body.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
    const total = unchecked + checked;
    const currentStatus = (frontmatter.status || '').trim();

    analyzed++;

    if (total === 0) {
      pushLog('info', LOG_SOURCE.panel, `  "${child.name}": no ACs found, status "${currentStatus}" — skipped`);
      continue;
    }

    let newStatus = null;
    if (unchecked === 0 && checked > 0 && currentStatus !== done) {
      newStatus = done;
    } else if (checked > 0 && unchecked > 0 && currentStatus === notStarted) {
      newStatus = inProgress;
    } else if (checked === 0 && unchecked > 0 && currentStatus === done) {
      newStatus = notStarted;
    }

    if (newStatus) {
      await client.updateTaskStatus(child.id, newStatus);
      fixed++;
      pushLog('info', LOG_SOURCE.panel, `  "${child.name}": ${checked}/${total} ACs done — ${currentStatus} → ${newStatus}`);
    } else {
      pushLog('info', LOG_SOURCE.panel, `  "${child.name}": ${checked}/${total} ACs done — status "${currentStatus}" is correct`);
    }
  }

  return {
    changes: fixed,
    total: analyzed,
    failed: 0,
    message: fixed > 0 ? `Fixed status on ${fixed} of ${analyzed} task(s)` : `Analyzed ${analyzed} task(s) — all statuses are consistent`
  };
}

/**
 * Fix Stories — Restructure, reorder, and complete stories (existing logic).
 */
async function fixEpicStoriesLogic(client, epicId, children, epicMarkdown) {
  const { frontmatter: epicFields } = parseFrontmatter(epicMarkdown);
  const epicName = (epicFields && epicFields.name) || epicId;

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
      id: child.id, name: child.name, fileName, frontmatter, body,
      hasTitle, hasNumber, hasContent, hasAcs, hasModel, hasAgents, hasType, hasPriority
    });
  }

  if (allStories.length === 0) {
    return { changes: 0, total: 0, failed: 0, message: 'No stories found' };
  }

  const prompt = buildFixEpicStoriesPrompt({ epicName, stories: allStories });
  const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);
  const fixedStories = parseFixEpicStoriesResponse(reply);

  const matchedPairs = [];
  let failed = 0;
  for (let i = 0; i < fixedStories.length; i++) {
    const story = fixedStories[i];
    const original = allStories.find((s) => s.fileName === story.fileName)
      || allStories.find((s) => s.name === story.name);
    if (!original) {
      pushLog('warn', LOG_SOURCE.panel, `Could not match fixed story "${story.name}" to an existing file`);
      failed++;
      continue;
    }
    matchedPairs.push({ original, fixed: story, newIndex: i });
  }

  for (const { original, fixed: story } of matchedPairs) {
    try {
      await client.updateTask(original.id, {
        name: story.name, priority: story.priority, type: story.type,
        status: original.frontmatter?.status || 'Not Started',
        model: story.model, agents: story.agents
      }, story.body);
    } catch (err) {
      pushLog('warn', LOG_SOURCE.panel, `Failed to update story "${story.name}": ${err.message}`);
      failed++;
    }
  }

  // Phase 2: Rename files to correct sequential names
  const { generateStoryFileName } = await import('../src/local/helpers.js');
  await client.listTasks();

  const renameOps = [];
  const fixed = [];
  for (const { original, fixed: story, newIndex } of matchedPairs) {
    const correctFileName = generateStoryFileName(epicId, newIndex, story.name) + '.md';
    const currentFileName = original.fileName + '.md';
    if (currentFileName === correctFileName) {
      fixed.push({ id: original.id, name: story.name, fileName: correctFileName });
      continue;
    }
    renameOps.push({ currentId: original.id, currentFileName, tempFileName: `_temp_fix_${newIndex}_${Date.now()}.md`, correctFileName, storyName: story.name });
  }

  for (const op of renameOps) {
    try {
      const result = await client.renameTask(op.currentId, op.tempFileName);
      op.tempId = result.renamed ? result.newId : op.currentId;
    } catch (err) {
      pushLog('warn', LOG_SOURCE.panel, `Failed to temp-rename "${op.currentFileName}": ${err.message}`);
      op.tempId = op.currentId;
      op.skipFinalRename = true;
      failed++;
    }
  }

  if (renameOps.length > 0) await client.listTasks();

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

  return {
    changes: fixed.length,
    total: allStories.length,
    failed,
    message: fixed.length > 0 ? `Fixed ${fixed.length} of ${allStories.length} stories` : 'All stories are complete'
  };
}

/**
 * Verify ACs — Use Claude to verify ACs against codebase for all tasks.
 */
async function fixEpicAcs(client, children, env) {
  // Collect all children that have ACs
  const tasksWithAcs = [];
  for (const child of children) {
    if (!child._filePath) continue;
    const taskContent = await fs.readFile(child._filePath, 'utf-8');
    const hasAcs = /^\s*-\s*\[[ xX]\]/m.test(taskContent);
    if (hasAcs) {
      tasksWithAcs.push({ child, taskContent });
    }
  }

  if (tasksWithAcs.length === 0) {
    return { changes: 0, total: children.length, failed: 0, message: 'No tasks with ACs to verify' };
  }

  pushLog('info', LOG_SOURCE.panel, `  Found ${tasksWithAcs.length} task(s) with ACs to verify`);

  let verified = 0;
  let failed = 0;

  for (const { child, taskContent } of tasksWithAcs) {
    const unchecked = (taskContent.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
    const checked = (taskContent.match(/^\s*-\s*\[x\]\s+/gim) || []).length;
    const status = (child.status || '').trim();

    const prompt = buildFixTaskPrompt(child.id, child.name, taskContent, child._filePath);

    try {
      pushLog('info', LOG_SOURCE.panel, `  Verifying "${child.name}" (${checked}/${checked + unchecked} ACs, status: ${status})...`);
      await runClaudePromptViaApi(prompt, env.CLAUDE_DEFAULT_MODEL || PANEL_DEFAULT_MODEL);
      verified++;
      pushLog('info', LOG_SOURCE.panel, `  AC verification complete for "${child.name}"`);
    } catch (err) {
      failed++;
      pushLog('warn', LOG_SOURCE.panel, `  AC verification failed for "${child.name}": ${err.message}`);
    }
  }

  return {
    changes: verified,
    total: tasksWithAcs.length,
    failed,
    message: verified > 0 ? `Verified ACs on ${verified} task(s)` : 'No ACs needed verification'
  };
}

/**
 * Fix All — Run all fix types sequentially.
 */
async function fixEpicAll(client, children, epicId, epicMarkdown, env, boardConfig) {
  const results = [];

  pushLog('info', LOG_SOURCE.panel, '  Step 1/5: Fixing models...');
  results.push(await fixEpicModels(client, children));

  pushLog('info', LOG_SOURCE.panel, '  Step 2/5: Fixing status...');
  results.push(await fixEpicStatus(client, children, boardConfig));

  pushLog('info', LOG_SOURCE.panel, '  Step 3/5: Fixing agents...');
  results.push(await fixEpicAgents(client, children));

  pushLog('info', LOG_SOURCE.panel, '  Step 4/5: Fixing stories...');
  results.push(await fixEpicStoriesLogic(client, epicId, children, epicMarkdown));

  // Re-read children after stories fix (files may have been renamed)
  const allTasks = await client.listTasks();
  const updatedChildren = allTasks.filter((t) => t.parentId === epicId);

  pushLog('info', LOG_SOURCE.panel, '  Step 5/5: Verifying ACs...');
  results.push(await fixEpicAcs(client, updatedChildren, env));

  const totalChanges = results.reduce((sum, r) => sum + r.changes, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

  return {
    changes: totalChanges,
    total: children.length,
    failed: totalFailed,
    message: `All fixes complete: ${totalChanges} change(s)${totalFailed > 0 ? `, ${totalFailed} failure(s)` : ''}`,
    breakdown: results.map((r) => r.message)
  };
}

// ── Epic Fix Endpoint ────────────────────────────────────────────────

app.post('/api/board/fix-epic', async (req, res) => {
  const { epicId, fixType } = req.body;

  if (!epicId || typeof epicId !== 'string' || !epicId.trim()) {
    res.status(400).json({ ok: false, message: 'epicId is required.' });
    return;
  }

  const validTypes = ['all', 'models', 'agents', 'status', 'stories', 'acs'];
  if (!fixType || !validTypes.includes(fixType)) {
    res.status(400).json({ ok: false, message: `fixType must be one of: ${validTypes.join(', ')}` });
    return;
  }

  if (fixEpicState.running) {
    res.status(409).json({ ok: false, message: `A fix operation is already in progress (${fixEpicState.type}).` });
    return;
  }

  // Also check legacy fix-epic-stories state
  if (fixEpicStoriesState.running) {
    res.status(409).json({ ok: false, message: 'A story fix is already in progress.' });
    return;
  }

  if (fixTaskState.running) {
    res.status(409).json({ ok: false, message: 'A task fix is already in progress.' });
    return;
  }

  fixEpicState.running = true;
  fixEpicState.type = fixType;
  pushLog('info', LOG_SOURCE.panel, `Fixing Epic "${epicId}" — type: ${fixType}`);

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

    const epicMarkdown = await client.getTaskMarkdown(epicId);
    if (!epicMarkdown) {
      res.status(404).json({ ok: false, message: `Epic not found: ${epicId}` });
      return;
    }

    const allTasks = await client.listTasks();
    const children = allTasks.filter((t) => t.parentId === epicId);

    if (children.length === 0) {
      res.status(400).json({ ok: false, message: 'Epic has no child tasks.' });
      return;
    }

    let result;
    switch (fixType) {
      case 'models':
        result = await fixEpicModels(client, children);
        break;
      case 'agents':
        result = await fixEpicAgents(client, children);
        break;
      case 'status':
        result = await fixEpicStatus(client, children, boardConfig);
        break;
      case 'stories':
        result = await fixEpicStoriesLogic(client, epicId, children, epicMarkdown);
        break;
      case 'acs':
        result = await fixEpicAcs(client, children, env);
        break;
      case 'all':
        result = await fixEpicAll(client, children, epicId, epicMarkdown, env, boardConfig);
        break;
    }

    pushLog('success', LOG_SOURCE.panel, `Fix "${fixType}" completed for "${epicId}": ${result.message}`);
    res.json({ ok: true, ...result });
  } catch (error) {
    pushLog('error', LOG_SOURCE.panel, `Fix "${fixType}" failed for "${epicId}": ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    fixEpicState.running = false;
    fixEpicState.type = null;
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

    const { reply } = await runClaudePromptViaApi(prompt, PANEL_DEFAULT_MODEL);
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

// ── Idea to Epics — Brainstorming & Epic Generation ──────────────────

// ── Idea Session: Auto-Compact & Timeout Helpers ─────────────────────

/**
 * Estimate token count from text (rough: ~4 chars per token).
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Build a compaction prompt that summarizes older messages into a concise
 * context block, preserving key decisions and the current plan state.
 */
function buildCompactionPrompt(messagesToCompact, currentPlan) {
  const block = messagesToCompact
    .map((m) => `[${m.role === 'user' ? 'User' : 'Assistant'}]\n${m.content}`)
    .join('\n\n');

  return `Summarize this brainstorming conversation into a compact context block (max 800 words). Preserve:
- Key product decisions and agreed-upon features
- User preferences, constraints, and priorities stated
- Important technical decisions or design choices
- Any open questions or unresolved items
- The user's language and tone

Do NOT include the plan itself (it is tracked separately). Focus only on context that would be lost if these messages were removed.

Write the summary as a structured bullet list grouped by topic. Write in the same language as the conversation.

<conversation>
${block}
</conversation>

${currentPlan ? `<current_plan_for_reference>\n${currentPlan}\n</current_plan_for_reference>` : ''}

Return ONLY the summary, no preamble or explanation.`;
}

/**
 * Auto-compact: if the conversation exceeds thresholds, summarize older
 * messages into a single "[system] context_summary" message, keeping
 * the most recent messages intact.
 *
 * Thresholds:
 * - COMPACT_AFTER_PAIRS: trigger compaction after this many user-assistant pairs (default: 8)
 * - KEEP_RECENT_PAIRS: number of recent pairs to preserve verbatim (default: 3)
 * - TOKEN_THRESHOLD: estimated token count that triggers compaction (default: 12000)
 *
 * Returns { messages, compacted } — the (possibly compacted) message array and a flag.
 */
const COMPACT_AFTER_PAIRS = 8;
const KEEP_RECENT_PAIRS = 3;
const TOKEN_THRESHOLD = 12000;

async function autoCompactMessages(session, logger) {
  const msgs = session.messages;
  const pairs = Math.floor(msgs.length / 2);
  const totalTokens = estimateTokens(msgs.map(m => m.content).join('\n'));

  // Check if compaction is needed
  if (pairs < COMPACT_AFTER_PAIRS && totalTokens < TOKEN_THRESHOLD) {
    return { messages: msgs, compacted: false };
  }

  // Split: messages to compact vs. messages to keep
  const keepCount = KEEP_RECENT_PAIRS * 2; // pairs → individual messages
  if (msgs.length <= keepCount + 2) {
    // Not enough messages to compact meaningfully
    return { messages: msgs, compacted: false };
  }

  const toCompact = msgs.slice(0, msgs.length - keepCount);
  const toKeep = msgs.slice(msgs.length - keepCount);

  logger.info(`Auto-compacting ${toCompact.length} older messages (keeping ${toKeep.length} recent)...`);

  try {
    const compactPrompt = buildCompactionPrompt(toCompact, session.plan);
    const { reply: summary } = await runClaudePromptViaApi(compactPrompt, 'claude-haiku-4-5-20251001');
    const trimmedSummary = String(summary || '').trim();

    if (!trimmedSummary || trimmedSummary.length < 50) {
      logger.warn('Compaction returned insufficient summary, skipping');
      return { messages: msgs, compacted: false };
    }

    // Replace older messages with a single context summary
    const compactedMessages = [
      { role: 'system', content: `[Context from earlier conversation — ${toCompact.length} messages compacted]\n\n${trimmedSummary}` },
      ...toKeep
    ];

    // Update session in-place
    session.messages = compactedMessages;

    logger.success(`Compacted: ${msgs.length} → ${compactedMessages.length} messages (~${estimateTokens(trimmedSummary)} tokens saved)`);
    return { messages: compactedMessages, compacted: true };
  } catch (err) {
    logger.warn(`Auto-compaction failed (non-fatal): ${err.message}`);
    return { messages: msgs, compacted: false };
  }
}

/**
 * Run a Claude prompt with timeout handling and one automatic retry.
 * On first timeout, retries with a shorter prompt hint.
 */
async function runClaudeWithRetry(prompt, model, timeoutMs, logger) {
  try {
    return await runClaudePromptViaApi(prompt, model, timeoutMs);
  } catch (err) {
    const isTimeout = err.message && err.message.includes('timed out');
    if (!isTimeout) throw err;

    logger.warn('Claude timed out, retrying with shorter timeout hint...');

    // Retry once: append a hint to keep the response shorter
    const retryPrompt = prompt + `\n\n<system_note>IMPORTANT: The previous attempt timed out. Please keep your response concise. For the <reply>, limit to 2-3 short paragraphs. For the <plan>, only update sections that changed — you can keep unchanged sections brief with "[no changes]" markers that you'll expand in the next turn.</system_note>`;

    try {
      return await runClaudePromptViaApi(retryPrompt, model, timeoutMs);
    } catch (retryErr) {
      const isRetryTimeout = retryErr.message && retryErr.message.includes('timed out');
      if (isRetryTimeout) {
        throw new Error('Response timed out twice. The conversation may be too long — try sending a shorter message or editing the plan directly.');
      }
      throw retryErr;
    }
  }
}

function parseReplyAndPlan(rawReply) {
  const text = String(rawReply || '').trim();
  const replyMatch = text.match(/<reply>([\s\S]*?)<\/reply>/);
  const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);
  const reply = replyMatch ? replyMatch[1].trim() : text; // Fallback: whole response as reply
  const plan = planMatch ? planMatch[1].trim() : '';
  return { reply, plan };
}

function buildIdeaBrainstormWithPlanPrompt(messages, currentPlan, boardContext) {
  const conversationBlock = messages
    .map((m) => `[${m.role === 'user' ? 'User' : 'Assistant'}]\n${m.content}`)
    .join('\n\n');

  return `You are a council of three expert agents collaborating to help a user refine their product ideas into well-structured Epics for implementation by an AI coding assistant (Claude Code).

<agents>
You embody THREE distinct expert perspectives that work together on every response:

**🎯 PM Agent (Product Manager)**
- Owns the product vision, priorities, and scope
- Organizes features into logical Epic groups
- Defines acceptance criteria with specific, testable behaviors
- Identifies dependencies between Epics and suggests implementation order
- Points out gaps, risks, or missing features the user hasn't considered
- Guards against scope creep and keeps Epics focused

**💻 Dev Agent (Senior Developer)**
- Provides the technical architecture and implementation guidance
- Writes pseudo-logic for key business flows and algorithms
- Defines API endpoints, data models, and state management
- Identifies technical risks, performance considerations, and error handling
- Suggests technology choices and patterns
- Flags items that need technical Discovery

**🎨 Design Agent (UX/UI Designer)**
- Describes the user experience in detail: layout, visual hierarchy, navigation
- Defines all UI states (empty, loading, error, success, edge cases)
- Specifies animations and transitions (trigger, duration, easing, feel)
- Provides responsive behavior guidance (mobile, tablet, desktop)
- Considers accessibility (screen readers, keyboard nav, contrast)
- Suggests style direction (colors, typography, spacing patterns)

HOW THE AGENTS COLLABORATE:
- In the <reply>, the conversation feels natural — you speak as one voice but draw on all three perspectives. When a specific agent has something important to contribute, prefix it with the agent emoji (🎯, 💻, or 🎨) to make the source clear.
- In the <plan>, all three agents contribute to their respective sections — the PM writes Motivation, Scope, ACs, and Dependencies; the Dev writes Technical Approach & Pseudo-Logic; the Designer writes User Experience & Design.
- The agents challenge and complement each other — the Dev may flag that a PM's scope is technically complex, or the Designer may suggest UX improvements the PM didn't consider.
</agents>

<rules>
IMPORTANT RULES:
- Ask 2-3 focused questions per turn to keep momentum (at least one from the PM, and others from Dev/Design as needed)
- Summarize your understanding before asking questions
- Since implementation is done entirely by AI, features can be built in their final versions — there is NO need for MVP or phased releases
- Keep responses concise and conversational (not walls of text)
- Write the <reply> in the same language the user is writing in
- The <plan> can also be in the user's language — it will be translated to English when Epics are generated
- In early turns, focus on understanding the product vision before diving into design or technical details
- As the conversation matures, all three agents should contribute increasingly detailed sections to the plan
</rules>

<response_format>
You MUST structure EVERY response using exactly these two XML tags:

1. <reply>Your conversational response to the user goes here</reply>
2. <plan>The full updated plan document in markdown goes here</plan>

BOTH tags are REQUIRED in every response. Rules:
- The <reply> tag contains your conversational text (questions, summaries, suggestions). Use agent emojis (🎯, 💻, 🎨) to attribute specific insights when relevant.
- The <plan> tag contains the COMPLETE, CURRENT state of the plan document
- In early turns when there isn't enough info yet, use <plan></plan> (empty)
- As the conversation progresses, build up the plan incrementally — all three agents contribute to their sections
- The plan must ALWAYS contain the FULL document (not just changes) — it replaces the previous version entirely
- If the user has manually edited the plan (shown in <current_plan>), respect their changes and build on them

Plan document format — once you have enough information, structure the plan like this.
The plan must be COMPREHENSIVE and DETAILED — it is the primary input for generating Epic files and User Stories later. Think of it as a near-final product spec, not a rough outline.

# Plan

## Epic 1: [Name]
**Priority**: P0/P1/P2/P3

### Motivation & Objectives
[2-3 paragraphs explaining:]
- WHY this Epic exists — the problem it solves or the value it delivers
- WHO benefits (target users, personas, stakeholders)
- WHAT success looks like — measurable outcomes or observable behaviors
- HOW this fits into the larger product vision

### Scope & Features
[Detailed breakdown of every capability included in this Epic:]
- [Feature 1]: [2-3 sentence description of what it does, how the user interacts with it, and what the expected outcome is]
- [Feature 2]: [Detailed description]
- [Feature needing research]: [Description] (needs Discovery)
[Be specific — vague scope leads to vague stories. If a feature has sub-features, list them.]

### User Experience & Design
[Describe the user-facing experience in detail:]
- Layout, structure, and visual hierarchy
- Key UI states (empty, loading, error, success, edge cases)
- Navigation flow and user journey
- Style guidelines (colors, typography, spacing patterns to follow or match)
- Animations and transitions (what triggers them, duration, easing, feel)
- Responsive behavior (mobile, tablet, desktop)
- Accessibility considerations

### Acceptance Criteria
- [ ] [Specific observable behavior — be precise enough that a developer can verify pass/fail]
- [ ] [Another specific behavior]
(Write 8-15 ACs per Epic. Each AC must be concrete and testable, not vague.)

### Technical Approach & Pseudo-Logic
[High-level architecture and implementation guidance:]
- Technology choices and patterns to use
- Data flow: where data comes from, how it's transformed, where it's stored
- Key algorithms or business logic described as pseudo-code or step-by-step:
  \`\`\`
  1. User triggers action X
  2. System validates Y (check Z condition)
  3. If valid → perform A, update state B, show feedback C
  4. If invalid → show error D with message E
  \`\`\`
- API endpoints needed (method, path, request/response shape)
- State management approach (what state, where it lives, how it updates)
- Error handling strategy (what errors are possible, how each is handled)
- Performance considerations (lazy loading, caching, debouncing, etc.)

### Dependencies
- [Other Epics this depends on, with specific reason]
- [External services, APIs, or libraries needed]
- Or "None"

### Open Questions & Risks
- [Anything unresolved that needs Discovery or a decision]
- [Technical risks or unknowns]
- [Areas where the user should provide more input]

## Epic 2: [Name]
...same detailed structure

---

PLAN QUALITY RULES:
- Order Epics by implementation priority (Epic 1 = most foundational)
- Write 8-15 ACs per Epic — each must be specific and verifiable
- Include pseudo-logic for any non-trivial business logic or flow
- Describe UX in enough detail that a developer can build it without a designer
- Mention specific animation/transition details (duration, easing, trigger)
- Flag complex or uncertain areas with "(needs Discovery)"
- The plan should be detailed enough that someone reading ONLY the plan (without the conversation) can understand exactly what to build
</response_format>

${currentPlan ? `<current_plan>\nThe user's current plan document (may have been manually edited):\n${currentPlan}\n</current_plan>` : ''}

${boardContext || ''}

<conversation>
${conversationBlock}
</conversation>

Continue the brainstorming conversation. All three agents (🎯 PM, 💻 Dev, 🎨 Design) should contribute their perspectives. Respond in <reply> and update the plan in <plan>.`;
}

function buildIdeaBrainstormPrompt(messages, boardContext) {
  const conversationBlock = messages
    .map((m) => `[${m.role === 'user' ? 'User' : 'Assistant'}]\n${m.content}`)
    .join('\n\n');

  return `You are a senior product manager helping a user refine their product ideas into well-structured Epics for implementation by an AI coding assistant (Claude Code).

<role>
You are a product thinker, NOT an engineer. Your job is to:
- Understand the user's vision and goals
- Ask clarifying questions about scope, target users, and priorities
- Help organize ideas into logical feature groups (future Epics)
- Identify which features belong together in the same system and which should be separate Epics
- Suggest a logical implementation order (foundations first)
- Point out gaps, risks, or missing features the user may not have considered

IMPORTANT RULES:
- Do NOT jump to implementation details — focus on WHAT the product does, not HOW it's built
- Do NOT create or list Epics yet — this is the brainstorming phase
- Ask 2-3 focused questions per turn to keep momentum
- Summarize your understanding before asking questions
- Since implementation is done entirely by AI, features can be built in their final versions — there is NO need for MVP or phased releases
- Keep responses concise and conversational (not walls of text)
- Write in the same language the user is writing in
- Epics and tasks will be generated in English later — the brainstorm conversation can be in any language
</role>

${boardContext || ''}

<conversation>
${conversationBlock}
</conversation>

Continue the brainstorming conversation. Respond to the user's latest message, summarize what you understand so far, and ask 2-3 clarifying questions to refine the product vision.`;
}

const PROJECT_CONTEXT_START = '<!-- PROJECT-CONTEXT:START -->';
const PROJECT_CONTEXT_END = '<!-- PROJECT-CONTEXT:END -->';

function buildProjectContextPrompt(plan, messages) {
  const conversationBlock = messages
    .map((m) => `[${m.role === 'user' ? 'User' : 'Assistant'}]\n${m.content}`)
    .join('\n\n');

  return `You are a technical writer creating a concise project context section for a CLAUDE.md file. This context will help Claude Code (an AI coding assistant) understand the project it is working on.

<plan>
${plan}
</plan>

<conversation>
${conversationBlock}
</conversation>

Write a concise markdown section with:
1. **Project name and one-line description**
2. **Target users** (who this is for)
3. **Core features** (bullet list of key capabilities, derived from the epics)
4. **Technical decisions** mentioned in the plan (frameworks, architecture, etc.)
5. **Key constraints or requirements** (if any were discussed)

Rules:
- Be concise — this is reference context, not documentation
- Write in the same language the user used in the conversation
- Use markdown formatting (headers, bullets)
- Do NOT include implementation details or code
- Do NOT wrap in code blocks — return raw markdown only
- Start with a level-2 heading: ## Project Context`;
}

function escapeRegexPanelServer(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeProjectContextToClaudeMd(projectContext, workdir) {
  const claudeMdPath = path.join(workdir, 'CLAUDE.md');
  const fullSection = `${PROJECT_CONTEXT_START}\n${projectContext}\n${PROJECT_CONTEXT_END}`;

  let existingContent = '';
  let fileExists = false;

  try {
    existingContent = await fs.readFile(claudeMdPath, 'utf8');
    fileExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!fileExists) {
    await fs.writeFile(claudeMdPath, fullSection + '\n', 'utf8');
    return 'created';
  }

  const markerRegex = new RegExp(
    `${escapeRegexPanelServer(PROJECT_CONTEXT_START)}[\\s\\S]*?${escapeRegexPanelServer(PROJECT_CONTEXT_END)}`,
    'm'
  );
  const match = existingContent.match(markerRegex);

  if (match) {
    const updated = existingContent.replace(markerRegex, fullSection);
    await fs.writeFile(claudeMdPath, updated, 'utf8');
    return 'updated';
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  await fs.writeFile(claudeMdPath, existingContent + separator + fullSection + '\n', 'utf8');
  return 'appended';
}

function formatBrainstormLog(messages, plan, epicNames) {
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 19);

  let md = `# Brainstorm Log\n\n`;
  md += `**Last updated**: ${dateStr}\n\n`;

  if (epicNames && epicNames.length > 0) {
    md += `**Epics generated**: ${epicNames.join(', ')}\n\n`;
  }

  md += `---\n\n## Conversation\n\n`;

  for (const m of messages) {
    if (m.role === 'user') {
      md += `### User\n\n${m.content}\n\n`;
    } else if (m.role === 'assistant') {
      md += `### Claude\n\n${m.content}\n\n`;
    }
  }

  if (plan) {
    md += `---\n\n## Plan\n\n${plan}\n`;
  }

  return md;
}

const BRAINSTORM_LOG_NAME = '_brainstorm-log.md';

async function saveBrainstormLog(boardDir, messages, plan, epicNames) {
  const filePath = path.join(boardDir, BRAINSTORM_LOG_NAME);
  await fs.writeFile(filePath, formatBrainstormLog(messages, plan, epicNames), 'utf8');
  return BRAINSTORM_LOG_NAME;
}

async function deleteBrainstormLog(boardDir) {
  try {
    await fs.unlink(path.join(boardDir, BRAINSTORM_LOG_NAME));
  } catch {
    // File may not exist
  }
}

/**
 * Phase 1: Generate an Epic plan (list of outlines) from a brainstorm session.
 * Returns a JSON array of { name, priority, folderName, brief }.
 */
function buildEpicPlanPrompt({ plan, messages, existingEpicNames, boardContext }) {
  const existingList = existingEpicNames.length > 0
    ? existingEpicNames.map((n) => `- ${n}`).join('\n')
    : '(none)';

  // Include recent conversation messages for context when there is no plan
  const recentMessages = messages
    .filter((m) => m.role !== 'system')
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const inputBlock = plan
    ? `<plan>\n${plan}\n</plan>`
    : `<conversation>\n${recentMessages}\n</conversation>`;

  return `You are a technical architect planning the Epic breakdown for a software project.

${inputBlock}

<existing_epics>
${existingList}
</existing_epics>

${boardContext || ''}

<instructions>
Analyze the ${plan ? 'plan' : 'conversation'} and identify all distinct Epics needed to deliver the described product.

Return ONLY a JSON array with NO additional text or code blocks:
[
  {
    "name": "Authentication System",
    "priority": "P0|P1|P2|P3",
    "folderName": "E01-Authentication-System",
    "brief": "One sentence describing what this Epic delivers."
  }
]

Rules:
- Return ONLY valid JSON array, no markdown, no code blocks, no explanation.
- 1-15 Epics maximum.
- folderName MUST follow the pattern E{NN}-{Slug}: NN is zero-padded sequential index (01, 02, 03, ...), Slug is PascalCase words separated by hyphens derived from the Epic name (e.g., Authentication-System).
- The index in folderName must match the position in the array (first Epic = E01, second = E02, etc.).
- Do NOT include any Epic whose name matches an existing epic.
- Order Epics logically: foundational infrastructure first, then features, then polish.
- ALL output (name, folderName, brief) MUST be in English.
</instructions>`;
}

function parseEpicPlanResponse(reply) {
  const text = String(reply || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  let plan;
  try {
    plan = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude did not return valid JSON for epic plan. Raw: ' + text.slice(0, 500));
  }

  if (!Array.isArray(plan)) {
    throw new Error('Expected a JSON array for epic plan but got: ' + typeof plan);
  }

  return plan
    .filter((e) => e.name && typeof e.name === 'string')
    .map((e, i) => ({
      name: e.name.trim(),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(e.priority) ? e.priority : 'P1',
      folderName: (e.folderName || '').trim() || `E${String(i + 1).padStart(2, '0')}-${slugFromTitle(e.name)}`,
      brief: e.brief || ''
    }))
    .slice(0, 15);
}

function buildSingleEpicPrompt(epicSection, epicIndex, totalEpics, fullPlan, boardContext) {
  return `You are a technical architect preparing work packages for an AI coding assistant (Claude Code). Convert ONE section of a plan document into a structured Epic optimized for automated execution.

<role>
Convert the specific Epic section below into a structured Epic.
The full plan is provided as context, but you MUST ONLY generate the single Epic described in the <epic_section>.

PRINCIPLES:
- Focus on actionable implementation detail — omit narrative, motivation, and UX prose
- Since AI implements the code, features are built in their FINAL versions (no MVP or phased releases)
- Only automated tests are used (NEVER manual testing or manual QA)
- Flag areas that need research with "(needs Discovery)" suffix
- Each scope item must map directly to 1+ executable child tasks
- Include specific technical details (file types, frameworks, APIs) so task generation can reference them
</role>

${boardContext || ''}

<full_plan_context>
${fullPlan}
</full_plan_context>

<epic_section>
This is Epic ${epicIndex} of ${totalEpics}. Generate ONLY this Epic:
${epicSection}
</epic_section>

<output_format>
Your output MUST use the following separator-based format — NOT a single JSON object.
This avoids JSON escaping issues with long markdown strings.

First, emit a small JSON metadata line, then the separator "---BODY---", then the full markdown body as plain text.

EXAMPLE FORMAT:
{"name": "Authentication System", "folderName": "E${String(epicIndex).padStart(2, '0')}-Authentication-System", "priority": "P1"}
---BODY---
# Authentication System Epic

**Goal**: Implement a complete authentication system with login, signup, logout, and session persistence using JWT tokens.

## Scope
...rest of markdown...

RULES:
1. The FIRST line must be a single-line JSON object with ONLY these keys:
   - "name": string (Epic name, e.g., "Authentication System")
   - "folderName": string (Epic folder name with E{NN} prefix)
   - "priority": string ("P0", "P1", "P2", or "P3")
2. The SECOND line must be exactly: ---BODY---
3. Everything after "---BODY---" is the Epic's markdown body (plain text, no JSON escaping needed).

Body template (use EXACTLY these sections — no others):

# [Epic Name] Epic

**Goal**: [1-2 sentences — WHAT this epic delivers. Concise, technical, no narrative.]

## Scope
- [Feature/capability 1]: [Concise technical description — what it does, key behaviors]
- [Feature/capability 2]: [Description] (needs Discovery)
[Each bullet = one feature area that maps to 1+ executable child tasks. Include technical specifics.]

## Acceptance Criteria
- [ ] [Technically verifiable condition — checkable by tests, build, or code inspection]
(5-10 ACs. Each must be specific and verifiable. Include error handling, edge cases, data validation.)

## Technical Approach
- [Architecture decisions and patterns to follow]
- [Key libraries, frameworks, tools to use]
- [Data flow, state management, API design]
- [Items needing research] (needs Discovery)
[Implementation guidance that helps generate concrete child tasks]

## Dependencies
- [Other Epics by name, external services, packages, or "None"]

## Child Tasks
See individual user story files in this Epic folder.

SECTIONS TO NEVER INCLUDE:
- ❌ "Motivation & Objectives" — Claude Code doesn't need motivation
- ❌ "User Experience & Design" — UX details go into individual child tasks
- ❌ "Open Questions & Risks" — Claude Code executes, it doesn't deliberate
- ❌ "User Story" / "As a [role], I want..."
- ❌ "Technical Tasks" with numbered steps
- ❌ "Tests" with specific test files
- ❌ "Standard Completion Criteria"

LANGUAGE: ALL output (name, folderName, body) MUST be written in English, regardless of the plan's language. If the plan is in another language, translate all content to English while preserving meaning and detail.
</output_format>`;
}

/**
 * Parse a single Epic response from the separator-based format:
 *   {"name": "...", "folderName": "...", "priority": "P1"}
 *   ---BODY---
 *   # Epic markdown body...
 *
 * Falls back to legacy JSON parsing if separator is not found.
 */
function parseSingleEpicResponse(text, epicIndex) {
  const separator = '---BODY---';
  const sepIdx = text.indexOf(separator);

  if (sepIdx !== -1) {
    // Separator-based format: small JSON metadata + plain markdown body
    let metaStr = text.slice(0, sepIdx).trim();
    const body = text.slice(sepIdx + separator.length).trim();

    // Strip markdown code block wrapper from metadata if present
    const metaCodeBlock = metaStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (metaCodeBlock) metaStr = metaCodeBlock[1].trim();

    const meta = JSON.parse(metaStr);
    return {
      name: (meta.name || '').trim(),
      folderName: (meta.folderName || '').trim() || `E${String(epicIndex).padStart(2, '0')}-${slugFromTitle((meta.name || '').trim())}`,
      priority: ['P0', 'P1', 'P2', 'P3'].includes(meta.priority) ? meta.priority : 'P1',
      body
    };
  }

  // Fallback: try parsing as a single JSON object (legacy format)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text;
  const epic = JSON.parse(jsonStr);
  return {
    name: (epic.name || '').trim(),
    folderName: (epic.folderName || '').trim() || `E${String(epicIndex).padStart(2, '0')}-${slugFromTitle((epic.name || '').trim())}`,
    priority: ['P0', 'P1', 'P2', 'P3'].includes(epic.priority) ? epic.priority : 'P1',
    body: epic.body || ''
  };
}

// Return the saved idea session from disk (if any) so the frontend can resume
app.get('/api/ideas/session', async (_req, res) => {
  const saved = await loadIdeaSessionFromDisk();
  if (!saved || !saved.sessionId) {
    res.json({ ok: true, exists: false });
    return;
  }
  // Re-hydrate into memory if not already there
  if (!ideaSessions.has(saved.sessionId)) {
    ideaSessions.set(saved.sessionId, {
      messages: saved.messages || [],
      plan: saved.plan || '',
      createdAt: saved.createdAt || Date.now()
    });
  }
  res.json({
    ok: true,
    exists: true,
    sessionId: saved.sessionId,
    messages: saved.messages || [],
    plan: saved.plan || ''
  });
});

// List archived brainstorm sessions for the history picker
app.get('/api/ideas/sessions/archived', async (_req, res) => {
  try {
    await fs.mkdir(IDEA_SESSION_ARCHIVE_DIR, { recursive: true });
    const files = await fs.readdir(IDEA_SESSION_ARCHIVE_DIR);
    const sessions = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(IDEA_SESSION_ARCHIVE_DIR, file), 'utf8');
        const data = JSON.parse(content);
        sessions.push({
          fileName: file,
          sessionId: data.sessionId,
          createdAt: data.createdAt,
          archivedAt: data.archivedAt || null,
          epicNames: data.epicNames || [],
          messageCount: (data.messages || []).length,
          planPreview: (data.plan || '').slice(0, 200),
          hasPlan: !!(data.plan && data.plan.trim())
        });
      } catch { /* skip corrupt files */ }
    }

    sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ ok: true, sessions });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

// Load an archived session as a new active session (archive file stays intact)
app.post('/api/ideas/sessions/load', async (req, res) => {
  const { fileName } = req.body;
  if (!fileName || typeof fileName !== 'string') {
    res.status(400).json({ ok: false, message: 'fileName is required.' });
    return;
  }

  // Sanitize to prevent path traversal
  const sanitized = path.basename(fileName);
  const archivePath = path.join(IDEA_SESSION_ARCHIVE_DIR, sanitized);

  try {
    const content = await fs.readFile(archivePath, 'utf8');
    const archived = JSON.parse(content);

    const newSessionId = crypto.randomUUID();
    const session = {
      messages: archived.messages || [],
      plan: archived.plan || '',
      createdAt: Date.now()
    };

    ideaSessions.set(newSessionId, session);
    await saveIdeaSessionToDisk(newSessionId, session);

    pushLog('info', LOG_SOURCE.panel, `Loaded archived session: ${sanitized}`);

    res.json({
      ok: true,
      sessionId: newSessionId,
      messages: session.messages,
      plan: session.plan
    });
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    const msg = error.code === 'ENOENT' ? 'Archived session not found.' : error.message;
    res.status(status).json({ ok: false, message: msg });
  }
});

app.post('/api/ideas/chat', async (req, res) => {
  const { sessionId: reqSessionId, message, plan: clientPlan } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ ok: false, message: 'Message is required.' });
    return;
  }

  if (ideaChatState.running) {
    res.status(409).json({ ok: false, message: 'A brainstorming request is already in progress. Please wait.' });
    return;
  }

  if (generateEpicsState.running) {
    res.status(409).json({ ok: false, message: 'Epic generation is in progress. Please wait for it to finish.' });
    return;
  }

  ideaChatState.running = true;

  try {
    // Get or create session
    let sessionId = reqSessionId;
    let session;

    if (sessionId && ideaSessions.has(sessionId)) {
      session = ideaSessions.get(sessionId);
    } else {
      sessionId = crypto.randomUUID();
      session = { messages: [], plan: '', createdAt: Date.now() };
      ideaSessions.set(sessionId, session);
    }

    // If client sends an updated plan (user may have edited it), use it
    if (typeof clientPlan === 'string') {
      session.plan = clientPlan;
    }

    // Add user message
    session.messages.push({ role: 'user', content: message.trim() });

    const turnNumber = Math.ceil(session.messages.length / 2);
    pushLog('info', LOG_SOURCE.panel, `Idea brainstorm (turn ${turnNumber}): "${message.trim().slice(0, 80)}..."`);

    // Auto-compact older messages if conversation is getting long
    const compactLogger = {
      info: (msg) => pushLog('info', LOG_SOURCE.panel, msg),
      warn: (msg) => pushLog('warn', LOG_SOURCE.panel, msg),
      success: (msg) => pushLog('success', LOG_SOURCE.panel, msg),
    };
    await autoCompactMessages(session, compactLogger);

    // Gather board context for cross-epic awareness
    let boardContext = '';
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
      boardContext = await buildBoardContext(client, null);
    } catch {
      // Non-fatal: proceed without board context
    }

    const prompt = buildIdeaBrainstormWithPlanPrompt(session.messages, session.plan, boardContext);
    const { reply: rawReply } = await runClaudeWithRetry(prompt, 'claude-opus-4-6', 180000, compactLogger);

    const { reply: parsedReply, plan: parsedPlan } = parseReplyAndPlan(rawReply);
    const normalizedReply = normalizeMarkdownNewlines(parsedReply);

    // Store assistant reply (only the conversational part, not the plan)
    session.messages.push({ role: 'assistant', content: normalizedReply });

    // Update session plan if Claude returned one
    if (parsedPlan) {
      session.plan = parsedPlan;
    }

    // Persist session to disk so it survives modal close / server restart
    await saveIdeaSessionToDisk(sessionId, session);

    // Update brainstorm log .md in Board/
    try {
      const env2 = await readEnvPairs();
      const bDir = resolveBoardDir(env2);
      await saveBrainstormLog(bDir, session.messages, session.plan, null);
    } catch { /* non-fatal */ }

    res.json({
      ok: true,
      sessionId,
      reply: normalizedReply,
      plan: session.plan,
      messageCount: session.messages.length
    });
  } catch (error) {
    pushLog('error', LOG_SOURCE.claude, `Idea brainstorm failed: ${error.message}`);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    ideaChatState.running = false;
  }
});

app.get('/api/ideas/generate-epics/status', (_req, res) => {
  res.json({
    running: generateEpicsState.running,
    sessionId: generateEpicsState.sessionId,
    created: generateEpicsState.created,
    total: generateEpicsState.total,
    failed: generateEpicsState.failed,
    phase: generateEpicsState.phase,
    errors: [...generateEpicsState.errors],
    canResume: generateEpicsState.canResume
  });
});

app.post('/api/ideas/generate-epics', async (req, res) => {
  const { sessionId, plan: clientPlan } = req.body;

  if (!sessionId || !ideaSessions.has(sessionId)) {
    res.status(404).json({ ok: false, message: 'Brainstorm session not found. Start a new conversation.' });
    return;
  }

  if (generateEpicsState.running) {
    res.status(409).json({ ok: false, message: 'Epic generation is already in progress. Please wait.' });
    return;
  }

  if (ideaChatState.running) {
    res.status(409).json({ ok: false, message: 'A brainstorming request is already in progress. Please wait.' });
    return;
  }

  // Check if we can resume from a saved Phase 1 plan (same session, phase 1 already done)
  const isResuming = generateEpicsState.canResume &&
                     generateEpicsState.sessionId === sessionId &&
                     generateEpicsState.plan !== null;

  // Initialize state and respond immediately so the client never times out
  Object.assign(generateEpicsState, {
    running: true,
    sessionId,
    created: 0,
    total: 0,
    failed: 0,
    phase: isResuming ? 'generating' : 'planning',
    errors: [],
    canResume: false
  });
  if (!isResuming) generateEpicsState.plan = null;

  pushLog('info', LOG_SOURCE.panel, isResuming
    ? 'Resuming Epic generation (reusing Phase 1 plan)...'
    : 'Starting Epic generation from brainstorm session...');
  res.json({ ok: true, started: true });

  // Run generation in background
  (async () => {
    try {
      const session = ideaSessions.get(sessionId);
      const plan = clientPlan || session.plan || '';

      // Gather board context
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

      const boardContext = await buildBoardContext(client, null);

      let epicPlan;
      let epicsToGenerate;

      if (isResuming) {
        // Reuse saved Phase 1 plan — skip Phase 1 entirely
        epicPlan = generateEpicsState.plan;
        const allTasks = await client.listTasks();
        const existingEpicNames = new Set(
          allTasks.filter((t) => t.type === 'Epic').map((t) => t.name.toLowerCase().trim())
        );
        epicsToGenerate = epicPlan.filter((e) => !existingEpicNames.has(e.name.toLowerCase().trim()));
        generateEpicsState.total = epicsToGenerate.length;
        generateEpicsState.phase = 'generating';
        if (epicsToGenerate.length === 0) {
          pushLog('success', LOG_SOURCE.panel, 'All Epics already exist. Nothing to resume.');
          return;
        }
        pushLog('info', LOG_SOURCE.panel, `Resuming: ${epicsToGenerate.length} of ${epicPlan.length} Epics remaining. Generating one by one...`);
      } else {
        // Phase 1: Generate epic plan (outlines only — fast call)
        const allTasks = await client.listTasks();
        const existingEpicNames = allTasks
          .filter((t) => t.type === 'Epic')
          .map((t) => t.name);

        const compactLogger = {
          info: (msg) => pushLog('info', LOG_SOURCE.panel, msg),
          warn: (msg) => pushLog('warn', LOG_SOURCE.panel, msg),
          success: (msg) => pushLog('success', LOG_SOURCE.panel, msg),
        };
        await autoCompactMessages(session, compactLogger);

        pushLog('info', LOG_SOURCE.panel, 'Planning Epics from brainstorm...');
        const planPrompt = buildEpicPlanPrompt({
          plan,
          messages: session.messages,
          existingEpicNames,
          boardContext
        });
        let planReply;
        try {
          ({ reply: planReply } = await runClaudePromptViaApi(planPrompt, PANEL_DEFAULT_MODEL));
        } catch (planErr) {
          pushLog('error', LOG_SOURCE.claude, `Phase 1 (planning) failed: ${planErr.message}`, {
            stderr: planErr.stderr || null,
            stdout: planErr.stdout || null,
            exitCode: planErr.exitCode || null,
            signal: planErr.signal || null
          });
          planErr._loggedByPhase1 = true;
          throw planErr;
        }

        epicPlan = parseEpicPlanResponse(planReply);
        generateEpicsState.plan = epicPlan;
        epicsToGenerate = epicPlan;
        generateEpicsState.total = epicPlan.length;
        generateEpicsState.phase = 'generating';
        pushLog('info', LOG_SOURCE.panel, `Epic plan ready: ${epicPlan.length} Epics. Generating one by one...`);
      }

      // Phase 2: Generate each Epic body individually
      for (let i = 0; i < epicsToGenerate.length; i++) {
        const outline = epicsToGenerate[i];
        try {
          // Build a synthetic plan section from the outline (name + brief)
          const epicSection = `## ${outline.name}\n\n${outline.brief}`;
          const epicPrompt = buildSingleEpicPrompt(
            epicSection, i + 1, epicsToGenerate.length, plan, boardContext
          );
          const { reply: epicReply } = await runClaudePromptViaApi(epicPrompt, PANEL_DEFAULT_MODEL);
          const epic = parseSingleEpicResponse(String(epicReply || '').trim(), i + 1);

          if (!epic || !epic.name || !epic.body) {
            throw new Error('Claude returned an invalid or empty Epic structure.');
          }

          // Prefer outline's folderName if Claude didn't provide one
          if (!epic.folderName) epic.folderName = outline.folderName;
          if (!epic.priority) epic.priority = outline.priority;

          await client.createTask(
            { name: epic.name, priority: epic.priority, type: 'Epic', status: 'Not Started' },
            epic.body,
            { fileName: epic.folderName }
          );

          generateEpicsState.created++;
          pushLog('success', LOG_SOURCE.claude, `Epic created (${generateEpicsState.created}/${generateEpicsState.total}): "${epic.name}"`);
        } catch (err) {
          generateEpicsState.failed++;
          generateEpicsState.errors.push(outline.name);
          pushLog('error', LOG_SOURCE.claude, `Failed to create Epic "${outline.name}": ${err.message}`, {
            stderr: err.stderr || null,
            stdout: err.stdout || null,
            exitCode: err.exitCode || null,
            signal: err.signal || null
          });
        }
      }

      const summary = `Generated ${generateEpicsState.created}/${generateEpicsState.total} Epics${generateEpicsState.failed > 0 ? ` (${generateEpicsState.failed} failed)` : ''}`;
      pushLog('success', LOG_SOURCE.claude, summary);

      // Post-generation steps (only when at least one Epic was created)
      if (generateEpicsState.created > 0) {
        // Save brainstorm conversation log
        try {
          const epicNames = epicPlan.map((e) => e.name);
          const logFileName = await saveBrainstormLog(boardDir, session.messages, plan, epicNames);
          pushLog('info', LOG_SOURCE.panel, `Brainstorm log saved: ${logFileName}`);
        } catch (err) {
          pushLog('warn', LOG_SOURCE.panel, `Failed to save brainstorm log: ${err.message}`);
        }

        // Update CLAUDE.md and archive session only on full success
        if (generateEpicsState.failed === 0) {
          try {
            const workdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');
            const contextPrompt = buildProjectContextPrompt(plan || '', session.messages);
            const { reply: contextReply } = await runClaudePromptViaApi(contextPrompt, 'claude-opus-4-6');
            const projectContext = String(contextReply || '').trim();
            if (projectContext) {
              const claudeMdAction = await writeProjectContextToClaudeMd(projectContext, workdir);
              pushLog('success', LOG_SOURCE.panel, `CLAUDE.md project context ${claudeMdAction}`);
            }
          } catch (err) {
            pushLog('warn', LOG_SOURCE.panel, `Failed to update CLAUDE.md project context: ${err.message}`);
          }

          ideaSessions.delete(sessionId);
          const archiveName = await archiveIdeaSession(epicPlan.map((e) => e.name));
          if (archiveName) {
            pushLog('info', LOG_SOURCE.panel, `Session archived: ${archiveName}`);
          }
        }
      }
    } catch (error) {
      if (!error._loggedByPhase1) {
        pushLog('error', LOG_SOURCE.claude, `Epic generation failed (${generateEpicsState.phase || 'setup'}): ${error.message}`, {
          stderr: error.stderr || null,
          stdout: error.stdout || null,
          exitCode: error.exitCode || null,
          signal: error.signal || null,
          stack: error.stack || null
        });
      }
      generateEpicsState.failed++;
    } finally {
      generateEpicsState.running = false;
      generateEpicsState.phase = null;
      // Preserve plan for resume if Phase 2 had failures; clear on full success or Phase 1 failure
      if (generateEpicsState.failed > 0 && generateEpicsState.plan !== null) {
        generateEpicsState.canResume = true;
      } else {
        generateEpicsState.canResume = false;
        generateEpicsState.plan = null;
      }
    }
  })();
});

app.post('/api/ideas/delete-session', async (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    ideaSessions.delete(sessionId);
  }
  await deleteIdeaSessionFromDisk();
  // Also remove the brainstorm log
  try {
    const env = await readEnvPairs();
    const bDir = resolveBoardDir(env);
    await deleteBrainstormLog(bDir);
  } catch { /* non-fatal */ }
  res.json({ ok: true });
});

// ── Automation Runtime ───────────────────────────────────────────────

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

function runCommand(cmd, args, workdir) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: workdir || process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout + stderr);
      } else {
        const error = new Error(stderr.trim() || stdout.trim() || `${cmd} command failed with exit=${code}`);
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

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

  // Debug logs
  console.log('[DEBUG] Git endpoint called');
  console.log('[DEBUG] cwd:', cwd);
  console.log('[DEBUG] env.CLAUDE_WORKDIR:', env.CLAUDE_WORKDIR);
  console.log('[DEBUG] resolved workdir:', workdir);

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

  // NEVER show diffs from the Product Manager project itself
  if (path.normalize(workdir) === path.normalize(cwd)) {
    res.status(400).json({
      ok: false,
      message: 'Cannot show diffs from the Product Manager project. Configure CLAUDE_WORKDIR to point to your user project.'
    });
    return;
  }

  try {
    const stat = await runGitCommand(['show', '--stat', '--format=', hash], workdir);
    res.json({ ok: true, stat: stat.trim() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || String(error) });
  }
});

app.get('/api/git/gh-status', async (_req, res) => {
  const env = await readEnvPairs();
  const workdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');
  const workdirBasename = path.basename(workdir).replace(/\s+/g, '-');

  // Check if gh CLI is installed
  try {
    await runCommand('gh', ['--version']);
  } catch {
    return res.json({ ok: true, available: false, authenticated: false, workdirBasename, reason: 'gh CLI not installed. Install it with: brew install gh' });
  }

  // Check if authenticated
  try {
    const output = await runCommand('gh', ['auth', 'status']);
    const match = output.match(/account\s+(\S+)/i);
    const username = match ? match[1] : null;
    return res.json({ ok: true, available: true, authenticated: true, username, workdirBasename });
  } catch {
    return res.json({ ok: true, available: true, authenticated: false, workdirBasename, reason: 'Not authenticated. Run: gh auth login' });
  }
});

app.post('/api/git/init', async (req, res) => {
  const { type, repoName, visibility = 'private' } = req.body || {};

  if (!type || !['local', 'github'].includes(type)) {
    return res.status(400).json({ ok: false, message: 'Invalid type. Use "local" or "github".' });
  }

  const env = await readEnvPairs();
  const workdir = path.resolve(cwd, env.CLAUDE_WORKDIR || '.');

  try {
    await fs.access(workdir);
  } catch {
    return res.status(400).json({ ok: false, message: 'Working directory not found.' });
  }

  try {
    await runGitCommand(['init'], workdir);

    if (type === 'local') {
      return res.json({ ok: true, message: 'Local git repository initialized successfully.' });
    }

    // GitHub flow: create an initial commit if there are files, then create the remote repo
    const name = (repoName || path.basename(workdir)).trim().replace(/\s+/g, '-');

    let hasCommit = false;
    try {
      const statusOutput = await runGitCommand(['status', '--porcelain'], workdir);
      if (statusOutput.trim()) {
        await runGitCommand(['add', '-A'], workdir);
        await runGitCommand(['commit', '-m', 'Initial commit'], workdir);
        hasCommit = true;
      }
    } catch {
      // no files or commit failed — proceed without push
    }

    const ghArgs = ['repo', 'create', name, `--${visibility}`, '--source=.'];
    if (hasCommit) ghArgs.push('--push');

    await runCommand('gh', ghArgs, workdir);

    const action = hasCommit ? 'created and pushed to GitHub' : 'created on GitHub (no commits to push yet)';
    return res.json({ ok: true, message: `Repository '${name}' ${action}.` });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Failed to initialize repository.' });
  }
});

// ── Global error handler — always return JSON, never HTML ───────────
// Must be registered AFTER all routes (4-arg signature = Express error handler).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (!res.headersSent) {
    res.status(status).json({ ok: false, message });
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

  // Detect HTTPS certs (generated via `npm run panel:certs`)
  let certOptions = null;
  try {
    certOptions = {
      cert: fsSync.readFileSync(certFile),
      key: fsSync.readFileSync(keyFile),
    };
    httpsEnabled = true;
  } catch {
    // No certs found — fall back to HTTP
  }

  const scheme = httpsEnabled ? 'https' : 'http';

  function onListening() {
    const url = `${scheme}://localhost:${panelPort}`;
    console.log(`✅ Joy UI panel started: ${url}`);
    if (httpsEnabled) {
      console.log('🔐 HTTPS enabled (locally-trusted certificate).');
    }
    console.log('ℹ️ Use this panel to configure .env, start API, and watch live logs.');
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
        if (httpsEnabled) {
          console.log(`📱 LAN access (HTTPS): https://${lanIp}:${panelPort}`);
          console.log('   Browser notifications enabled — works from any device on your network.');
        } else {
          console.log(`📱 LAN access (HTTP): http://${lanIp}:${panelPort}`);
          console.log('   ⚠️  Browser notifications require HTTPS. Run: brew install mkcert');
        }
      }
    }

    autoStartApiIfNeeded().catch((error) => {
      pushLog('error', LOG_SOURCE.panel, `Failed API auto-start check: ${error.message}`);
    });
  }

  const server = httpsEnabled
    ? https.createServer(certOptions, app).listen(panelPort, onListening)
    : app.listen(panelPort, onListening);

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
