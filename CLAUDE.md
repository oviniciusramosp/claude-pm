# Claude Playbook: Product Manager Automation

## Project Purpose
This project automates a Notion Kanban workflow and uses Claude Code to execute tasks.

Core flow:
1. Read tasks from Notion database.
2. Move one task to `In Progress` when queue is empty.
3. Execute task instructions with Claude Code.
4. Move task to `Done` after successful execution.
5. Periodically reconcile the board to pick up new tasks.

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

### Panel Features
- **Sidebar Navigation** - Persistent left sidebar with page navigation, process controls (start/stop API, run queue, status badges), runtime settings access, and theme toggle.
- **Setup Page** - Form-based configuration wizard with validation and help tooltips for all `.env` values (Notion token, database ID, Claude token, working directory, runtime toggles).
- **Feed Page** - Real-time streaming of all logs via SSE, color-coded by level and source (Panel, API, Claude, Chat), plus Claude chat input.
- **Theme Toggle** - Light/dark mode with OS preference detection (in sidebar footer).

### Panel Architecture
- **Frontend**: React + Tailwind CSS + Base UI components, built with Vite (`panel/src/`).
- **Backend**: Express server (`scripts/panelServer.js`) on port 4100 that manages child processes, streams logs via SSE, and proxies config/process/chat APIs.

## First-Time Setup
Setup is done through the visual panel at `http://localhost:4100`.

The Setup tab guides the user through configuring:
1. **Notion API Token** - Integration token from Notion.
2. **Notion Database ID** - ID of the Kanban database.
3. **Claude OAuth Token** - Obtained via `/opt/homebrew/bin/claude setup-token`.
4. **Claude Working Directory** - Where Claude executes tasks (supports native folder picker).
5. **Runtime Toggles** - Full Access, Stream Output, Log Prompt.

After saving, the panel can restart the API service automatically.

### Notion Database Schema
If creating a new database, ensure this schema:
- `Name` (title)
- `Status` (status): `Not started`, `In progress`, `Done`
- `Agent` (multi-select)
- `Priority` (select): `P0`, `P1`, `P2`, `P3`
- `Type` (select): `Epic`, `UserStory`, `Defect`, `Discovery`
- `Model` (select): Claude model to use for the task (e.g. `claude-sonnet-4-5-20250929`, `claude-opus-4-6`). If empty, Claude CLI uses its default model.
- Sub-items feature enabled (so `Parent item` relation is available)

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

### Required `.env` Values
- `NOTION_API_TOKEN` - Notion integration token.
- `NOTION_DATABASE_ID` - Target Kanban database.

### Optional `.env` Values
- `CLAUDE_CODE_OAUTH_TOKEN` - For non-interactive Claude auth.
- `CLAUDE_WORKDIR` - Working directory for Claude execution (default `.`).
- `CLAUDE_FULL_ACCESS` - Skip Claude permission prompts (default `false`).
- `CLAUDE_STREAM_OUTPUT` - Stream Claude output to logs (default `false`).
- `CLAUDE_LOG_PROMPT` - Log prompts sent to Claude (default `true`).
- `OPUS_REVIEW_ENABLED` - When true, tasks completed by non-Opus models are reviewed by Opus before moving to Done (default `false`).
- `EPIC_REVIEW_ENABLED` - When true, completed Epics are reviewed by Opus (runs tests + full review) before moving to Done (default `false`).
- `FORCE_TEST_CREATION` - When true, Claude must create automated tests for each task when applicable (default `false`).
- `FORCE_TEST_RUN` - When true, Claude must run all tests and ensure they pass before finishing a task (default `false`).
- `FORCE_COMMIT` - When true, Claude must create a commit before moving the task to Done (default `false`).
- `CLAUDE_TIMEOUT_MS` - Claude execution timeout (default `4500000` = 75min). Should be higher than `WATCHDOG_INTERVAL_MS * WATCHDOG_MAX_WARNINGS`.
- `CLAUDE_EXTRA_PROMPT` - Additional prompt text appended to every task.
- `PORT` - Automation API port (default `3000`).
- `PANEL_PORT` - Panel server port (default `4100`).
- `PANEL_AUTO_OPEN` - Auto-open browser on panel start (default `true`).
- `PANEL_AUTO_START_API` - Auto-start API when panel starts (default `false`).
- `QUEUE_DEBOUNCE_MS` - Reconciliation debounce (default `1500`).
- `QUEUE_ORDER` - Task ordering: `alphabetical` (default, A→Z by name) or `priority_then_alphabetical`.
- `QUEUE_RUN_ON_STARTUP` - Run reconciliation on boot (default `true`).
- `QUEUE_POLL_INTERVAL_MS` - Fallback polling interval (default `60000`).
- `MAX_TASKS_PER_RUN` - Max tasks per reconciliation cycle (default `50`).
- `AUTO_RESET_FAILED_TASK` - Reset failed tasks to Not Started (default `false`).
- `NOTION_PROP_MODEL` - Name of the Notion property for model selection (default `Model`).
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
- `notion` - Notion API integration.
- `claude` - Claude runner and prompt builder.
- `config` - Configuration and environment.
- `scripts` - CLI scripts and panel server.

**Examples:**
```
feat(panel): add real-time task progress indicator
fix(orchestrator): prevent duplicate task execution on rapid triggers
refactor(notion): extract markdown converter to separate module
chore: bump dependencies to latest versions
```

### Commit Workflow
When committing changes:
1. Stage only the relevant files (never use `git add -A` blindly).
2. Bump the version in `package.json` with the appropriate level.
3. Include the version bump in the same commit.
4. Write a clear commit message describing **what** changed and **why**.
5. If multiple unrelated changes exist, split them into separate commits.

## Safety Rules
- Never write real secrets into `.env.example`, `README.md`, or code.
- Never print full secret values in terminal summaries.
- Store secrets only in `.env`.
- If user shares secrets in chat, avoid repeating them verbatim.

## Operational Rules During Task Execution
- Always use the card URL/ID as reference in outputs.
- Keep task updates concise.
- If Claude returns blocked/error, explain next action clearly.
- If quota/limit is reached, report reset time and pause processing.

## Logging Expectations
Logs are streamed to the panel's Live Log Feed in real time. They are color-coded by level and tagged by source.

Prefer concise, human-readable lines such as:
- `INFO - Moved to In Progress: "Task Name"`
- `SUCCESS - Moved to Done: "Task Name"`

## Project Structure
```
Product Manager/
├── src/                    # Automation engine
│   ├── index.js            # Express server & endpoints
│   ├── orchestrator.js     # Queue logic & reconciliation
│   ├── selectTask.js       # Task picking & epic detection
│   ├── claudeRunner.js     # Claude subprocess execution
│   ├── promptBuilder.js    # Prompt generation
│   ├── config.js           # Environment config parsing
│   ├── logger.js           # Colored console output
│   ├── runStore.js         # Run history (JSON store)
│   ├── watchdog.js         # Long-running task monitor
│   └── notion/             # Notion API integration
│       ├── client.js       # API wrapper
│       ├── mapper.js       # Page-to-task conversion
│       └── markdown.js     # Blocks-to-markdown
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
