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

## Task Execution

AC tracking, response format, and execution rules are provided in each task prompt.
Do NOT emit `{"ac_complete": ...}` inside the final response JSON.
All code must be written in English (variable names, function names, comments, log messages).
Never include secrets in code, commits, or logs.