import { parseAcs, formatAcsForPrompt } from './acParser.js';
import { loadTemplate } from './templateLoader.js';

function normalizeText(value) {
  if (!value || String(value).trim().length === 0) {
    return '(not provided)';
  }

  return String(value).trim();
}

export function buildTaskPrompt(task, markdown, options = {}) {
  const {
    extraPrompt = '',
    forceTestCreation = false,
    forceTestRun = false,
    forceCommit = false,
    enableMultiAgents = false,
    taskFilePath = ''
  } = typeof options === 'string' ? { extraPrompt: options } : options;

  const agents = task.agents.length > 0 ? task.agents.join(', ') : '(no agents specified)';

  const basePrompt = [
    'Execute the task described below:',
    '',
    'Task Context:',
    `- Name: ${normalizeText(task.name)}`,
    `- ID: ${normalizeText(task.id)}`,
    `- Type: ${normalizeText(task.type)}`,
    `- Priority: ${normalizeText(task.priority)}`,
    `- Run these agents for this task: ${agents}`,
    ''
  ];

  // Parse ACs from the markdown and build numbered reference table
  const acList = parseAcs(markdown || '');
  const acTable = formatAcsForPrompt(acList);

  if (acTable) {
    basePrompt.push(acTable);
  }

  // AC tracking instructions: primary = edit the task file, secondary = JSON markers
  if (taskFilePath && acList.length > 0) {
    basePrompt.push(
      '## AC Tracking',
      `Task file: ${taskFilePath}`,
      'For each completed AC:',
      '1. Edit the task file: change `- [ ]` to `- [x]`',
      '2. Emit on its own line: `{"ac_complete": <number>}`',
      'Do this as you go — not at the end. Unchecked ACs = task rejection.',
      ''
    );
  } else if (acList.length > 0) {
    basePrompt.push(
      '## AC Tracking',
      'For each completed AC, emit on its own line: `{"ac_complete": <number>}`',
      'Emit as you go. Do NOT include ac_complete in the final JSON.',
      ''
    );
  }

  basePrompt.push(
    normalizeText(markdown || '(no description)'),
    ''
  );

  if (enableMultiAgents) {
    basePrompt.push(
      '## Multi-Agent Execution',
      'Use the Task tool to launch parallel agents when sub-tasks are independent.',
      'Agent types: Bash (git/terminal), general-purpose (multi-step), Explore (codebase search), Plan (architecture).',
      'Launch multiple Task calls in one message for parallel work. Only use when genuinely faster than single-agent.',
      ''
    );
  }

  if (forceTestCreation || forceTestRun || forceCommit) {
    basePrompt.push('Mandatory completion rules:');

    if (forceTestCreation) {
      basePrompt.push('- After finishing the task, ensure automated tests were created (when applicable).');
    }

    if (forceTestRun) {
      basePrompt.push('- After finishing the task, ensure all tests are run and passing.');
    }

    if (forceCommit) {
      basePrompt.push('- After finishing the task, if everything is ok, create a commit before moving tasks to Done.');
    }

    basePrompt.push('');
  }

  // Response requirements
  basePrompt.push(
    '## Response',
    'After all work, emit a final JSON on a single line:',
    '`{"status":"done","summary":"...","notes":"...","files":["..."],"tests":"..."}`',
    '- status: "done" only when ALL AC checkboxes are checked. "blocked" if stuck.',
    '- Verify all ACs are checked before emitting "done". Do NOT include "ac_complete" here.',
    '- On completion, create a commit with a clear message. Never include secrets.',
    ''
  );

  if (extraPrompt && extraPrompt.trim().length > 0) {
    basePrompt.push('Additional operator instructions:');
    basePrompt.push(extraPrompt.trim());
    basePrompt.push('');
  }

  return basePrompt.join('\n');
}

export function buildRetryPrompt(task, originalPrompt) {
  const lines = [
    `# RETRY: Task "${normalizeText(task.name)}" - previous attempt produced no artifacts`,
    '',
    'Your previous execution returned status "done", but post-execution validation found:',
    '- No new commits in the repository.',
    '- No modified or new files in the working directory.',
    '- The declared output files do not exist on disk.',
    '',
    'This means the task was NOT actually completed. Your response was a hallucination.',
    'You MUST actually create files, write code, run commands, and make real changes this time.',
    'Do NOT just respond with a JSON contract without doing the work first.',
    '',
    '---',
    '',
    'Original task instructions:',
    '',
    originalPrompt
  ];

  return lines.join('\n');
}

