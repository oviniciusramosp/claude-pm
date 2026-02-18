# Auto-Recovery Request

A task execution failed. Your job is to analyze the error, understand what was expected, and fix the underlying issue so the task can be retried successfully.

## What Was Expected

### Task Goal
{{TASK_NAME}}

### Task Instructions
```markdown
{{TASK_CONTENT}}
```

### Acceptance Criteria (Expected Outcome)
{{ACCEPTANCE_CRITERIA}}

### Expected Behavior
- All Acceptance Criteria should be met
- Task should complete with status "done"
- Per-AC JSON markers should be emitted as each AC is completed: `{"ac_complete": <number>}`
- Final JSON response format:
```json
{
  "status": "done",
  "summary": "Brief description of what was accomplished"
}
```

## What Actually Happened

### Error
```
{{ERROR_MESSAGE}}
```

### Execution Logs (last 3000 chars)
```
{{EXECUTION_LOGS}}
```

### Task Status at Failure
- Working directory: {{WORKDIR}}
- Exit code: {{EXIT_CODE}}
- Timeout: {{TIMED_OUT}}

## Your Mission

1. **Analyze the logs and error** - Determine what was expected vs what actually happened (missing files, wrong output format, incomplete implementation, test failures, build errors, etc.)
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
```json
{
  "status": "fixed" | "unfixable",
  "summary": "What was wrong and how you fixed it",
  "root_cause": "Brief root cause analysis",
  "files_changed": ["list", "of", "files"],
  "next_steps": "What the retry should accomplish (if fixed)"
}
```
