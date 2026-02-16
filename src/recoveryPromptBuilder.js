import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Builds a detailed recovery prompt with expected vs actual comparison
 */
export function buildRecoveryPrompt(error, taskContext) {
  const { task, logs, workdir, exitCode } = taskContext;

  return `# Auto-Recovery Request

A task execution failed. Your job is to analyze the error, understand what was expected, and fix the underlying issue so the task can be retried successfully.

## What Was Expected

### Task Goal
${task.name}

### Task Instructions
\`\`\`markdown
${task.content}
\`\`\`

### Acceptance Criteria (Expected Outcome)
${formatAcceptanceCriteria(task.acceptanceCriteria)}

### Expected Behavior
- All Acceptance Criteria should be met
- Task should complete with status "done"
- Per-AC JSON markers should be emitted as each AC is completed: \`{"ac_complete": <number>}\`
- Final JSON response format:
\`\`\`json
{
  "status": "done",
  "summary": "Brief description of what was accomplished"
}
\`\`\`

## What Actually Happened

### Error
\`\`\`
${error.message || error.toString()}
\`\`\`

### Error Type
${categorizeError(error)}

### Execution Logs (last 3000 chars)
\`\`\`
${logs.slice(-3000)}
\`\`\`

### Task Status at Failure
- Working directory: ${workdir}
- Exit code: ${exitCode || 'N/A'}
- Timeout: ${error.timedOut ? 'YES' : 'NO'}

## Expected vs Actual Comparison

${buildExpectedVsActual(task, error, logs, workdir)}

## Your Mission

1. **Identify the gap** - What was expected but didn't happen? (missing file, wrong output format, incomplete implementation, etc.)
2. **Root cause analysis** - Why did it fail? (syntax error, missing dependency, wrong file path, logic error, etc.)
3. **Fix the issue** - Make the minimum changes needed to align actual behavior with expected outcome
4. **Verify** - Run checks to confirm the fix works (build, lint, test if applicable)

## Recovery Rules

- **Be surgical**: Fix only what's broken, don't refactor unrelated code
- **Match expectations**: Ensure your fix aligns with the Acceptance Criteria listed above
- **Preserve progress**: If some ACs were completed, don't undo that work
- **No re-execution**: Don't try to complete the task itself — only fix blockers
- **If unfixable**: Explain clearly why (e.g., requires user input, external API issue, etc.)

## Response Format

Return JSON at the end:
\`\`\`json
{
  "status": "fixed" | "unfixable",
  "summary": "What was wrong and how you fixed it",
  "root_cause": "Brief root cause analysis",
  "files_changed": ["list", "of", "files"],
  "next_steps": "What the retry should accomplish (if fixed)"
}
\`\`\`

## Examples

### Example 1: Missing Module
**Expected**: Import \`Button\` from \`src/components/Button.tsx\`
**Actual**: \`MODULE_NOT_FOUND: Cannot find module 'src/components/Button.tsx'\`
**Fix**: Create \`src/components/Button.tsx\` with basic Button component
**Response**: \`{"status": "fixed", "summary": "Created missing Button component", "root_cause": "File referenced but never created"}\`

### Example 2: Wrong JSON Format
**Expected**: Final response as \`{"status": "done", "summary": "..."}\`
**Actual**: Response was plain text "Task completed successfully"
**Fix**: This is a prompt adherence issue — cannot be fixed by editing files
**Response**: \`{"status": "unfixable", "summary": "Task didn't follow JSON response format, requires retry with clearer instructions"}\`

### Example 3: Syntax Error
**Expected**: Valid TypeScript that compiles
**Actual**: \`SyntaxError: Unexpected token '}' in src/app.tsx:42\`
**Fix**: Correct the syntax error at line 42
**Response**: \`{"status": "fixed", "summary": "Fixed syntax error in app.tsx", "files_changed": ["src/app.tsx"]}\`

### Example 4: Missing Dependency
**Expected**: Code uses \`lodash\` library
**Actual**: \`Cannot find module 'lodash'\`
**Fix**: Run \`npm install lodash\`
**Response**: \`{"status": "fixed", "summary": "Installed missing lodash dependency", "root_cause": "Dependency used but not installed"}\`
`;
}

/**
 * Formats acceptance criteria list for display
 */
