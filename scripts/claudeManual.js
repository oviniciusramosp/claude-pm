import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();
const DEFAULT_CLAUDE_COMMAND = 'claude --print';

function parseArgs(argv) {
  const args = argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  const chat = args.includes('--chat');

  const filtered = args.filter((arg) => arg !== '--help' && arg !== '-h' && arg !== '--chat');
  const prompt = filtered.join(' ').trim();

  return {
    help,
    chat,
    prompt
  };
}

function hasTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function ensureFullAccess(command, fullAccess) {
  if (!fullAccess) {
    return command;
  }

  if (command.includes('--dangerously-skip-permissions')) {
    return command;
  }

  return `${command} --dangerously-skip-permissions`;
}

function ensurePrintMode(command) {
  if (command.includes('--print') || command.includes(' -p')) {
    return command;
  }

  return `${command} --print`;
}

function removePrintMode(command) {
  return command
    .replace(/\s--print\b/g, '')
    .replace(/\s-p\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCommand({ baseCommand, fullAccess, chat }) {
  let command = String(baseCommand || '').trim();
  if (!command) {
    command = 'claude';
  }

  command = chat ? removePrintMode(command) : ensurePrintMode(command);
  command = ensureFullAccess(command, fullAccess);

  return command;
}

function runInteractive(command, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      stdio: 'inherit',
      env: options.env
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Claude interactive session terminou com exit=${code}`));
    });
  });
}

function runOneShot(command, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: options.env
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Claude one-shot terminou com exit=${code}`));
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}

async function main() {
  const { help, chat, prompt } = parseArgs(process.argv);

  if (help) {
    console.log('Usage:');
    console.log('  npm run claude:chat');
    console.log('  npm run claude:manual -- "Your prompt here"');
    return;
  }

  const fullAccess = hasTruthyEnv(process.env.CLAUDE_FULL_ACCESS);
  const baseCommand = process.env.CLAUDE_COMMAND || DEFAULT_CLAUDE_COMMAND;
  const workdir = path.resolve(process.cwd(), process.env.CLAUDE_WORKDIR || '.');
  const command = resolveCommand({
    baseCommand,
    fullAccess,
    chat: chat || !prompt
  });

  const env = {
    ...process.env
  };

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  if (chat || !prompt) {
    console.log(`Starting interactive Claude session in ${workdir}`);
    await runInteractive(command, {
      cwd: workdir,
      env
    });
    return;
  }

  await runOneShot(command, {
    cwd: workdir,
    env,
    prompt
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
