const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_MAGENTA = '\x1b[35m';

function nowStamp() {
  return new Date().toLocaleString('pt-BR', {
    hour12: false
  });
}

function truncate(value, max = 180) {
  const text = String(value);
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}...`;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    const trimmed = truncate(value.replace(/\s+/g, ' ').trim());
    if (trimmed.length === 0) {
      return '""';
    }
    return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
  }

  if (Array.isArray(value)) {
    const joined = value.map((item) => formatValue(item)).join(', ');
    return `[${truncate(joined, 120)}]`;
  }

  if (typeof value === 'object') {
    return truncate(JSON.stringify(value), 160);
  }

  return String(value);
}

function formatMeta(meta) {
  if (meta === null || meta === undefined) {
    return '';
  }

  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return ` | details=${formatValue(meta)}`;
  }

  const entries = Object.entries(meta);
  if (entries.length === 0) {
    return '';
  }

  // Special handling for expandableContent - preserve it as JSON
  if (meta.expandableContent) {
    const { expandableContent, ...otherMeta } = meta;
    const parts = Object.entries(otherMeta).map(([key, value]) => `${key}=${formatValue(value)}`);
    // Serialize expandableContent as compact JSON
    const expandableJson = JSON.stringify(expandableContent);
    parts.push(`expandableContent=${expandableJson}`);
    return ` | ${parts.join(' | ')}`;
  }

  const parts = entries.map(([key, value]) => `${key}=${formatValue(value)}`);
  return ` | ${parts.join(' | ')}`;
}

function write(streamFn, color, emoji, label, message, meta = undefined) {
  const timestamp = nowStamp();
  const header = `${color}${emoji} ${label}${ANSI_RESET}`;
  const line = `${header} - ${message}${formatMeta(meta)} ${ANSI_DIM}(${timestamp})${ANSI_RESET}`;
  streamFn(line);
}

/**
 * Emits a progressive log entry that can be updated later by emitting another log with the same groupId.
 * Progressive logs allow the UI to show loading states and consolidate related messages into a single bubble.
 *
 * @param {string} level - Log level: 'info', 'success', 'warn', 'error'
 * @param {string} groupId - Unique identifier for this log group (e.g., 'epic-review-E17')
 * @param {string} state - Current state: 'start', 'progress', 'complete', 'error'
 * @param {string} message - Main message text
 * @param {object} meta - Additional metadata (model, duration, childCount, etc.)
 * @param {string} [expandableContent] - Optional expandable content (e.g., prompt text)
 */
function writeProgressive(level, groupId, state, message, meta = {}, expandableContent = null) {
  const timestamp = nowStamp();
  const progressive = {
    progressive: true,
    groupId,
    state,
    expandableContent
  };
  const fullMeta = { ...meta, ...progressive };

  // Color and emoji based on level
  let color, emoji, label;
  switch (level) {
    case 'success':
      color = ANSI_GREEN;
      emoji = '✅';
      label = 'SUCCESS';
      break;
    case 'warn':
      color = ANSI_YELLOW;
      emoji = '⚠️';
      label = 'WARN';
      break;
    case 'error':
      color = ANSI_RED;
      emoji = '❌';
      label = 'ERROR';
      break;
    default:
      color = ANSI_CYAN;
      emoji = 'ℹ️';
      label = 'INFO';
  }

  const header = `${color}${emoji} ${label}${ANSI_RESET}`;
  const line = `${header} - ${message}${formatMeta(fullMeta)} ${ANSI_DIM}(${timestamp})${ANSI_RESET}`;
  console.log(line);
}

function writeBlock(title, content, meta = undefined) {
  const timestamp = nowStamp();
  const header = `${ANSI_MAGENTA}🧠 PROMPT${ANSI_RESET} - ${title}${formatMeta(meta)} ${ANSI_DIM}(${timestamp})${ANSI_RESET}`;
  console.log(header);

  const lines = String(content || '').split('\n');
  for (const line of lines) {
    console.log(`${ANSI_DIM}│${ANSI_RESET} ${line}`);
  }
  console.log(`${ANSI_DIM}└────────────────────────────────────────────────────────────────${ANSI_RESET}`);
}

export const logger = {
  info(message, meta) {
    write(console.log, ANSI_CYAN, 'ℹ️', 'INFO', message, meta);
  },

  success(message, meta) {
    write(console.log, ANSI_GREEN, '✅', 'SUCCESS', message, meta);
  },

  warn(message, meta) {
    write(console.warn, ANSI_YELLOW, '⚠️', 'WARN', message, meta);
  },

  error(message, meta) {
    write(console.error, ANSI_RED, '❌', 'ERROR', message, meta);
  },

  block(title, content, meta) {
    writeBlock(title, content, meta);
  },

  /**
   * Emits a progressive log entry.
   * @param {string} level - 'info', 'success', 'warn', 'error'
   * @param {string} groupId - Unique group identifier
   * @param {string} state - 'start', 'progress', 'complete', 'error'
   * @param {string} message - Log message
   * @param {object} meta - Additional metadata
   * @param {string} [expandableContent] - Optional expandable content
   */
  progressive(level, groupId, state, message, meta = {}, expandableContent = null) {
    writeProgressive(level, groupId, state, message, meta, expandableContent);
  }
};
