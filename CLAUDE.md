# Claude Playbook: Product Manager Automation

## Project Purpose
This project automates a local file-based Kanban board and uses Claude Code to execute tasks.

Core flow:
1. Read tasks from the local `Board/` directory.
2. Move one task to `In Progress` when queue is empty.
3. Execute task instructions with Claude Code.
4. Move task to `Done` after successful execution.
5. Periodically reconcile the board to pick up new tasks.

## Board Structure
Tasks live as `.md` files with YAML frontmatter inside the `Board/` directory. Status is determined by which folder a file lives in.

**IMPORTANT**: The `Board/` directory MUST be located inside the `CLAUDE_WORKDIR` project directory (not in the Product Manager directory). This ensures Claude can read and update the same `.md` files that the orchestrator manages.

```
<CLAUDE_WORKDIR>/
└── Board/
    ├── Not Started/
    │   ├── my-standalone-task.md
    │   └── Epic-1/
    │       ├── epic.md
    │       ├── us-001-login.md
    │       └── us-002-signup.md
    ├── In Progress/
    └── Done/
```

### Task file format
```yaml
---
name: Implement login page
priority: P1
type: UserStory
model: claude-sonnet-4-5-20250929
agents: frontend, design
---
# Description

Acceptance criteria and instructions for Claude go here.
```

