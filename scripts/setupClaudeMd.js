import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();
const DEFAULT_CLAUDE_COMMAND = 'claude --print';

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    help: args.has('--help') || args.has('-h')
  };
}

function runClaude(command, prompt, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude execution failed (exit=${code}): ${stderr || stdout || 'no output'}`));
        return;
      }

      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function resolveClaudeCommand(baseCommand, fullAccess) {
  const trimmed = baseCommand.trim();
  let command = trimmed;

  if (!command.includes('--permission-mode')) {
    command = `${command} --permission-mode acceptEdits`;
  }

  if (fullAccess && !command.includes('--dangerously-skip-permissions')) {
    command = `${command} --dangerously-skip-permissions`;
  }

  return command;
}

function buildPrompt(context) {
  const existingFileInfo = context.existingContent
    ? [
        'Current CLAUDE.md content (use as a base to update without losing context):',
        '---',
        context.existingContent,
        '---',
        ''
      ]
    : [
        'No CLAUDE.md file exists yet in this repository.',
        'Create the CLAUDE.md file with the structure below.',
        ''
      ];

  return [
    'Update the CLAUDE.md file in THIS repository using file tools (Edit/Write).',
    'Do not respond with the full file content.',
    'Edit the file in-place, preserving useful existing sections.',
    'Do not delete valid existing instructions unnecessarily.',
    '',
    ...existingFileInfo,
    '',
    'Project context:',
    '- Project: Product Manager Automation (local Board + Claude Code).',
    '- Goal: automatically execute Board tasks, implement in the repository, and report results.',
    `- Board directory: ${context.boardDir}`,
    `- Board statuses: ${context.notStarted} -> ${context.inProgress} -> ${context.done}`,
    '- Task types: Epic, UserStory, Bug, Chore.',
    '- Sub-tasks live inside the Epic folder and use frontmatter status.',
    '',
    'Required CLAUDE.md content:',
    '1) A brief summary of the expected agent operational flow.',
    '2) Execution checklist per task:',
    '   - read current task and criteria',
    '   - implement',
    '   - run relevant local validations',
    '   - create a commit on completion (concise, objective message)',
    '   - move the task to Done when the flow requires manual update',
    '   - return a final JSON in the format used by the automation.',
    '3) Board section:',
    '   - tasks are .md files with YAML frontmatter inside Board/',
    '   - never hardcode tokens in the repository',
    '   - always include the task ID as a reference in the output.',
    '4) Security section: do not leak secrets in logs, commits, code, or docs.',
    '5) Response format section with JSON:',
    '   {"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '6) Git section with short and practical commit conventions.',
    '',
    'Important:',
    '- Do not include real token values in the file.',
    '- If mentioning credentials, reference only environment variable names.',
    '- The text should be practical, direct, and execution-oriented.',
    '- At the end, respond with ONLY a single-line JSON:',
    '  {"status":"ok|blocked","summary":"...","changes":["..."]}',
    ''
  ].join('\n');
}

async function main() {
  const { help } = parseArgs(process.argv);

  if (help) {
    console.log('Usage: npm run setup:claude-md');
    console.log('Updates (or creates) CLAUDE.md via Claude, without overwriting directly from a script.');
    return;
  }

  const targetPath = path.resolve(process.cwd(), 'CLAUDE.md');

  const baseCommand = process.env.CLAUDE_COMMAND || DEFAULT_CLAUDE_COMMAND;
  const fullAccess = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CLAUDE_FULL_ACCESS || '').toLowerCase()
  );
  const command = resolveClaudeCommand(baseCommand, fullAccess);
  const boardDir = process.env.BOARD_DIR || 'Board';
  const notStarted = process.env.BOARD_STATUS_NOT_STARTED || 'Not Started';
  const inProgress = process.env.BOARD_STATUS_IN_PROGRESS || 'In Progress';
  const done = process.env.BOARD_STATUS_DONE || 'Done';

  let existingContent = '';
  let existedBefore = false;
  try {
    existingContent = await fs.readFile(targetPath, 'utf8');
    existedBefore = true;
  } catch {
    existingContent = '';
  }

  const prompt = buildPrompt({
    boardDir,
    notStarted,
    inProgress,
    done,
    existingContent
  });

  const env = {
    ...process.env
  };

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  const response = await runClaude(command, prompt, env);

  let fileExistsNow = false;
  let updatedContent = '';
  try {
    updatedContent = await fs.readFile(targetPath, 'utf8');
    fileExistsNow = true;
  } catch {
    fileExistsNow = false;
  }

  if (!fileExistsNow) {
    throw new Error('Claude did not create/update CLAUDE.md.');
  }

  const changed = !existedBefore || existingContent !== updatedContent;
  if (!changed) {
    console.warn('Claude executed, but CLAUDE.md did not change.');
  }

  console.log(`CLAUDE.md processed at: ${targetPath}`);
  if (response) {
    console.log(response);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
