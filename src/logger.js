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

  const parts = entries.map(([key, value]) => `${key}=${formatValue(value)}`);
  return ` | ${parts.join(' | ')}`;
}

function write(streamFn, color, emoji, label, message, meta = undefined) {
  const timestamp = nowStamp();
  const header = `${color}${emoji} ${label}${ANSI_RESET}`;
  const line = `${header} - ${message}${formatMeta(meta)} ${ANSI_DIM}(${timestamp})${ANSI_RESET}`;
  streamFn(line);
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
  }
};