### Rules
- **Standalone task** = `.md` file directly in a status folder.
- **Epic** = subfolder containing `epic.md` + child `.md` files.
- **Moving a standalone task** = `fs.rename()` the file to the target status folder.
- **Moving an epic** = `fs.rename()` the entire folder.
- **Epic children status** = tracked via `status` field in frontmatter (children don't move on disk).
- **Task ID** = filename without extension (e.g. `my-standalone-task`, `Epic-1/us-001-login`).

## Task and Epic Format Guide

This section defines the complete format for creating tasks and epics that the automation system can understand.

### YAML Frontmatter Fields

All task files must start with YAML frontmatter between `---` delimiters.

#### Required Fields
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Human-readable task name | `"Implement login page"` |
| `priority` | string | Priority level | `"P0"`, `"P1"`, `"P2"`, `"P3"` |
| `type` | string | Task type | `"UserStory"`, `"Epic"`, `"Bug"`, `"Chore"` |

#### Optional Fields
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `model` | string | Claude model to use | `"claude-opus-4-6"`, `"claude-sonnet-4-5-20250929"` |
| `agents` | string or array | Agents to run | `"frontend, design"` or `["frontend", "design"]` |
| `status` | string | Epic child status only | `"Not Started"`, `"In Progress"`, `"Done"` |

**Important**:
- The `status` field is ONLY used for Epic children (to track their progress within an Epic).
- Standalone tasks DO NOT use the `status` field — their status is determined by which folder they're in.
- The `model` field is optional. If not specified, the default model from config is used.

### Acceptance Criteria Format

Acceptance Criteria MUST be defined as markdown checkboxes in the task body.

**Format**:
```markdown
## Acceptance Criteria
- [ ] First acceptance criterion
- [ ] Second acceptance criterion
- [ ] Third acceptance criterion
```

**Rules**:
1. Use exact format: `- [ ] ` (dash, space, open bracket, space, close bracket, space)
2. Each AC must be on its own line
3. The text after `- [ ] ` is the AC text that Claude will reference
4. When Claude completes an AC, the checkbox becomes `- [x]`
5. ACs can appear in multiple sections (e.g., "Acceptance Criteria", "Standard Completion Criteria")

**Example**:
```markdown
## Acceptance Criteria
- [ ] Login form renders with email and password fields
- [ ] Form validates email format
- [ ] Form validates password strength
- [ ] Submit button is disabled when form is invalid
- [ ] Error messages are displayed below each field

## Standard Completion Criteria
- [ ] Tests written with 5+ test cases
- [ ] `npm test` runs with zero failures
- [ ] `npx tsc --noEmit` compiles without errors
- [ ] Commit: `feat(auth): implement login page [US-001]`
```

### Standalone Task Format

A standalone task is a single `.md` file placed directly in a status folder.

**File location**: `Board/Not Started/my-task-name.md`

**Complete example**:
```markdown
---
name: Implement login page
priority: P1
type: UserStory
model: claude-sonnet-4-5-20250929
agents: frontend, design
---

# Implement Login Page

**User Story**: As a user, I want to log in with my email and password so that I can access my account.

## Acceptance Criteria
- [ ] Login form renders with email and password fields
- [ ] Form validates email format before submission
- [ ] Form validates password is not empty
- [ ] Submit button is disabled when form is invalid
- [ ] Error messages are displayed below each field when validation fails
- [ ] Successful login redirects to dashboard

## Technical Tasks
1. Create `src/pages/Login.tsx` component
2. Add form validation using React Hook Form
3. Create `useAuth` hook for authentication logic
4. Add error message display component
5. Implement redirect logic after successful login

## Tests
Component tests (React Testing Library):
- **File**: `__tests__/pages/Login.test.tsx`
- Login form renders correctly
- Email validation works
- Password validation works
- Submit button disabled state
- Error messages display correctly
- Successful login redirects to dashboard
- 10+ test cases

## Dependencies
- None

## Standard Completion Criteria
- [ ] Tests written as described above
- [ ] `npm test` runs with zero failures
- [ ] `npx tsc --noEmit` compiles without errors
- [ ] `npm run lint` passes
- [ ] Commit: `feat(auth): implement login page [US-001]`
```

### Epic Format

An Epic is a folder containing multiple related tasks. The folder must contain an `epic.md` file and child task files.

**File structure**:
```
Board/Not Started/Epic-Auth/
├── epic.md              # Epic definition
├── us-001-login.md      # Child task 1
├── us-002-signup.md     # Child task 2
└── us-003-logout.md     # Child task 3
```

**Epic file example** (`epic.md`):
```markdown
---
name: Authentication System
priority: P0
type: Epic
agents: frontend, backend
---

# Authentication System Epic

**Epic Goal**: Build a complete authentication system with login, signup, and logout functionality.

## Scope
This Epic includes:
- User login with email/password
- New user signup with validation
- User logout with session cleanup
- Persistent authentication state

## Acceptance Criteria
- [ ] Users can log in with valid credentials
- [ ] Users can create new accounts
- [ ] Users can log out
- [ ] Authentication state persists across page refreshes
- [ ] All auth flows have proper error handling

## Technical Approach
- Use JWT tokens for authentication
- Store tokens in httpOnly cookies
- Implement refresh token rotation
- Use React Context for auth state

## Dependencies
- None

## Child Tasks
See individual user story files in this Epic folder.
```

**Epic child task example** (`us-001-login.md`):
```markdown
---
name: Implement Login Page
priority: P1
type: UserStory
model: claude-sonnet-4-5-20250929
agents: frontend
status: Not Started
---

# Implement Login Page

**User Story**: As a user, I want to log in with my email and password so that I can access my account.

## Acceptance Criteria
- [ ] Login form renders with email and password fields
- [ ] Form validates email format before submission
- [ ] Successful login redirects to dashboard
- [ ] Failed login shows error message

## Technical Tasks
1. Create login page component
2. Implement form validation
3. Connect to authentication API
4. Handle success/error states

## Tests
- Login form renders correctly
- Form validation works
- API integration works
- Error handling works

## Dependencies
- API authentication endpoint must exist

## Standard Completion Criteria
- [ ] Tests written and passing
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Commit: `feat(auth): implement login page [US-001]`
```

**Important Epic Rules**:
1. Epic children MUST have a `status` field in frontmatter (standalone tasks must NOT)
2. Epic children do NOT move between folders — they stay in the Epic folder
3. The Epic folder itself moves between status folders
4. Child `status` values: `"Not Started"`, `"In Progress"`, `"Done"`
5. The Epic is only moved to Done when ALL children have `status: Done`

### Naming Conventions

**Task file naming**:
- Use kebab-case: `my-task-name.md`
- Be descriptive but concise
- Avoid special characters except hyphens
- Good: `implement-login-page.md`, `fix-auth-bug.md`
- Bad: `task1.md`, `login page.md`, `implement_login.md`

**Epic folder naming**:
- Use PascalCase or kebab-case with prefix: `Epic-Auth`, `E01-Project-Foundation`
- Include a clear identifier: `Epic-`, `E01-`, etc.
- Good: `Epic-Auth`, `E01-Foundation`, `Epic-Payment-System`
- Bad: `auth`, `epic`, `Epic1`

**Epic file naming**:
- Main file MUST be named `epic.md`
- Child files can use any kebab-case naming
- Common pattern: `us-001-description.md`, `bug-fix-login.md`

### Task ID Resolution

The system generates Task IDs automatically from file paths:

**Standalone task**:
- File: `Board/Not Started/implement-login.md`
- Task ID: `implement-login`

**Epic**:
- File: `Board/Not Started/Epic-Auth/epic.md`
- Task ID: `Epic-Auth`

**Epic child**:
- File: `Board/Not Started/Epic-Auth/us-001-login.md`
- Task ID: `Epic-Auth/us-001-login`

The Task ID is used in logs, run history, and Execution Notes.

### Common Patterns

**Infrastructure task** (no business logic, no tests):
```markdown
---
name: Install Dependencies
priority: P0
type: Chore
agents: devops
---

# Install Dependencies

Install all required npm packages for the project.

## Acceptance Criteria
- [ ] All dependencies installed via `npm install`
- [ ] No peer dependency warnings
- [ ] `package.json` and `package-lock.json` are in sync

## Technical Tasks
1. Run `npm install`
2. Verify no warnings or errors
3. Commit lockfile changes

## Tests
N/A — infrastructure task, no business logic to test

## Standard Completion Criteria
- [ ] Tests: N/A
- [ ] `npx tsc --noEmit` compiles without errors
- [ ] Commit: `chore(deps): install project dependencies`
```

**Bug fix task**:
```markdown
---
name: Fix login redirect loop
priority: P0
type: Bug
model: claude-opus-4-6
agents: frontend, debugging
---

# Fix Login Redirect Loop

**Bug**: Users are stuck in an infinite redirect loop after logging in.

## Acceptance Criteria
- [ ] Users can log in without redirect loop
- [ ] Redirect logic only triggers once
- [ ] Unit test added to prevent regression

## Technical Tasks
1. Identify root cause of redirect loop
2. Fix the redirect logic in authentication flow
3. Add unit test to prevent regression
4. Verify fix in development environment

## Tests
- Add test case: "login redirect should only happen once"
- Verify existing login tests still pass

## Standard Completion Criteria
- [ ] Tests written and passing
- [ ] Bug verified fixed in development
- [ ] Commit: `fix(auth): resolve login redirect loop [BUG-042]`
```

### Validation Checklist

Before creating a task file, verify:
- ✅ YAML frontmatter is valid and includes required fields (`name`, `priority`, `type`)
- ✅ Acceptance Criteria are formatted as markdown checkboxes (`- [ ] ...`)
- ✅ File naming follows conventions (kebab-case for tasks, epic.md for epics)
- ✅ For Epic children: `status` field is present in frontmatter
- ✅ For standalone tasks: NO `status` field in frontmatter
- ✅ Task ID would be unique (no duplicate filenames)
- ✅ Markdown content is clear and actionable for Claude

## Your Role (as Claude)
You are the setup and operations assistant for this repository.

You should:
- Help maintain and evolve the codebase.
- Assist with troubleshooting configuration or runtime issues.
- Never expose or commit secrets.

## Visual Control Panel
The project includes a web-based control panel for setup, monitoring, and operations.

### Starting the Panel
```bash
npm run panel
```
This builds the React panel, starts the panel server on port 4100, and auto-opens the browser.

For development with hot-reload:
```bash
npm run panel:dev
```

### Panel API Start Command
When the panel starts the automation API (via the Start button or auto-start), it defaults to `npm start` (stable mode, no file watcher). This prevents `node --watch` from restarting the API when Claude modifies files during task execution, which would kill the running Claude subprocess. To override, set `PANEL_API_START_COMMAND` in `.env`.

### Panel Features
- **Sidebar Navigation** - Persistent left sidebar with page navigation, process controls (start/stop API, run queue, status badges), runtime settings access, and theme toggle.
- **Setup Page** - Form-based configuration wizard with validation and help tooltips for all `.env` values (Claude token, working directory, runtime toggles).
- **Feed Page** - Real-time streaming of all logs via SSE, color-coded by level and source (Panel, API, Claude, Chat), plus Claude chat input. AC completions appear as success messages in real time.
- **Board Page** - Kanban board with three columns (Not Started, In Progress, Done). Each task card shows a **donut chart** indicating Acceptance Criteria progress (completed/total). The board polls every 30s and refreshes on SSE events.
- **Theme Toggle** - Light/dark mode with OS preference detection (in sidebar footer).

### Panel Architecture
- **Frontend**: React + Tailwind CSS + Base UI components, built with Vite (`panel/src/`).
- **Backend**: Express server (`scripts/panelServer.js`) on port 4100 that manages child processes, streams logs via SSE, and proxies config/process/chat APIs.

## First-Time Setup
Setup is done through the visual panel at `http://localhost:4100`.

The Setup tab guides the user through configuring:
1. **Claude OAuth Token** - Obtained via `/opt/homebrew/bin/claude setup-token`.
2. **Claude Working Directory** - Where Claude executes tasks (supports native folder picker).
3. **Runtime Toggles** - Full Access, Stream Output, Log Prompt.

After saving, the panel can restart the API service automatically.

### Board Setup
Create your `Board/` directory **inside the target project directory** (CLAUDE_WORKDIR) with the three status folders:
```bash
cd <CLAUDE_WORKDIR>
mkdir -p Board/Not\ Started Board/In\ Progress Board/Done
```
Then add `.md` files with YAML frontmatter to `Board/Not Started/` to create tasks.

**Why this matters**: Claude executes tasks in the project directory and updates the task `.md` files there. The orchestrator must read/write the same files to see AC completions and progress updates in real time.

### Validation
From the Operations tab:
- Start the API process and verify it shows a green status.
- Check the Live Log Feed for startup messages.
- Click "Run" to trigger a manual reconciliation.
- Verify logs show task movement and Claude execution.

## Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run panel` | Build and start the visual control panel (port 4100) |
| `npm run panel:dev` | Panel in hot-reload development mode |
| `npm run dev` | Start automation API in watch mode (port 3000) |
| `npm start` | Start automation API normally |
| `npm run claude:chat` | Interactive Claude chat session (CLI) |
| `npm run claude:manual -- "<prompt>"` | One-shot Claude prompt (CLI) |
| `npm run setup:claude-md` | Regenerate this CLAUDE.md playbook |

## Configuration Reference

### Optional `.env` Values
- `BOARD_DIR` - Path to the Board directory, **resolved relative to `CLAUDE_WORKDIR`** (default `Board`). Can be absolute or relative. If relative, it's resolved from the project directory, not the Product Manager directory.
- `BOARD_STATUS_NOT_STARTED` - Folder name for "Not Started" status (default `Not Started`).
- `BOARD_STATUS_IN_PROGRESS` - Folder name for "In Progress" status (default `In Progress`).
- `BOARD_STATUS_DONE` - Folder name for "Done" status (default `Done`).
- `BOARD_TYPE_EPIC` - Type value that represents an Epic (default `Epic`).
- `CLAUDE_CODE_OAUTH_TOKEN` - For non-interactive Claude auth.
- `CLAUDE_WORKDIR` - Working directory for Claude execution (default `.`). The `Board/` directory must be inside this directory.
- `CLAUDE_FULL_ACCESS` - Skip Claude permission prompts (default `false`).
- `CLAUDE_STREAM_OUTPUT` - Stream Claude output to logs (default `false`).
- `CLAUDE_LOG_PROMPT` - Log prompts sent to Claude (default `true`).
- `OPUS_REVIEW_ENABLED` - When true, tasks completed by non-Opus models are reviewed by Opus before moving to Done (default `false`).
- `EPIC_REVIEW_ENABLED` - When true, completed Epics are reviewed by Opus (runs tests + full review) before moving to Done (default `false`).
- `FORCE_TEST_CREATION` - When true, Claude must create automated tests for each task when applicable (default `false`).
- `FORCE_TEST_RUN` - When true, Claude must run all tests and ensure they pass before finishing a task (default `false`).
- `FORCE_COMMIT` - When true, Claude must create a commit before moving the task to Done (default `false`).
- `INJECT_CLAUDE_MD` - When true, injects a managed section into the target project's CLAUDE.md with automation instructions (default `true`).
- `CLAUDE_TIMEOUT_MS` - Claude execution timeout (default `4500000` = 75min). Should be higher than `WATCHDOG_INTERVAL_MS * WATCHDOG_MAX_WARNINGS`.
- `CLAUDE_EXTRA_PROMPT` - Additional prompt text appended to every task.
- `PORT` - Automation API port (default `3000`).
- `PANEL_PORT` - Panel server port (default `4100`).
- `PANEL_AUTO_OPEN` - Auto-open browser on panel start (default `true`).
- `PANEL_AUTO_START_API` - Auto-start API when panel starts (default `false`).
- `PANEL_API_START_COMMAND` - Command to start the API from the panel (default `npm start`). Use `npm run dev` only for local development of the automation engine itself.
- `QUEUE_DEBOUNCE_MS` - Reconciliation debounce (default `1500`).
- `QUEUE_ORDER` - Task ordering: `alphabetical` (default, A→Z by name) or `priority_then_alphabetical`.
- `QUEUE_RUN_ON_STARTUP` - Run reconciliation on boot (default `true`).
- `QUEUE_POLL_INTERVAL_MS` - Fallback polling interval (default `60000`).
- `MAX_TASKS_PER_RUN` - Max tasks per reconciliation cycle (default `50`).
- `AUTO_RESET_FAILED_TASK` - Reset failed tasks to Not Started (default `false`).
- `MANUAL_RUN_TOKEN` - Auth token for the `/run` and `/resume` endpoints.
- `WATCHDOG_ENABLED` - Enable watchdog timer for long-running tasks (default `true`).
- `WATCHDOG_INTERVAL_MS` - Watchdog check interval (default `1200000` = 20min).
- `WATCHDOG_MAX_WARNINGS` - Warnings before killing a task process (default `3`).
- `WATCHDOG_MAX_CONSECUTIVE_FAILURES` - Same-task failures before halting the orchestrator (default `3`).
- `GLOBAL_MAX_CONSECUTIVE_FAILURES` - Consecutive failures across all tasks before halting (default `5`). Catches systemic issues like broken auth or CLI.

## Code Standards
- **All code must be written in English.** This includes variable names, function names, class names, comments, log messages, error messages, JSDoc annotations, and any other code artifacts. The only exception is user-facing UI text that is explicitly requested in another language.
- Commit messages must also be written in English.

## Versioning & Commits
This project follows [Semantic Versioning](https://semver.org/) (SemVer) and [Conventional Commits](https://www.conventionalcommits.org/).

### Semantic Versioning
The version in `package.json` must be updated on every commit following SemVer rules:
- **MAJOR** (X.0.0) - Breaking changes to APIs, config format, or database schema.
- **MINOR** (0.X.0) - New features, new endpoints, new panel tabs, new config options.
- **PATCH** (0.0.X) - Bug fixes, performance improvements, refactoring, documentation updates, dependency bumps.

Before committing, bump the version in `package.json` accordingly using `npm version patch|minor|major --no-git-tag-version`.

### Conventional Commits
Every commit message must follow the Conventional Commits format:

```
<type>(<scope>): <short description>

<optional body with details of what changed and why>
```

**Types:**
- `feat` - New feature (bumps MINOR).
- `fix` - Bug fix (bumps PATCH).
- `refactor` - Code restructuring without behavior change (bumps PATCH).
- `docs` - Documentation only (bumps PATCH).
- `style` - Formatting, whitespace, missing semicolons (bumps PATCH).
- `perf` - Performance improvement (bumps PATCH).
- `test` - Adding or updating tests (bumps PATCH).
- `chore` - Build process, dependencies, tooling (bumps PATCH).
- `ci` - CI/CD configuration (bumps PATCH).
- `build` - Build system or external dependencies (bumps PATCH).

**Scopes** (use the most relevant):
- `panel` - Visual control panel (React frontend).
- `api` - Automation API / Express server.
- `orchestrator` - Queue logic and reconciliation.
- `board` - Local file-based board integration.
- `claude` - Claude runner and prompt builder.
- `config` - Configuration and environment.
- `scripts` - CLI scripts and panel server.

**Examples:**
```
feat(panel): add real-time task progress indicator
fix(orchestrator): prevent duplicate task execution on rapid triggers
refactor(board): extract frontmatter parser to separate module
chore: bump dependencies to latest versions
```

### Commit Workflow — Commit After Every Change
**CRITICAL**: You MUST create a commit after every meaningful change. Do NOT batch multiple changes into a single commit. Each logical change gets its own commit immediately after it is completed.

**What counts as a "change":**
- Adding, modifying, or deleting a feature, component, endpoint, or module.
- Fixing a bug.
- Refactoring code (even small refactors).
- Updating configuration or documentation.
- Adding or modifying tests.

**Step-by-step for each commit:**
1. Stage only the relevant files for this specific change (never use `git add -A` blindly).
2. Bump the version in `package.json` with the appropriate level (`patch`, `minor`, or `major`) using `npm version <level> --no-git-tag-version`.
3. Include the version bump in the same commit.
4. Write a commit message with **both title AND description body**:
   - **Title**: concise conventional commit format (`type(scope): short description`), max ~72 chars.
   - **Body**: explain **what** changed, **why** it changed, and any notable details. The body is mandatory — never commit with only a title.
5. If you made multiple unrelated changes before committing, split them into separate commits — one per logical change.

**Commit message format:**
```
type(scope): short description of the change

Detailed explanation of what was changed and why. Include:
- What files/modules were affected
- The motivation or context for the change
- Any trade-offs or decisions made
- Breaking changes (if any)
```

**Example:**
```
feat(panel): add weekly usage chart widget

Add a new WeeklyUsageWidget component that displays a bar chart of
Claude API usage over the past 7 days. The chart uses the usageStore
data and renders inside the sidebar. Chose a simple SVG-based chart
to avoid adding a charting library dependency.
```

**Anti-patterns (do NOT do these):**
- Committing with only a title and no body.
- Batching 3+ unrelated changes into one commit.
- Forgetting to bump the version before committing.
- Using vague messages like "update code" or "fix stuff".

## Proactive Knowledge Base Recording
Claude MUST proactively record important changes and decisions in the project's knowledge base after every significant action. This ensures continuity across sessions and prevents knowledge loss.

### What to Record
Record any of the following **immediately** after they happen — do not wait until the end of a session:

| Category | Examples | When to record |
|----------|----------|----------------|
| **Architectural decisions** | Chose SVG charts over Chart.js to avoid dependencies; switched from polling to SSE | After making the decision |
| **New modules/files** | Created `src/acParser.js` for AC parsing logic | After creating the file |
| **API/config changes** | Added `WATCHDOG_ENABLED` env var; changed default port | After the change is committed |
| **Bug root causes** | Redirect loop caused by missing `return` after `res.redirect()` | After fixing the bug |
| **Refactoring rationale** | Extracted frontmatter parser because 3 modules duplicated the logic | After the refactor |
| **Breaking changes** | Changed task file format from JSON to YAML frontmatter | Immediately — high priority |
| **Integration notes** | Panel SSE requires `Content-Type: text/event-stream` header | When discovered |
| **Session progress** | Completed 3 of 5 epic children; remaining: us-004, us-005 | At end of session or at milestones |

### How to Record
Use the `spawner_remember` tool with the appropriate update type:

1. **Decisions** — use `decision` with `what` and `why`:
   ```
   spawner_remember({ update: { decision: { what: "Use SVG for charts", why: "Avoid adding Chart.js dependency for a single widget" } } })
   ```

2. **Issues** — use `issue` with `description` and `status`:
   ```
   spawner_remember({ update: { issue: { description: "Panel SSE disconnects after 60s idle", status: "open" } } })
   ```

3. **Session summaries** — use `session_summary` at the end of each work session or after completing a major milestone:
   ```
   spawner_remember({ update: { session_summary: "Implemented git-tab with commit history, diff viewer, and branch display. Added CommitDetailModal for viewing full commit details. Version bumped to 0.15.0." } })
   ```

### Rules
- **Be proactive**: Do not wait for the user to ask you to record something. If you made an important change, record it.
- **Record immediately**: Log decisions and changes right after they happen, not at the end of the session.
- **Be specific**: Include file names, config keys, and concrete details — not vague summaries.
- **Record session progress**: At the end of every session (or when context is getting long), write a session summary listing what was accomplished and what remains.
- **Record blockers**: If something is blocked or failed, record it as an open issue so the next session knows.

## Safety Rules
- Never write real secrets into `.env.example`, `README.md`, or code.
- Never print full secret values in terminal summaries.
- Store secrets only in `.env`.
- If user shares secrets in chat, avoid repeating them verbatim.

## Operational Rules During Task Execution
- Always use the task ID as reference in outputs.
- Keep task updates concise.
- If Claude returns blocked/error, explain next action clearly.
- If quota/limit is reached, report reset time and pause processing.

## Acceptance Criteria Tracking
The system tracks Acceptance Criteria (ACs) defined as markdown checkboxes (`- [ ] ...`) in task files.

### Numbered AC System
ACs are parsed from task markdown at prompt-build time and assigned stable 1-based indices (AC-1, AC-2, etc.). A **numbered reference table** is included in every task prompt so Claude can reference ACs by number instead of reproducing exact text. This eliminates text-matching failures.

**Tracking format:**
- Per-AC (during execution): `{"ac_complete": 3}` — standalone JSON on its own line
- Final JSON: `{"status": "done", "summary": "...", ...}` — task completion (no `completed_acs` field)

Each AC completion is a proper JSON event that the orchestrator parses and applies immediately.

### Per-AC JSON Updates
When `CLAUDE_STREAM_OUTPUT=true`, Claude emits `{"ac_complete": <number>}` JSON markers as it completes each AC. The orchestrator detects these markers in real time and:
1. Parses the JSON and extracts the AC number.
2. Maps the AC number to the corresponding checkbox position in the markdown file.
3. Updates the task `.md` file immediately (checkbox `- [ ]` becomes `- [x]`).
4. Logs `AC completed: AC-<number>` to the Live Feed.
5. The board donut chart updates on the next poll cycle.

If Claude fails mid-task, ACs already completed remain checked — progress is never lost.

As a fallback, the orchestrator also scans the entire stdout post-execution to collect any per-AC JSONs that may have been missed during streaming, and applies them before verification.

### AC Verification Gate
After Claude finishes a task and per-AC completions are applied, the orchestrator re-reads the task markdown and counts any remaining unchecked ACs (`- [ ]`). If any unchecked ACs remain, the task is **not moved to Done** — it stays in In Progress and is recorded as failed. This prevents tasks from being marked complete when Claude misses acceptance criteria.

### Epic AC Verification
Before closing an Epic (moving it to Done), the orchestrator reads each child task's markdown and verifies all ACs are checked. If any child has unchecked ACs, the Epic is blocked from closing and the offending children are logged. This runs before the optional Epic review step.

### CLAUDE.md Injection
When `INJECT_CLAUDE_MD=true` (default), the automation injects a managed section into the **target project's** `CLAUDE.md` (at `CLAUDE_WORKDIR/CLAUDE.md`). This section contains per-AC JSON tracking instructions, the final JSON response format, and general rules. The managed section is delimited by `<!-- PRODUCT-MANAGER:START -->` and `<!-- PRODUCT-MANAGER:END -->` markers and is updated on every API startup. When injection is active, the task prompt skips these instructions to avoid duplication.

### Board Donut Chart
Each task card on the Board page displays a donut chart showing `done/total` ACs. The counts come from parsing `- [ ]` (unchecked) and `- [x]` (checked) lines in the task markdown body. The chart turns green when all ACs are complete.

### Epic Auto-Shutdown
When the orchestrator finishes processing an epic (all children done, epic moved to Done), the automation API process exits automatically after a short delay. This prevents the orchestrator from picking up unrelated standalone tasks after an epic is completed. The panel will show the API as stopped; the user can restart it manually or let auto-start handle the next run.

### Task Code Labels
Log messages use structured task codes derived from file names:
- Epic children: `S1.2 - Task Name` (from filename pattern `s1-2-...`)
- Epics: `E1 - Epic Name` (from folder pattern `E01-...`)
- Other tasks: just the task name

This makes logs easier to scan when many tasks are processed.

## Logging Expectations
Logs are streamed to the panel's Live Log Feed in real time. They are color-coded by level and tagged by source.

Prefer concise, human-readable lines such as:
- `INFO - Moved to In Progress: "S1.1 - Task Name"`
- `SUCCESS - Moved to Done: "S1.1 - Task Name"`
- `SUCCESS - AC completed: AC-3`

## Project Structure
```
Product Manager/
├── Board/                  # Local file-based task board
│   ├── Not Started/        # Tasks waiting to be picked up
│   ├── In Progress/        # Tasks currently being worked on
│   └── Done/               # Completed tasks
├── src/                    # Automation engine
│   ├── index.js            # Express server & endpoints
│   ├── orchestrator.js     # Queue logic & reconciliation
│   ├── selectTask.js       # Task picking & epic detection
│   ├── claudeRunner.js     # Claude subprocess execution
│   ├── claudeMdManager.js  # Managed CLAUDE.md injection into target project
│   ├── acParser.js         # AC parsing, numbering, and reference resolution
│   ├── promptBuilder.js    # Prompt generation
│   ├── config.js           # Environment config parsing
│   ├── logger.js           # Colored console output
│   ├── runStore.js         # Run history (JSON store)
│   ├── watchdog.js         # Long-running task monitor
│   └── local/              # Local board integration
│       ├── client.js       # Board client (read/write tasks)
│       ├── frontmatter.js  # YAML frontmatter parser/serializer
│       └── helpers.js      # Slug/title utilities
├── panel/                  # Visual control panel (React + TypeScript)
│   ├── vite.config.mjs     # Vite build config
│   ├── index.html          # HTML entry point
│   └── src/
│       ├── main.tsx         # React root
│       ├── app.tsx          # App component (state + layout)
│       ├── types.ts         # TypeScript interfaces
│       ├── constants.ts     # Constants and metadata
│       ├── theme.css        # Tailwind + design tokens
│       ├── components/      # UI component library
│       │   ├── base/        # Primitives (button, input, toggle, badge, tooltip)
│       │   ├── application/ # Tabs, modals
│       │   ├── foundations/ # Design tokens
│       │   ├── icon.tsx              # Icon wrapper
│       │   ├── connection-dot.tsx    # Animated connection indicator
│       │   ├── status-badge.tsx      # Status badge with dot
│       │   ├── source-avatar.tsx     # Log source avatar
│       │   ├── toast-notification.tsx # Toast component
│       │   ├── sidebar-nav.tsx       # Sidebar navigation + process controls
│       │   ├── setup-tab.tsx         # Setup configuration form
│       │   ├── feed-tab.tsx          # Live feed + Claude chat
│       │   ├── save-confirm-modal.tsx    # Save confirmation dialog
│       │   └── runtime-settings-modal.tsx # Runtime settings dialog
│       ├── utils/
│       │   ├── cx.ts              # Tailwind class merge utility
│       │   ├── config-helpers.ts  # Config/env helpers
│       │   └── log-helpers.ts     # Log formatting helpers
│       └── styles/
│           ├── globals.css
│           ├── theme.css
│           └── typography.css
├── scripts/
│   ├── panelServer.js      # Panel Express backend
│   ├── claudeManual.js     # CLI chat/manual scripts
│   └── setupClaudeMd.js    # CLAUDE.md generator
├── .env                    # Runtime config (not committed)
├── .env.example            # Template
└── .data/runs.json         # Execution history (generated)
```

## Rules for Sonnet-Driven Execution

When Claude Sonnet (or any non-Opus model) is executing a multi-step plan, it MUST follow these rules strictly. These exist because Sonnet has a tendency to skip steps, leave dangling references, and not validate its own work.

### 1. Never skip steps
- Execute **every** step in the plan, in order. No step is optional unless explicitly marked as such.
- If a step is too large, break it into sub-steps — but never skip it entirely.
- After finishing all steps, re-read the plan and confirm each step was completed. List any that were not and execute them.

### 2. Verify imports after every file extraction
- When moving code from file A to file B, **always** check what symbols file A still uses after the move.
- For every symbol that was previously defined inline or imported in file A and is now only in file B, add the appropriate import to file A.
- Conversely, ensure file B imports everything it needs (icons, utilities, types, components).
- **Concrete check**: after editing, search the file for any identifier that is used but not imported. Use grep or a quick scan of every JSX tag, function call, and variable reference against the import block at the top.

### 3. Run build AND open the app after every major step
- `npm run panel:build` only catches compile-time errors (syntax, missing modules). It does **not** catch runtime errors like `ReferenceError: X is not defined`.
- After completing each step that modifies imports or moves code, you MUST:
  1. Run `npm run panel:build` — verify zero errors.
  2. Briefly inspect the built output or mentally trace that all runtime references resolve.
- If the plan says "validate build after each step", treat it as "validate build **and** verify no missing runtime references."

### 4. Do not leave unused imports
- After extracting code, remove imports in the source file that are no longer used there.
- Do not leave `import { Foo } from '...'` if `Foo` no longer appears anywhere in that file.

### 5. Cross-check the final file structure against the plan
- At the end of execution, list all files that were supposed to be created (per the plan) and verify each one exists.
- For each file, confirm it exports the expected symbols.
- Confirm the main entry file (`app.tsx`) imports from all new files correctly.

### 6. When in doubt, re-read the source
- Before editing a file, always read its current content first. Never assume you know what the file contains.
- After writing a file, re-read it to confirm the write was correct.

### 7. Do not silently drop parts of the plan
- If you cannot complete a step, say so explicitly and explain why.
- Never move to the next step without either completing the current one or flagging it as blocked.

### Common Sonnet failure patterns to avoid
| Failure | What happens | How to prevent |
|---------|-------------|----------------|
| Missing import after extraction | `ReferenceError: X is not defined` at runtime | Rule 2: scan for dangling references |
| Skipped extraction step | File stays monolithic, plan incomplete | Rule 1: execute every step, verify at end |
| Build passes but app crashes | Vite tree-shakes unused imports, hiding errors | Rule 3: trace runtime references manually |
| Orphan imports left behind | Unused imports bloat the file | Rule 4: clean up after every extraction |

## If Something Is Missing
If required setup data is missing, ask directly and continue only after confirmation.
Do not guess secrets or IDs.
