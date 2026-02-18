# Product Manager Automation Instructions

> **Auto-generated** by the Product Manager automation system.
> Do not edit this section manually — it will be overwritten on each startup.

## Automation Context

You are being driven by the **Product Manager** automation system.
A task has been assigned to you. Execute it according to the instructions provided via stdin.
The automation system will move the task through the board based on your JSON response.

## Board Structure

Tasks live as `.md` files with YAML frontmatter in the `Board/` directory.

**CRITICAL: Status is tracked via the `status` field in frontmatter, NOT by folder location.**

Valid status values (exact match required):
- `"Not Started"` - Task not yet started
- `"In Progress"` - Task currently being worked on
- `"Done"` - Task completed successfully

**Structure:**
```
Board/
├── my-standalone-task.md     # Standalone task
└── Epic-1/                   # Epic folder
    ├── epic.md               # Epic definition
    ├── us-001-login.md       # Child task 1
    └── us-002-signup.md      # Child task 2
```

**Required frontmatter fields:**
- `name` - Task name
- `status` - One of: `"Not Started"`, `"In Progress"`, `"Done"` (exact match with spaces and capitals)
- `type` - Task type (e.g., `UserStory`, `Bug`, `Chore`, `Epic`)
- `priority` - Priority level (e.g., `P0`, `P1`, `P2`, `P3`)

**When you update a task, NEVER modify the `status` field yourself.** The orchestrator handles status updates.

## Available Environment Variables

The following environment variables are set for every task execution:

| Variable | Description |
|----------|-------------|
| `PM_TASK_ID` | Unique task identifier (e.g. `implement-login` or `Epic-Auth/us-001-login`) |
| `PM_TASK_NAME` | Human-readable task name |
| `PM_TASK_TYPE` | Task type: `UserStory`, `Bug`, `Chore`, or `Epic` |
| `PM_TASK_PRIORITY` | Priority level: `P0`, `P1`, `P2`, or `P3` |

## Acceptance Criteria Tracking (MANDATORY)

Each task prompt includes a **numbered AC reference table** (AC-1, AC-2, etc.).
You MUST track completion using these AC numbers during execution:

As you complete EACH Acceptance Criteria, emit a JSON marker IMMEDIATELY on its own line:

```
{"ac_complete": <number>}
```

**Example:** After completing AC-1, emit: `{"ac_complete": 1}`

**Rules:**
- Use the AC number from the reference table in the task prompt.
- Each marker MUST be a standalone JSON object on its own line.
- Emit this marker IMMEDIATELY after completing each AC, before moving to the next.
- Do NOT include `ac_complete` markers inside the final response JSON.

## Response Format (MANDATORY)

After completing all work, you MUST respond with a final JSON object in a **single line**.

Required JSON structure:

```json
{
  "status": "done|blocked",
  "summary": "Brief summary of what was done",
  "notes": "Additional details or context",
  "files": ["path/to/file1.js", "path/to/file2.ts"],
  "tests": "Test results summary"
}
```

**Field requirements:**

| Field | Description |
|-------|-------------|
| `status` | Use `"done"` ONLY when ALL Acceptance Criteria are complete. Use `"blocked"` if blocked. |
| `summary` | Concise description of what was accomplished. |
| `notes` | Any important details, decisions, or context. |
| `files` | Array of file paths that were created or modified. |
| `tests` | Summary of test results or `"N/A"` if not applicable. |

**CRITICAL COMPLETION GATE:**

- BEFORE emitting final JSON with `"status":"done"`, verify ALL ACs are complete.
- The orchestrator will verify all AC checkboxes are checked. Incomplete ACs will cause task rejection.
- If you cannot complete an AC, use `"status":"blocked"` and explain in notes.

**IMPORTANT:** The final JSON must contain a `"status"` field. Do NOT include `"ac_complete"` in this JSON.
If you are blocked at any point, emit the final JSON immediately with `"status": "blocked"`.

**Example valid response:**

```json
{"status":"done","summary":"Implemented login page with form validation","notes":"Used React Hook Form for validation","files":["src/pages/Login.tsx","src/components/LoginForm.tsx"],"tests":"5 tests passing"}
```

## General Rules

- Complete all Acceptance Criteria in the task.
- Track EACH completed AC using `{"ac_complete": <number>}` JSON markers (see above).
- **BEFORE emitting final JSON:** Verify ALL ACs are complete. Re-read the AC list and confirm you emitted every AC number.
- If any AC is incomplete, DO NOT return `"done"` status. Complete the missing AC first.
- The orchestrator will verify all AC checkboxes are checked. Incomplete ACs will cause task rejection.
- On successful completion, create a commit with a clear, objective message.
- Never include secrets in code, commits, or logs.
- All code must be written in English (variable names, function names, comments, log messages).