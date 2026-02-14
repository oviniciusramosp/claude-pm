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
    claudeMdInjected = false
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

  if (!claudeMdInjected) {
    basePrompt.push(
      '='.repeat(80),
      'ACCEPTANCE CRITERIA TRACKING (MANDATORY)',
      '='.repeat(80),
      '',
      'You MUST track Acceptance Criteria completion in TWO ways:',
      '',
      '1. INCREMENTAL TRACKING (during execution):',
      '   - As you complete EACH Acceptance Criteria individually, emit immediately:',
      '   - Format: [AC_COMPLETE] <exact AC text without the "- [ ] " prefix>',
      '   - Example: if AC is "- [ ] Login page renders correctly"',
      '   - Emit: [AC_COMPLETE] Login page renders correctly',
      '   - Emit this marker IMMEDIATELY after completing each AC, before moving to the next.',
      '',
      '2. FINAL TRACKING (in JSON response):',
      '   - Your JSON response MUST include a "completed_acs" field',
      '   - This field is MANDATORY, not optional',
      '   - List ALL completed Acceptance Criteria exactly as they appear (without "- [ ]")',
      '   - Example: "completed_acs": ["Login page renders correctly", "Form validates email"]',
      '',
      'If you complete ANY Acceptance Criteria but fail to include them in "completed_acs",',
      'your response will be REJECTED and you will be asked to retry.',
      '',
      '='.repeat(80),
      ''
    );
  }

  basePrompt.push(
    normalizeText(markdown || '(no description)'),
    ''
  );

  if (!claudeMdInjected) {
    basePrompt.push(
      'Execution Rules:',
      '- Complete all Acceptance Criteria in the task.',
      '- Track EACH completed AC using [AC_COMPLETE] markers (see above).',
      '- On successful completion, create a commit with a clear, objective message.',
      '- Never include secrets in code, commits, or logs.',
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

  if (!claudeMdInjected) {
    basePrompt.push(
      '='.repeat(80),
      'RESPONSE REQUIREMENTS (MANDATORY)',
      '='.repeat(80),
      '',
      'You MUST respond with a valid JSON object in a single line.',
      '',
      'Required JSON structure:',
      '{',
      '  "status": "done|blocked",',
      '  "summary": "Brief summary of what was done",',
      '  "notes": "Additional details or context",',
      '  "files": ["path/to/file1.js", "path/to/file2.ts"],',
      '  "tests": "Test results summary",',
      '  "completed_acs": ["First AC text", "Second AC text", "Third AC text"]',
      '}',
      '',
      'Field requirements:',
      '- status: Use "done" only when implementation is complete. Use "blocked" if blocked.',
      '- summary: Concise description of what was accomplished.',
      '- notes: Any important details, decisions, or context.',
      '- files: Array of file paths that were created or modified.',
      '- tests: Summary of test results or "N/A" if not applicable.',
      '- completed_acs: MANDATORY FIELD - Array of completed Acceptance Criteria texts.',
      '',
      'WARNING: If you complete ANY Acceptance Criteria but omit them from "completed_acs",',
      'your response will be REJECTED. This field is NOT optional.',
      '',
      'Example valid response:',
      '{"status":"done","summary":"Implemented login page with form validation","notes":"Used React Hook Form for validation, added error messages","files":["src/pages/Login.tsx","src/components/LoginForm.tsx"],"tests":"5 tests passing: form renders, validates email, validates password, submits on valid input, shows error on invalid input","completed_acs":["Login page renders correctly","Form validates email format","Form validates password strength","Error messages are displayed","Submit button is disabled when invalid"]}',
      '',
      '='.repeat(80),
      ''
    );
  }

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

export function buildReviewPrompt(task, markdown, executionResult) {
  const agents = task.agents.length > 0 ? task.agents.join(', ') : '(no agents specified)';
  const filesList = Array.isArray(executionResult.files) && executionResult.files.length > 0
    ? executionResult.files.join(', ')
    : '(none)';

  const lines = [
    'You are reviewing work done by another Claude model on the task below.',
    'Your role is to verify the implementation meets acceptance criteria, identify issues, and fix them.',
    '',
    'Task Context:',
    `- Name: ${normalizeText(task.name)}`,
    `- ID: ${normalizeText(task.id)}`,
    `- Type: ${normalizeText(task.type)}`,
    `- Priority: ${normalizeText(task.priority)}`,
    `- Agents: ${agents}`,
    '',
    '## Original Task Description',
    normalizeText(markdown || '(no description)'),
    '',
    '## Previous Execution Result',
    `- Status: ${executionResult.status || 'done'}`,
    `- Summary: ${executionResult.summary || '(none)'}`,
    `- Notes: ${executionResult.notes || '(none)'}`,
    `- Tests: ${executionResult.tests || '(none)'}`,
    `- Files Changed: ${filesList}`,
    '',
    'Review Instructions:',
    '- Verify all Acceptance Criteria from the task description were met.',
    '- Review changed files for correctness, code quality, and adherence to project conventions.',
    '- If you find issues, fix them directly. Create a commit with your corrections.',
    '- If everything is correct or you fixed all issues, return status "done".',
    '- Use "blocked" only if there is a problem you cannot resolve (missing access, external dependency, ambiguous requirements).',
    '- Never expose secrets in code, commits, or logs.',
    '',
    'Response Requirements:',
    '- Respond ONLY with a valid JSON object in a single line.',
    '- Required structure:',
    '{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '- Use "done" when the implementation is verified and correct (with or without your corrections).',
    '- Use "blocked" only for problems you cannot resolve, and detail the reason in notes.',
    ''
  ];

  return lines.join('\n');
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
