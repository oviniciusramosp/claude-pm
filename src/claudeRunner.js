import { spawn } from 'node:child_process';
const FIXED_CLAUDE_COMMAND = '/opt/homebrew/bin/claude --print';

function isLikelyTaskContract(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }

  return /^\{.*"status"\s*:\s*"(done|blocked)"/.test(trimmed);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

function formatToolProgress(block) {
  const name = block.name || 'Tool';
  const input = block.input || {};

  switch (name) {
    case 'Read':
      return `Read → ${input.file_path || '(file)'}`;
    case 'Edit':
      return `Edit → ${input.file_path || '(file)'}`;
    case 'Write':
      return `Write → ${input.file_path || '(file)'}`;
    case 'NotebookEdit':
      return `NotebookEdit → ${input.notebook_path || '(notebook)'}`;
    case 'Bash': {
      const cmd = input.command || '';
      return `Bash → ${cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd}`;
    }
    case 'Grep':
      return `Grep → "${input.pattern || ''}"${input.path ? ' in ' + input.path : ''}`;
    case 'Glob':
      return `Glob → ${input.pattern || '(pattern)'}`;
    case 'Task':
      return `Task → ${input.description || '(subagent)'}`;
    case 'WebSearch':
      return `WebSearch → "${input.query || ''}"`;
    case 'WebFetch':
      return `WebFetch → ${input.url || '(url)'}`;
    default:
      return name;
  }
}

function extractToolUseProgress(event) {
  if (!event || event.role !== 'assistant') {
    return null;
  }

  const content = Array.isArray(event.content) ? event.content : [];
  const toolBlocks = content.filter((c) => c.type === 'tool_use');
  if (toolBlocks.length === 0) {
    return null;
  }

  return toolBlocks.map(formatToolProgress);
}

const AC_COMPLETE_MARKER = '[AC_COMPLETE] ';

function extractAcCompletions(event) {
  if (!event || event.role !== 'assistant') {
    return [];
  }

  const content = Array.isArray(event.content) ? event.content : [];
  const completed = [];

  for (const block of content) {
    if (block.type !== 'text' || !block.text) {
      continue;
    }

    const lines = block.text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(AC_COMPLETE_MARKER)) {
        const acText = trimmed.slice(AC_COMPLETE_MARKER.length).trim();
        if (acText) {
          completed.push(acText);
        }
      }
    }
  }

  return completed;
}

function extractAcFromPlainLine(line) {
  const trimmed = (line || '').trim();
  if (trimmed.startsWith(AC_COMPLETE_MARKER)) {
    const acText = trimmed.slice(AC_COMPLETE_MARKER.length).trim();
    return acText || null;
  }
  return null;
}

function parseStreamJsonResult(stdout) {
  const lines = (stdout || '').trim().split('\n').filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = parseJsonLine(lines[i]);
    if (!event || event.role !== 'assistant') {
      continue;
    }

    const content = Array.isArray(event.content) ? event.content : [];
    for (let j = content.length - 1; j >= 0; j -= 1) {
      if (content[j].type !== 'text') {
        continue;
      }

      const text = (content[j].text || '').trim();
      const jsonMatch = text.match(/\{[\s\S]*"status"\s*:\s*"(done|blocked)"[\s\S]*\}/);
      if (!jsonMatch) {
        continue;
      }

      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        continue;
      }
    }
  }

  return null;
}

function parseJsonFromOutput(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!(line.startsWith('{') && line.endsWith('}'))) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function buildCommand(config, task, overrideModel) {
  let cmd = FIXED_CLAUDE_COMMAND;

  const model = overrideModel || task.model;
  if (model) {
    cmd += ` --model ${model}`;
  }

  if (config.claude.fullAccess && !cmd.includes('--dangerously-skip-permissions')) {
    cmd += ' --dangerously-skip-permissions';
  }

  if (config.claude.streamOutput) {
    cmd += ' --verbose --output-format stream-json';
  }

  return cmd;
}

function summarizeCommandOutput(stderr, stdout) {
  const raw = String(stderr || stdout || 'sem output');
  const line = raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)[0];

  if (!line) {
    return 'sem output';
  }

  if (line.length <= 320) {
    return line;
  }

  return `${line.slice(0, 320)}...`;
}

export function runClaudeTask(task, prompt, config, { signal, overrideModel, onAcComplete } = {}) {
  return new Promise((resolve, reject) => {
    const commandEnv = { ...process.env };
    if (config.claude.oauthToken) {
      commandEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claude.oauthToken;
    }

    const command = buildCommand(config, task, overrideModel);

    const child = spawn(command, {
      shell: true,
      cwd: config.claude.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...commandEnv,
        PM_TASK_ID: task.id,
        PM_TASK_NAME: task.name,
        PM_TASK_TYPE: task.type || '',
        PM_TASK_PRIORITY: task.priority || ''
      }
    });

    function onAbort() {
      child.kill('SIGTERM');
    }

    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let stdout = '';
    let stderr = '';
    let streamLineBuffer = '';
    let streamJsonDetected = false;
    const isStreamJsonMode = command.includes('--output-format stream-json');

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, config.claude.timeoutMs);

    child.stdout.on('data', (chunk) => {
      const output = String(chunk);
      stdout += output;

      if (config.claude.streamOutput) {
        streamLineBuffer += output;
        const lines = streamLineBuffer.split('\n');
        streamLineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (isStreamJsonMode) {
            const event = parseJsonLine(line);
            if (event) {
              streamJsonDetected = true;
              const toolMessages = extractToolUseProgress(event);
              if (toolMessages) {
                for (const msg of toolMessages) {
                  process.stdout.write(`[PM_PROGRESS] ${msg}\n`);
                }
              }

              if (onAcComplete) {
                const acs = extractAcCompletions(event);
                for (const ac of acs) {
                  process.stdout.write(`[PM_AC_COMPLETE] ${ac}\n`);
                  onAcComplete(ac);
                }
              }
            }
            continue;
          }

          if (onAcComplete) {
            const ac = extractAcFromPlainLine(line);
            if (ac) {
              process.stdout.write(`[PM_AC_COMPLETE] ${ac}\n`);
              onAcComplete(ac);
              continue;
            }
          }

          if (isLikelyTaskContract(line)) {
            continue;
          }
          process.stdout.write(line + '\n');
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const output = String(chunk);
      stderr += output;

      if (config.claude.streamOutput) {
        process.stderr.write(output);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (config.claude.streamOutput && streamLineBuffer.trim()) {
        if (!isLikelyTaskContract(streamLineBuffer)) {
          process.stdout.write(streamLineBuffer + '\n');
        }
        streamLineBuffer = '';
      }

      if (code !== 0) {
        const summary = summarizeCommandOutput(stderr, stdout);
        reject(
          new Error(
            `Claude command falhou (exit=${code}, signal=${exitSignal || 'none'}): ${summary}`
          )
        );
        return;
      }

      const parsed = (streamJsonDetected ? parseStreamJsonResult(stdout) : parseJsonFromOutput(stdout)) || {};

      resolve({
        status: parsed.status || 'done',
        summary: parsed.summary || '',
        notes: parsed.notes || '',
        files: Array.isArray(parsed.files) ? parsed.files : [],
        tests: parsed.tests || '',
        completedAcs: Array.isArray(parsed.completed_acs) ? parsed.completed_acs : [],
        stdout,
        stderr
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