function formatAcceptanceCriteria(acs) {
  if (!acs || acs.length === 0) {
    return 'None explicitly defined';
  }

  return acs.map((ac, i) => {
    const status = ac.checked ? '✅' : '⬜';
    return `  AC-${i + 1}. ${ac.text} ${status}`;
  }).join('\n');
}

/**
 * Categorizes error type for quick understanding
 */
function categorizeError(error) {
  const msg = (error.message || error.toString()).toLowerCase();

  if (msg.includes('module_not_found') || msg.includes('cannot find module')) {
    return 'Missing Module/File';
  }
  if (msg.includes('syntaxerror') || msg.includes('syntax error')) {
    return 'Syntax Error';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Execution Timeout';
  }
  if (msg.includes('typeerror') || msg.includes('referenceerror')) {
    return 'Runtime Error';
  }
  if (msg.includes('npm') || msg.includes('dependency')) {
    return 'Dependency Issue';
  }
  if (msg.includes('git')) {
    return 'Git/Version Control Issue';
  }
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return 'File Not Found';
  }
  if (msg.includes('permission denied') || msg.includes('eacces')) {
    return 'Permission Error';
  }

  return 'Unknown Error Type';
}

/**
 * Builds Expected vs Actual comparison section
 */
function buildExpectedVsActual(task, error, logs, workdir) {
  const sections = [];

  // Check if AC tracking JSON was expected but missing
  const hasACs = task.acceptanceCriteria && task.acceptanceCriteria.length > 0;
  if (hasACs) {
    const acJsonFound = logs.includes('"ac_complete"');
    const acCount = (logs.match(/"ac_complete":/g) || []).length;
    sections.push(`
### AC Tracking
- **Expected**: Per-AC JSON markers like \`{"ac_complete": 1}\` as each AC is completed (${task.acceptanceCriteria.length} total)
- **Actual**: ${acJsonFound ? `Found ${acCount} AC completion(s) ✅` : 'Missing ❌'}
    `);
  }

  // Check if final JSON was expected but missing
  const finalJsonFound = logs.includes('"status":"done"') || logs.includes('"status": "done"');
  sections.push(`
### Final JSON Response
- **Expected**: \`{"status": "done", "summary": "..."}\` at the end
- **Actual**: ${finalJsonFound ? 'Found ✅' : 'Missing ❌'}
  `);

  // Check for build/compile expectations
  if (task.content.includes('tsc') || task.content.includes('build') || task.content.includes('compile')) {
    const buildSuccess = !logs.includes('error TS') && !logs.includes('Build failed');
    sections.push(`
### Build/Compile
- **Expected**: Clean build with zero TypeScript errors
- **Actual**: ${buildSuccess ? 'Success ✅' : 'Failed ❌'}
    `);
  }

  // Check for test expectations
  if (task.content.includes('test') || task.content.includes('npm test')) {
    const testsRan = logs.includes('Test Suites:') || logs.includes('PASS') || logs.includes('FAIL');
    const testsPassed = logs.includes('PASS') && !logs.includes('FAIL');
    sections.push(`
### Tests
- **Expected**: Tests written and passing
- **Actual**: ${testsRan ? (testsPassed ? 'Tests passed ✅' : 'Tests failed ❌') : 'Tests not executed ❌'}
    `);
  }

  // Check for expected files
  const expectedFiles = extractExpectedFiles(task.content, workdir);
  if (expectedFiles.length > 0) {
    sections.push(`
### Expected Files
${expectedFiles.map(f => `- \`${f.path}\`: ${f.exists ? '✅ exists' : '❌ missing'}`).join('\n')}
    `);
  }

  return sections.join('\n');
}

/**
 * Extracts file paths mentioned in task content
 */
function extractExpectedFiles(content, workdir) {
  // Match patterns like: "Create src/components/Button.tsx", "Add file.js", "Edit path/to/file.ts"
  const fileRegex = /(?:create|add|edit|update|modify|implement)\s+[`"]?([a-zA-Z0-9_\-/.]+\.[a-z]+)[`"]?/gi;
  const matches = [...content.matchAll(fileRegex)];

  const files = matches.map(m => {
    const filePath = m[1];
    const fullPath = path.join(workdir, filePath);
    return {
      path: filePath,
      exists: fs.existsSync(fullPath),
    };
  });

  // Remove duplicates
  const uniqueFiles = Array.from(
    new Map(files.map(f => [f.path, f])).values()
  );

  return uniqueFiles;
}
