import fs from 'node:fs/promises';
import path from 'node:path';

const START_MARKER = '<!-- PRODUCT-MANAGER:START -->';
const END_MARKER = '<!-- PRODUCT-MANAGER:END -->';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function generateManagedContent() {
  const lines = [];

  lines.push('# Product Manager Automation Instructions');
  lines.push('');
  lines.push('> **Auto-generated** by the Product Manager automation system.');
  lines.push('> Do not edit this section manually — it will be overwritten on each startup.');
  lines.push('');

  // Automation Context
  lines.push('## Automation Context');
  lines.push('');
  lines.push('You are being driven by the **Product Manager** automation system.');
  lines.push('A task has been assigned to you. Execute it according to the instructions provided via stdin.');
  lines.push('The automation system will move the task through the board based on your JSON response.');
  lines.push('');

  // Environment Variables
  lines.push('## Available Environment Variables');
  lines.push('');
  lines.push('The following environment variables are set for every task execution:');
  lines.push('');
  lines.push('| Variable | Description |');
  lines.push('|----------|-------------|');
  lines.push('| `PM_TASK_ID` | Unique task identifier (e.g. `implement-login` or `Epic-Auth/us-001-login`) |');
  lines.push('| `PM_TASK_NAME` | Human-readable task name |');
  lines.push('| `PM_TASK_TYPE` | Task type: `UserStory`, `Bug`, `Chore`, or `Epic` |');
  lines.push('| `PM_TASK_PRIORITY` | Priority level: `P0`, `P1`, `P2`, or `P3` |');
  lines.push('');

  // AC Tracking Protocol
  lines.push('## Acceptance Criteria Tracking (MANDATORY)');
  lines.push('');
  lines.push('Each task prompt includes a **numbered AC reference table** (AC-1, AC-2, etc.).');
  lines.push('You MUST track completion using these AC numbers during execution:');
  lines.push('');
  lines.push('As you complete EACH Acceptance Criteria, emit a JSON marker IMMEDIATELY on its own line:');
  lines.push('');
  lines.push('```');
  lines.push('{"ac_complete": <number>}');
  lines.push('```');
  lines.push('');
  lines.push('**Example:** After completing AC-1, emit: `{"ac_complete": 1}`');
  lines.push('');
  lines.push('**Rules:**');
  lines.push('- Use the AC number from the reference table in the task prompt.');
  lines.push('- Each marker MUST be a standalone JSON object on its own line.');
  lines.push('- Emit this marker IMMEDIATELY after completing each AC, before moving to the next.');
  lines.push('- Do NOT include `ac_complete` markers inside the final response JSON.');
  lines.push('');

  // Response Contract
  lines.push('## Response Format (MANDATORY)');
  lines.push('');
  lines.push('After completing all work, you MUST respond with a final JSON object in a **single line**.');
  lines.push('');
  lines.push('Required JSON structure:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "status": "done|blocked",');
  lines.push('  "summary": "Brief summary of what was done",');
  lines.push('  "notes": "Additional details or context",');
  lines.push('  "files": ["path/to/file1.js", "path/to/file2.ts"],');
  lines.push('  "tests": "Test results summary"');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('**Field requirements:**');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `status` | Use `"done"` only when implementation is complete. Use `"blocked"` if blocked. |');
  lines.push('| `summary` | Concise description of what was accomplished. |');
  lines.push('| `notes` | Any important details, decisions, or context. |');
  lines.push('| `files` | Array of file paths that were created or modified. |');
  lines.push('| `tests` | Summary of test results or `"N/A"` if not applicable. |');
  lines.push('');
  lines.push('**IMPORTANT:** The final JSON must contain a `"status"` field. Do NOT include `"ac_complete"` in this JSON.');
  lines.push('If you are blocked at any point, emit the final JSON immediately with `"status": "blocked"`.');
  lines.push('');
  lines.push('**Example valid response:**');
  lines.push('');
  lines.push('```json');
  lines.push('{"status":"done","summary":"Implemented login page with form validation","notes":"Used React Hook Form for validation","files":["src/pages/Login.tsx","src/components/LoginForm.tsx"],"tests":"5 tests passing"}');
  lines.push('```');
  lines.push('');

  // General Rules
  lines.push('## General Rules');
  lines.push('');
  lines.push('- Complete all Acceptance Criteria in the task.');
  lines.push('- Track EACH completed AC using `{"ac_complete": <number>}` JSON markers (see above).');
  lines.push('- On successful completion, create a commit with a clear, objective message.');
  lines.push('- Never include secrets in code, commits, or logs.');
  lines.push('- All code must be written in English (variable names, function names, comments, log messages).');

  return lines.join('\n');
}

export async function syncClaudeMd(config, logger) {
  const targetDir = config.claude.workdir;
  const targetPath = path.join(targetDir, 'CLAUDE.md');
  const newContent = generateManagedContent();
  const fullSection = `${START_MARKER}\n${newContent}\n${END_MARKER}`;

  let existingContent = '';
  let fileExists = false;

  try {
    existingContent = await fs.readFile(targetPath, 'utf8');
    fileExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!fileExists) {
    await fs.writeFile(targetPath, fullSection + '\n', 'utf8');
    logger.success(`Created CLAUDE.md with managed section at: ${targetPath}`);
    return { action: 'created' };
  }

  const markerRegex = new RegExp(
    `${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`,
    'm'
  );
  const match = existingContent.match(markerRegex);

  if (match) {
    if (match[0] === fullSection) {
      logger.info('CLAUDE.md managed section is already up to date');
      return { action: 'unchanged' };
    }

    const updated = existingContent.replace(markerRegex, fullSection);
    await fs.writeFile(targetPath, updated, 'utf8');
    logger.success(`Updated managed section in CLAUDE.md at: ${targetPath}`);
    return { action: 'updated' };
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  await fs.writeFile(targetPath, existingContent + separator + fullSection + '\n', 'utf8');
  logger.success(`Appended managed section to existing CLAUDE.md at: ${targetPath}`);
  return { action: 'appended' };
}