export function buildTaskCompletionNotes(task, execution) {
  const lines = [];
  lines.push(`## Execution Notes (${new Date().toISOString()})`);
  lines.push(`Task: ${task.name}`);

  if (task.url) {
    lines.push(`Reference: ${task.url}`);
  }

  if (execution.summary) {
    lines.push('');
    lines.push('### Summary');
    lines.push(execution.summary);
  }

  if (execution.notes) {
    lines.push('');
    lines.push('### Notes');
    lines.push(execution.notes);
  }

  if (execution.tests) {
    lines.push('');
    lines.push('### Tests');
    lines.push(execution.tests);
  }

  if (Array.isArray(execution.files) && execution.files.length > 0) {
    lines.push('');
    lines.push('### Files');
    for (const file of execution.files) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join('\n');
}

export async function buildReviewPrompt(task, markdown, executionResult) {
  const agents = task.agents.length > 0 ? task.agents.join(', ') : '(no agents specified)';
  const filesList = Array.isArray(executionResult.files) && executionResult.files.length > 0
    ? executionResult.files.join(', ')
    : '(none)';

  return loadTemplate('opus-review.md', {
    TASK_NAME: normalizeText(task.name),
    TASK_ID: normalizeText(task.id),
    TASK_TYPE: normalizeText(task.type),
    TASK_PRIORITY: normalizeText(task.priority),
    AGENTS: agents,
    TASK_DESCRIPTION: normalizeText(markdown || '(no description)'),
    EXEC_STATUS: executionResult.status || 'done',
    EXEC_SUMMARY: executionResult.summary || '(none)',
    EXEC_NOTES: executionResult.notes || '(none)',
    EXEC_TESTS: executionResult.tests || '(none)',
    EXEC_FILES: filesList,
  });
}

export function buildEpicReviewPrompt(epicTask, children, epicSummary) {
  const childList = children.map((child) => {
    const row = epicSummary.rows.find((r) => r.id === child.id);
    const duration = row?.durationMs ? formatDuration(row.durationMs) : '(no data)';
    return `- ${child.name} (duration: ${duration})`;
  }).join('\n');

  const lines = [
    'You are reviewing a complete Epic. All sub-tasks have been completed by other models.',
    'Your role is to ensure the Epic implementation as a whole is correct and functional.',
    '',
    'Epic Context:',
    `- Name: ${normalizeText(epicTask.name)}`,
    `- ID: ${normalizeText(epicTask.id)}`,
    `- Type: ${normalizeText(epicTask.type)}`,
    `- Priority: ${normalizeText(epicTask.priority)}`,
    `- Total accumulated duration: ${formatDuration(epicSummary.totalDurationMs)}`,
    '',
    '## Completed Sub-tasks',
    childList,
    '',
    'Review Instructions:',
    '1. Run all automated tests in the project (npm test, npm run test, or available test command).',
    '2. Review the complete Epic implementation, checking consistency between sub-tasks.',
    '3. Verify code quality, adherence to project conventions, and absence of regressions.',
    '4. If you find issues (failing tests, bugs, inconsistencies), fix them directly.',
    '5. Create a commit with your corrections if there are changes.',
    '',
    'Approval Criteria:',
    '- All automated tests passing.',
    '- Consistent implementation without regressions.',
    '- Code following project conventions.',
    '',
    'Response Requirements:',
    '- Respond ONLY with a valid JSON object in a single line.',
    '- Required structure:',
    '{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '- Use "done" when everything is verified and correct (with or without your corrections).',
    '- Use "blocked" only for problems you cannot resolve.',
    '- In the "tests" field, include the test execution result.',
    ''
  ];

  return lines.join('\n');
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return '0s';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export function buildEpicSummary(epicTask, summary) {
  const lines = [];
  lines.push(`## Resumo da automacao (${new Date().toISOString()})`);
  lines.push(`Epic: ${epicTask.name}`);

  if (summary.earliest) {
    lines.push(`Inicio estimado: ${summary.earliest}`);
  }

  if (summary.latest) {
    lines.push(`Fim estimado: ${summary.latest}`);
  }

  lines.push(`Duracao acumulada: ${formatDuration(summary.totalDurationMs)}`);
  lines.push('');
  lines.push('Tarefas concluidas:');

  for (const row of summary.rows) {
    lines.push(`- ${row.name} (${formatDuration(row.durationMs || 0)})`);
  }

  return lines.join('\n');
}
