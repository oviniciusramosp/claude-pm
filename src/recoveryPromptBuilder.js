import { loadTemplate } from './templateLoader.js';

/**
 * Formats acceptance criteria for display in recovery prompt
 */
function formatAcceptanceCriteria(acs) {
  if (!acs || acs.length === 0) {
    return 'None explicitly defined';
  }

  return acs.map((ac, i) => {
    const status = ac.checked ? '(done)' : '(pending)';
    return `  AC-${i + 1}. ${ac.text} ${status}`;
  }).join('\n');
}

/**
 * Builds a recovery prompt from template
 */
export async function buildRecoveryPrompt(error, taskContext) {
  const { task, logs, workdir, exitCode } = taskContext;

  return loadTemplate('recovery.md', {
    TASK_NAME: task.name,
    TASK_CONTENT: task.content,
    ACCEPTANCE_CRITERIA: formatAcceptanceCriteria(task.acceptanceCriteria),
    ERROR_MESSAGE: error.message || error.toString(),
    EXECUTION_LOGS: logs.slice(-3000),
    WORKDIR: workdir,
    EXIT_CODE: exitCode || 'N/A',
    TIMED_OUT: error.timedOut ? 'YES' : 'NO',
  });
}
