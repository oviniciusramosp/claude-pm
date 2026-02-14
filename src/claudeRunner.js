import { spawn } from 'node:child_process';
const FIXED_CLAUDE_COMMAND = '/opt/homebrew/bin/claude --print';

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

function buildCommand(config, task) {
  let cmd = FIXED_CLAUDE_COMMAND;

  if (task.model) {
    cmd += ` --model ${task.model}`;
  }

  if (config.claude.fullAccess && !cmd.includes('--dangerously-skip-permissions')) {
    cmd += ' --dangerously-skip-permissions';
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

export function runClaudeTask(task, prompt, config) {
  return new Promise((resolve, reject) => {
    const commandEnv = { ...process.env };
    if (config.claude.oauthToken) {
      commandEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claude.oauthToken;
    }

    const command = buildCommand(config, task);

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

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, config.claude.timeoutMs);

    child.stdout.on('data', (chunk) => {
      const output = String(chunk);
      stdout += output;

      if (config.claude.streamOutput) {
        process.stdout.write(output);
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
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (code !== 0) {
        const summary = summarizeCommandOutput(stderr, stdout);
        reject(
          new Error(
            `Claude command falhou (exit=${code}, signal=${signal || 'none'}): ${summary}`
          )
        );
        return;
      }

      const parsed = parseJsonFromOutput(stdout) || {};

      resolve({
        status: parsed.status || 'done',
        summary: parsed.summary || '',
        notes: parsed.notes || '',
        files: Array.isArray(parsed.files) ? parsed.files : [],
        tests: parsed.tests || '',
        stdout,
        stderr
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
