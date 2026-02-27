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
      '='.repeat(80),
      'ACCEPTANCE CRITERIA TRACKING (MANDATORY)',
      '='.repeat(80),
      '',
      `Your task file is at: ${taskFilePath}`,
      '',
      'As you complete each Acceptance Criteria, you MUST update the task file to check it off.',
      'Use the Edit tool to change `- [ ]` to `- [x]` for each completed AC.',
      '',
      'Example: after completing AC-1, edit the task file to change:',
      '  - [ ] First acceptance criterion',
      'to:',
      '  - [x] First acceptance criterion',
      '',
      'Do this for EACH AC as you complete it — do not wait until the end.',
      'The orchestrator reads this file after execution. Any unchecked AC means task rejection.',
      '',
      'Additionally, emit a JSON marker on its own line for real-time progress tracking:',
      '  {"ac_complete": <number>}',
      '',
      '='.repeat(80),
      ''
    );
  } else if (acList.length > 0) {
    // Fallback: no file path available, use JSON markers only
    basePrompt.push(
      '='.repeat(80),
      'ACCEPTANCE CRITERIA TRACKING (MANDATORY)',
      '='.repeat(80),
      '',
      'As you complete each AC, emit a JSON marker on its own line:',
      '  {"ac_complete": <number>}',
      '',
      'Example: after completing AC-3, emit: {"ac_complete": 3}',
      '',
      'Emit markers as you go — do not wait until the end.',
      'Do NOT include ac_complete inside the final response JSON.',
      '',
      '='.repeat(80),
      ''
    );
  }

  basePrompt.push(
    normalizeText(markdown || '(no description)'),
    ''
  );

  // Execution rules
  basePrompt.push(
    '='.repeat(80),
    'EXECUTION RULES',
    '='.repeat(80),
    '',
    '- Complete ALL Acceptance Criteria. Every single one.',
    '- After completing each AC, update the task file checkbox (`- [ ]` → `- [x]`).',
    '- Before finishing, re-read the AC reference table and verify every AC is done.',
    '- If any AC is incomplete, complete it before emitting the final JSON.',
    '- The orchestrator will reject the task if any checkbox remains unchecked.',
    '- On successful completion, create a commit with a clear, objective message.',
    '- Never include secrets in code, commits, or logs.',
    '',
    '='.repeat(80),
    ''
  );

  if (enableMultiAgents) {
    basePrompt.push(
      '='.repeat(80),
      'MULTI-AGENT EXECUTION (ENABLED)',
      '='.repeat(80),
      '',
      'You are encouraged to use multiple agents in parallel when appropriate to improve speed and quality.',
      '',
      'When to use multi-agents:',
      '- Complex tasks that can be broken down into independent sub-tasks.',
      '- Tasks that involve multiple domains (e.g., frontend + backend, or UI + tests).',
      '- Tasks where different agents have specialized skills.',
      '',
      'How to use multi-agents effectively:',
      '- Use the Task tool to launch specialized agents for independent work.',
      '- Launch multiple agents in parallel by sending multiple Task tool calls in a single message.',
      '- Coordinate between agents by passing context and results.',
      '- Ensure each agent has clear, focused responsibilities.',
      '',
      'Available agent types:',
      '- Bash: Command execution specialist for git operations and terminal tasks.',
      '- general-purpose: Multi-step tasks, code search, complex research.',
      '- Explore: Fast codebase exploration and pattern searching.',
      '- Plan: Software architecture and implementation planning.',
      '',
      'Example parallel execution:',
      '- Launch a frontend agent to build UI components.',
      '- Simultaneously launch a test agent to write test cases.',
      '- Coordinate results and integrate when both complete.',
      '',
      'IMPORTANT: Only use multi-agents when it genuinely improves the task execution.',
      'For simple, focused tasks, a single-agent approach is more efficient.',
      '',
      '='.repeat(80),
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
    '='.repeat(80),
    'RESPONSE REQUIREMENTS',
    '='.repeat(80),
    '',
    'After completing all work, respond with a final JSON object on a single line:',
    '',
    '{"status":"done","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '',
    '- status: "done" only when ALL ACs are checked off. "blocked" if stuck.',
    '- summary: What was accomplished.',
    '- notes: Important details or decisions.',
    '- files: Array of created/modified file paths.',
    '- tests: Test results summary or "N/A".',
    '',
    'Before emitting "status":"done", verify all AC checkboxes in the task file are checked.',
    'Do NOT include "ac_complete" in this final JSON.',
    '',
    '='.repeat(80),
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
