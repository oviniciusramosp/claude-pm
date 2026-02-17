# Product Manager Automation

A local automation system that manages a file-based Kanban board and executes tasks automatically through [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Write your tasks as Markdown files, and the orchestrator picks them up, sends them to Claude, tracks Acceptance Criteria in real time, and moves them to Done when complete.

## How It Works

```
Board/                          Orchestrator                    Claude Code
┌──────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
│ task.md       │────▶│ Pick next task           │────▶│ Execute instructions │
│ status: Not   │     │ Set status: In Progress  │     │ Emit AC completions  │
│ Started       │     │ Build prompt with ACs    │     │ Return final JSON    │
└──────────────┘     │ Stream output & track ACs│◀────│                      │
                     │ Verify all ACs complete  │     └──────────────────────┘
                     │ Set status: Done         │
                     └─────────────────────────┘
```

1. You write tasks as `.md` files with YAML frontmatter inside a `Board/` directory in your project.
2. The orchestrator picks the next task, sets its status to `In Progress`, and sends it to Claude Code.
3. Claude executes the instructions, emits per-Acceptance-Criteria completion markers, and returns a final JSON response.
4. The orchestrator verifies all ACs are complete, then moves the task to `Done`.
5. For Epics (groups of related tasks), children are executed sequentially. The Epic auto-completes when all children are done.

## Features

- **File-based Kanban board** — Tasks are plain Markdown files with YAML frontmatter. No external services required.
- **Automatic task execution** — The orchestrator picks tasks, runs Claude Code, and tracks progress.
- **Real-time AC tracking** — Acceptance Criteria checkboxes are updated in real time as Claude completes each one.
- **AC verification gate** — Tasks only move to Done when ALL Acceptance Criteria are checked.
- **Epic support** — Group related tasks into Epic folders. Children execute sequentially; the Epic auto-completes.
- **Auto-recovery** — When tasks fail, the system analyzes the error and retries with targeted fixes (up to 2 attempts).
- **Watchdog** — Monitors long-running tasks and kills stuck processes after configurable thresholds.
- **Visual control panel** — React-based web UI with real-time log streaming, Kanban board view, configuration wizard, and Claude chat.
- **Review with Claude** — One-click AI review of task descriptions. Claude Sonnet optimizes acceptance criteria, technical tasks, and tests following prompt engineering best practices. Includes undo and cancel support.
- **Auto-generate stories** — Generate up to 15 user stories from an Epic description. Claude reads the Epic, creates `.md` files with full ACs, technical tasks, tests, and dependencies.
- **Unsaved changes protection** — Create and edit modals guard against accidental data loss with confirmation dialogs. In-progress reviews are cancelled on close.
- **CLI slash commands** — `/project:review-task` and `/project:generate-stories` bring the same AI features to the Claude Code CLI, no panel required.
- **CLAUDE.md injection** — Automatically injects automation instructions into your target project's `CLAUDE.md`.
- **Model flexibility** — Specify different Claude models per task (Opus, Sonnet, Haiku) or override globally.
- **Git integration** — Panel includes commit history viewer and diff inspection.

## Requirements

- **Node.js 20+**
- **Claude Code CLI** — Install from [claude.ai/download](https://claude.ai/download) or via `npm install -g @anthropic-ai/claude-code`
- **Claude OAuth Token** — For non-interactive execution (see [Setup](#3-generate-a-claude-oauth-token))

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/product-manager-automation.git
cd product-manager-automation
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
# Required: OAuth token for non-interactive Claude execution
CLAUDE_CODE_OAUTH_TOKEN=your_token_here

# Required: Absolute path to the project where Claude will work
CLAUDE_WORKDIR=/path/to/your/project

# Recommended: Allow Claude to run without permission prompts
CLAUDE_FULL_ACCESS=true

# Recommended: See Claude's output in real time
CLAUDE_STREAM_OUTPUT=true
```

### 3. Generate a Claude OAuth Token

Claude Code needs a long-lived OAuth token to run non-interactively (without a human approving each action).

```bash
claude setup-token
```

This opens a browser flow. After completing it, you'll get a token. Paste it into your `.env` as `CLAUDE_CODE_OAUTH_TOKEN`.

Quick validation:

```bash
printf 'Return only ok' | claude --print
```

If it returns `ok`, your token is working.

### 4. Create a Board in your project

The `Board/` directory must be inside your target project (the directory set in `CLAUDE_WORKDIR`):

```bash
cd /path/to/your/project
mkdir -p Board
```

Then add task files (see [Writing Tasks](#writing-tasks) below).

### 5. Start the control panel

```bash
npm run panel
```

This builds the React panel and opens it at `http://localhost:4100`. From the panel you can:

- Configure all settings through a visual form
- Start/stop the automation API
- View the Kanban board with real-time AC progress
- Watch live log streaming
- Chat with Claude directly
- Inspect git commit history

Alternatively, start the automation API directly (without the panel):

```bash
npm start
```

## Writing Tasks

Tasks are Markdown files with YAML frontmatter. The orchestrator reads them from the `Board/` directory.

### Task File Format

Every task file must have YAML frontmatter with these fields:

```yaml
---
name: Human-readable task name        # Required
priority: P1                           # Required: P0, P1, P2, or P3
type: UserStory                        # Required: UserStory, Bug, Chore, or Epic
status: Not Started                    # Required: "Not Started", "In Progress", or "Done"
model: claude-sonnet-4-5-20250929      # Optional: override the Claude model for this task
agents: frontend, design               # Optional: agent hints
---
```

**Important:** The `status` field values must be exact: `"Not Started"`, `"In Progress"`, or `"Done"` (with capital letters and spaces).

### Acceptance Criteria

Acceptance Criteria **must** be defined as Markdown checkboxes. The orchestrator parses these, assigns numbers (AC-1, AC-2, etc.), and tracks completion:

```markdown
## Acceptance Criteria
- [ ] Login form renders with email and password fields
- [ ] Form validates email format
- [ ] Submit button is disabled when form is invalid
- [ ] Successful login redirects to dashboard
```

As Claude completes each AC, it emits a JSON marker and the checkbox is updated in real time:

```markdown
- [x] Login form renders with email and password fields  ← completed
- [x] Form validates email format                        ← completed
- [ ] Submit button is disabled when form is invalid     ← pending
- [ ] Successful login redirects to dashboard            ← pending
```

### Standalone Task Example

Place the file directly in `Board/`:

**File:** `Board/implement-login-page.md`

```markdown
---
name: Implement login page
priority: P1
type: UserStory
status: Not Started
model: claude-sonnet-4-5-20250929
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
- Login form renders correctly
- Email validation works
- Password validation works
- Submit button disabled state
- Error messages display correctly

## Standard Completion Criteria
- [ ] Tests written with 5+ test cases
- [ ] `npm test` runs with zero failures
- [ ] `npx tsc --noEmit` compiles without errors
- [ ] Commit: `feat(auth): implement login page`
```

### Epic (Group of Related Tasks)

An Epic is a folder inside `Board/` containing an `epic.md` file and child task files:

```
Board/
└── Epic-Auth/
    ├── epic.md              # Epic definition (required)
    ├── us-001-login.md      # Child task 1
    ├── us-002-signup.md     # Child task 2
    └── us-003-logout.md     # Child task 3
```

**Epic definition** (`epic.md`):

```markdown
---
name: Authentication System
priority: P0
type: Epic
status: Not Started
---

# Authentication System Epic

Build a complete authentication system with login, signup, and logout.

## Acceptance Criteria
- [ ] Users can log in with valid credentials
- [ ] Users can create new accounts
- [ ] Users can log out
- [ ] Authentication state persists across page refreshes
```

**Child task** (`us-001-login.md`):

```markdown
---
name: Implement Login Page
priority: P1
type: UserStory
status: Not Started
model: claude-sonnet-4-5-20250929
---

# Implement Login Page

**User Story**: As a user, I want to log in so that I can access my account.

## Acceptance Criteria
- [ ] Login form renders with email and password fields
- [ ] Form validates email format
- [ ] Successful login redirects to dashboard
- [ ] Failed login shows error message

## Standard Completion Criteria
- [ ] Tests written and passing
- [ ] TypeScript compiles without errors
- [ ] Commit: `feat(auth): implement login page [US-001]`
```

**Epic rules:**
- All files (epic and children) stay in the same folder — they never move on disk.
- Status changes happen by updating the `status` field in frontmatter.
- Children execute sequentially in alphabetical order.
- The Epic only moves to `Done` when ALL children have `status: Done`.

### Bug Fix Task

```markdown
---
name: Fix login redirect loop
priority: P0
type: Bug
status: Not Started
model: claude-opus-4-6
---

# Fix Login Redirect Loop

**Bug**: Users are stuck in an infinite redirect loop after logging in.

## Acceptance Criteria
- [ ] Users can log in without redirect loop
- [ ] Redirect logic only triggers once
- [ ] Unit test added to prevent regression

## Standard Completion Criteria
- [ ] Tests written and passing
- [ ] Commit: `fix(auth): resolve login redirect loop`
```

### Infrastructure/Chore Task

```markdown
---
name: Install Dependencies
priority: P0
type: Chore
status: Not Started
---

# Install Dependencies

## Acceptance Criteria
- [ ] All dependencies installed via `npm install`
- [ ] No peer dependency warnings
- [ ] `package.json` and `package-lock.json` are in sync

## Tests
N/A — infrastructure task, no business logic to test

## Standard Completion Criteria
- [ ] Commit: `chore(deps): install project dependencies`
```

### Naming Conventions

| Item | Convention | Examples |
|------|-----------|----------|
| Task files | kebab-case | `implement-login.md`, `fix-auth-bug.md` |
| Epic folders | PascalCase with prefix | `Epic-Auth`, `E01-Foundation` |
| Epic definition | Always `epic.md` | `Board/Epic-Auth/epic.md` |
| Child tasks | kebab-case | `us-001-login.md`, `bug-fix-redirect.md` |

### Task Priority

| Priority | Meaning |
|----------|---------|
| P0 | Critical — blocks everything else |
| P1 | High — should be done soon |
| P2 | Medium — normal priority |
| P3 | Low — nice to have |

### Task Ordering

Tasks are picked in the order configured by `QUEUE_ORDER`:

- `alphabetical` (default) — A to Z by filename
- `priority_then_alphabetical` — P0 first, then P1, etc., alphabetical within each priority

## Validating Your Board

The system validates your Board structure on startup and shows errors in the panel. You can also validate manually from the panel's Setup tab.

### Common Validation Errors

| Error | Fix |
|-------|-----|
| `Missing 'status' field` | Add `status: Not Started` to the YAML frontmatter |
| `Invalid status value: "not started"` | Use exact values: `"Not Started"`, `"In Progress"`, `"Done"` |
| `Board directory not found` | Create the `Board/` folder in your `CLAUDE_WORKDIR` |
| `Unexpected directory found` | Remove subdirectories or convert to an Epic with `epic.md` |
| `Epic folder missing epic.md` | Add an `epic.md` file to the Epic folder |

### Validating via Claude

You can ask Claude to validate and fix your board structure. Run this in your project directory:

```bash
claude "Read all .md files in the Board/ directory. For each file, verify:
1. YAML frontmatter exists with 'name', 'priority', 'type', and 'status' fields
2. Status is one of: 'Not Started', 'In Progress', 'Done' (exact match)
3. At least one Acceptance Criteria checkbox exists (- [ ] ...)
4. Epic folders contain an epic.md file
Report any issues and fix them."
```

## CLAUDE.md Injection

When `INJECT_CLAUDE_MD=true` (default), the automation injects a managed section into your target project's `CLAUDE.md` file. This section tells Claude how to:

- Track Acceptance Criteria completion with JSON markers
- Format its final response
- Handle the board structure

The managed section is delimited by `<!-- PRODUCT-MANAGER:START -->` and `<!-- PRODUCT-MANAGER:END -->` markers. It is updated on every API startup and will not overwrite any content outside these markers.

If your project already has a `CLAUDE.md`, the managed section is appended. If not, a new file is created.

## Control Panel

Start the panel with `npm run panel` and open `http://localhost:4100`.

### Tabs

| Tab | Description |
|-----|-------------|
| **Setup** | Configuration wizard with validation and help tooltips for all settings |
| **Feed** | Real-time streaming log viewer with color-coded entries by source (API, Claude, Chat). Includes Claude chat input. |
| **Board** | Kanban board with three columns (Not Started, In Progress, Done). Each card shows a donut chart with AC progress. Supports drag-and-drop, task creation, editing, and deletion. Includes "Review with Claude" in task modals and "Generate Stories" on Epic cards. |
| **Git** | Commit history viewer with diff inspection (when project is a git repo) |

### Sidebar Controls

- **Start/Stop** — Start or stop the automation API process
- **Run Queue** — Trigger manual reconciliation
- **Pause/Resume** — Pause or resume the orchestrator
- **Runtime Settings** — Toggle streaming, logging, and model override without restarting
- **Theme** — Light/dark mode toggle

## AI-Assisted Task Writing

The project provides two Claude-powered features for writing better tasks. They are available **both in the panel UI and as CLI slash commands**.

### Review with Claude

**Panel:** Inside both the **Create Task** and **Edit Task** modals, click "Review with Claude" to send the task content to Claude Sonnet for optimization. Claude improves acceptance criteria, technical tasks, tests, and overall structure following prompt engineering best practices.

- **Undo**: After a review, click "Undo Review" to revert to the original content.
- **Cancel**: If you close the modal while a review is running, the review is cancelled automatically.
- **Dirty-check**: If you have unsaved changes, closing the modal shows a confirmation dialog to prevent accidental data loss.

**CLI:** Run the slash command directly in Claude Code (no panel required):

```
/project:review-task Board/my-task.md
```

Claude reads the file, reviews it using the same criteria, shows a diff, and asks for confirmation before overwriting.

### Generate Stories from Epic

**Panel:** After creating an Epic with a description of the features you want, click the **"Generate"** button that appears next to the "+" button on Epic cards in the board.

Claude reads the Epic description and automatically creates up to 15 user story `.md` files, each with:
- Name and priority
- Acceptance criteria as checkboxes
- Technical tasks
- Test plan
- Dependencies
- Standard completion criteria

The generated stories appear as children of the Epic. Both manual ("+" button) and AI-generated story creation coexist.

**CLI:** Run the slash command directly in Claude Code (no panel required):

```
/project:generate-stories Board/Epic-Auth
```

Claude reads the `epic.md`, identifies existing children to avoid duplication, generates stories, shows a summary, and asks for confirmation before creating the files.

### Slash Commands Reference

These commands are available in any Claude Code session inside this project (via `.claude/commands/`):

| Command | Description |
|---------|-------------|
| `/project:review-task <path>` | Review and optimize a task `.md` file |
| `/project:generate-stories <epic>` | Generate user stories from an Epic description |

## Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run panel` | Build and start the visual control panel (port 4100) |
| `npm run panel:dev` | Panel in hot-reload development mode |
| `npm start` | Start automation API (port 3000) |
| `npm run dev` | Start automation API with file-watcher (for developing the automation engine itself) |
| `npm test` | Run tests |
| `npm run claude:chat` | Interactive Claude chat session |
| `npm run claude:manual -- "prompt"` | One-shot Claude prompt |
| `npm run setup:claude-md` | Regenerate CLAUDE.md playbook |

## Configuration Reference

All configuration is done via `.env`. Copy `.env.example` to `.env` and customize.

### Essential Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | **Required.** OAuth token from `claude setup-token` |
| `CLAUDE_WORKDIR` | `.` | **Required.** Absolute path to the project where Claude works. The `Board/` directory must be inside this path. |
| `CLAUDE_FULL_ACCESS` | `false` | Skip Claude permission prompts (adds `--dangerously-skip-permissions`) |
| `CLAUDE_STREAM_OUTPUT` | `false` | Stream Claude's output to logs in real time |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Automation API port |
| `PANEL_PORT` | `4100` | Panel UI port |
| `PANEL_AUTO_OPEN` | `true` | Auto-open browser when panel starts |
| `PANEL_AUTO_START_API` | `false` | Auto-start the automation API when panel starts |
| `PANEL_API_START_COMMAND` | `npm start` | Command used by panel to start the API |

### Board

| Variable | Default | Description |
|----------|---------|-------------|
| `BOARD_DIR` | `Board` | Path to Board directory (relative to `CLAUDE_WORKDIR` or absolute) |
| `BOARD_TYPE_EPIC` | `Epic` | Type value that identifies an Epic |

### Claude Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_TIMEOUT_MS` | `4500000` | Claude execution timeout (75 minutes) |
| `CLAUDE_LOG_PROMPT` | `true` | Log prompts sent to Claude |
| `CLAUDE_MODEL_OVERRIDE` | — | Override the model for all tasks. Valid: `claude-opus-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001` |
| `CLAUDE_EXTRA_PROMPT` | — | Additional text appended to every task prompt |
| `INJECT_CLAUDE_MD` | `true` | Inject managed automation section into target project's CLAUDE.md |
| `OPUS_REVIEW_ENABLED` | `false` | Review tasks completed by non-Opus models with Opus |
| `EPIC_REVIEW_ENABLED` | `false` | Review completed Epics with Opus |
| `FORCE_TEST_CREATION` | `false` | Require Claude to create tests for each task |
| `FORCE_TEST_RUN` | `false` | Require all tests to pass before task completion |
| `FORCE_COMMIT` | `false` | Require Claude to create a commit for each task |

### Queue

| Variable | Default | Description |
|----------|---------|-------------|
| `QUEUE_ORDER` | `alphabetical` | Task ordering: `alphabetical` or `priority_then_alphabetical` |
| `QUEUE_RUN_ON_STARTUP` | `true` | Run reconciliation on API boot |
| `QUEUE_POLL_INTERVAL_MS` | `60000` | Polling interval in ms (0 to disable) |
| `QUEUE_DEBOUNCE_MS` | `1500` | Reconciliation debounce |
| `MAX_TASKS_PER_RUN` | `50` | Max tasks per reconciliation cycle |
| `AUTO_RESET_FAILED_TASK` | `false` | Reset failed tasks back to Not Started |

### Watchdog

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCHDOG_ENABLED` | `true` | Enable watchdog timer |
| `WATCHDOG_INTERVAL_MS` | `1200000` | Check interval (20 minutes) |
| `WATCHDOG_MAX_WARNINGS` | `3` | Warnings before killing a task (3 = 60min) |
| `WATCHDOG_MAX_CONSECUTIVE_FAILURES` | `3` | Same-task failures before halting |
| `GLOBAL_MAX_CONSECUTIVE_FAILURES` | `5` | All-task failures before halting |

### Auto-Recovery

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_RECOVERY_ENABLED` | `true` | Attempt to fix and retry failed tasks |
| `AUTO_RECOVERY_MAX_RETRIES` | `2` | Max recovery attempts per task |
| `AUTO_RECOVERY_TIMEOUT_MS` | `300000` | Recovery timeout (5 minutes) |
| `AUTO_RECOVERY_MODEL` | `auto` | Model for recovery (`auto` uses Opus) |

### Other

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUAL_RUN_TOKEN` | — | Bearer token to protect `/run` and `/resume` endpoints |
| `RUN_STORE_PATH` | `.data/runs.json` | Path for execution history |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + orchestrator status |
| `POST` | `/run` | Trigger manual reconciliation |
| `POST` | `/run-task` | Run a single task by ID |
| `POST` | `/run-epic` | Run epic reconciliation |
| `POST` | `/pause` | Pause the orchestrator |
| `POST` | `/unpause` | Resume the orchestrator |
| `POST` | `/resume` | Resume from halted state |
| `GET` | `/settings/runtime` | Get runtime configuration |
| `POST` | `/settings/runtime` | Update runtime settings |
| `GET` | `/usage/weekly` | Get weekly API usage summary |
| `GET` | `/validate-board` | Validate board structure |
| `POST` | `/sync-claude-md` | Sync CLAUDE.md to target project |

The **panel server** (port 4100) also exposes these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/board/review-task` | Send task content to Claude for AI review and optimization |
| `POST` | `/api/board/generate-stories` | Generate user stories from an Epic description |

If `MANUAL_RUN_TOKEN` is set, protected endpoints require `Authorization: Bearer <token>`.

## Architecture

```
Product Manager/
├── src/                        # Automation engine (Node.js)
│   ├── index.js               # Express server + API endpoints
│   ├── orchestrator.js        # Queue logic, task lifecycle, reconciliation
│   ├── selectTask.js          # Task picking + epic detection
│   ├── claudeRunner.js        # Claude subprocess execution
│   ├── claudeMdManager.js     # CLAUDE.md injection into target project
│   ├── acParser.js            # Acceptance Criteria parsing + numbering
│   ├── promptBuilder.js       # Task prompt generation
│   ├── autoRecovery.js        # Auto-recovery orchestration
│   ├── boardValidator.js      # Board structure validation
│   ├── config.js              # Environment config parsing
│   ├── logger.js              # Colored console logging
│   ├── runStore.js            # Execution history (JSON store)
│   ├── usageStore.js          # API usage tracking
│   ├── watchdog.js            # Long-running task monitor
│   └── local/                 # Board file system integration
│       ├── client.js          # Board client (read/write .md files)
│       ├── frontmatter.js     # YAML frontmatter parser/serializer
│       └── helpers.js         # Utilities
├── panel/                      # Visual control panel (React + TypeScript)
│   └── src/
│       ├── app.tsx            # Main app component
│       └── components/        # UI components (board, feed, setup, git, modals, etc.)
├── scripts/
│   ├── panelServer.js         # Panel Express backend (SSE, process management)
│   ├── claudeManual.js        # CLI chat/manual prompt scripts
│   └── setupClaudeMd.js       # CLAUDE.md regeneration
├── .claude/commands/            # Claude Code slash commands
│   ├── review-task.md          # /project:review-task — AI task review
│   └── generate-stories.md    # /project:generate-stories — Epic story generation
├── .env.example                # Configuration template
└── CLAUDE.md                   # Automation playbook for Claude
```

### Key Components

- **Orchestrator** — Manages the task queue, picks the next task, runs Claude, tracks ACs, handles failures, and moves tasks through the board.
- **Claude Runner** — Spawns a Claude Code subprocess with the task prompt, streams output, and parses JSON responses.
- **AC Parser** — Extracts Acceptance Criteria checkboxes from Markdown, assigns stable numbers (AC-1, AC-2...), and updates checkboxes in real time.
- **Board Client** — Reads and writes `.md` files with YAML frontmatter. Handles standalone tasks and Epics.
- **Watchdog** — Periodically checks if a task is running too long and kills the process after configurable warnings.
- **Auto-Recovery** — When a task fails, analyzes the error with Claude and attempts targeted fixes before retrying.
- **Panel Server** — Serves the React UI, manages the API child process, streams logs via SSE, and proxies API endpoints.

## Troubleshooting

### Claude token not working

```bash
# Regenerate the token
claude setup-token

# Test it
printf 'Return only ok' | claude --print
```

### Board not found

Make sure `Board/` exists inside the directory specified by `CLAUDE_WORKDIR`:

```bash
ls /path/to/your/project/Board/
```

### Tasks not being picked up

1. Check that task files have valid YAML frontmatter with `status: Not Started`
2. Verify the orchestrator is not paused (check the panel sidebar)
3. Check logs in the Feed tab for errors

### Task stuck in "In Progress"

The watchdog will automatically kill tasks that run too long (default: 60 minutes at 3 warnings x 20 minute intervals). You can also:

1. Stop the API from the panel
2. Manually reset the task's `status` field back to `Not Started` in the `.md` file
3. Restart the API

### Panel won't start

```bash
# Kill any lingering processes
npm run panel:kill

# Retry
npm run panel
```

## Important Notes

- The service is designed to run as a single process. Do not run multiple instances pointing to the same Board directory.
- `npm run dev` uses `node --watch` which restarts when files change. Use `npm start` for stable mode when Claude is modifying files.
- Epic durations are calculated from timestamps stored in `.data/runs.json`.
- The orchestrator starts paused by default when launched from the panel. Click "Run Queue" or use the Start/Resume button to begin processing.
- When an Epic completes, the API auto-shuts down to prevent picking up unrelated tasks. Restart from the panel when ready.

## License

MIT
