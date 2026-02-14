# Claude Playbook: Product Manager Automation

## Project Purpose
This project automates a Notion Kanban workflow and uses Claude Code to execute tasks.

Core flow:
1. Read tasks from Notion database.
2. Move one task to `In Progress` when queue is empty.
3. Execute task instructions with Claude Code.
4. Move task to `Done` after successful execution.
5. React to Notion webhook events to continue processing.

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
- **Setup Tab** - Form-based configuration wizard with validation and help tooltips for all `.env` values (Notion token, database ID, Claude token, working directory, runtime toggles).
- **Operations Tab** - Start/stop/restart the Automation API and Tunnel processes, trigger manual runs, copy webhook URL.
- **Live Log Feed** - Real-time streaming of all logs via SSE, color-coded by level and source (Panel, API, Tunnel, Claude, Chat).
- **Claude Chat** - Send one-shot prompts to Claude directly from the panel.
- **Theme Toggle** - Light/dark mode with OS preference detection.

### Panel Architecture
- **Frontend**: React + Tailwind CSS + Base UI components, built with Vite (`panel/src/`).
- **Backend**: Express server (`scripts/panelServer.js`) on port 4100 that manages child processes, streams logs via SSE, and proxies config/process/chat APIs.

## First-Time Setup
Setup is done through the visual panel at `http://localhost:4100`.

The Setup tab guides the user through configuring:
1. **Notion API Token** - Integration token from Notion.
2. **Notion Database ID** - ID of the Kanban database.
3. **Notion Webhook Secret** - For webhook signature validation.
4. **Claude OAuth Token** - Obtained via `/opt/homebrew/bin/claude setup-token`.
5. **Claude Working Directory** - Where Claude executes tasks (supports native folder picker).
6. **Runtime Toggles** - Full Access, Stream Output, Log Prompt.

After saving, the panel can restart the API service automatically.

### Notion Database Schema
If creating a new database, ensure this schema:
- `Name` (title)
- `Status` (status): `Not started`, `In progress`, `Done`
- `Agent` (multi-select)
- `Priority` (select): `P0`, `P1`, `P2`, `P3`
- `Type` (select): `Epic`, `UserStory`, `Defect`, `Discovery`
- Sub-items feature enabled (so `Parent item` relation is available)

### Webhook Configuration
- Create webhook in Notion targeting `<PUBLIC_URL>/webhooks/notion`.
- Use `npm run tunnel` (ngrok) or `npm run tunnel:localtunnel` to expose locally.
- If Notion returns a verification token, enter it in the panel's Webhook Secret field.

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
| `npm run tunnel` | Expose local service via ngrok |
| `npm run tunnel:localtunnel` | Expose local service via localtunnel |
| `npm run claude:chat` | Interactive Claude chat session (CLI) |
| `npm run claude:manual -- "<prompt>"` | One-shot Claude prompt (CLI) |
| `npm run setup:claude-md` | Regenerate this CLAUDE.md playbook |

## Configuration Reference

### Required `.env` Values
- `NOTION_API_TOKEN` - Notion integration token.
- `NOTION_DATABASE_ID` - Target Kanban database.

### Optional `.env` Values
- `NOTION_WEBHOOK_SECRET` - Webhook signature validation.
- `CLAUDE_CODE_OAUTH_TOKEN` - For non-interactive Claude auth.
- `CLAUDE_WORKDIR` - Working directory for Claude execution (default `.`).
- `CLAUDE_FULL_ACCESS` - Skip Claude permission prompts (default `false`).
- `CLAUDE_STREAM_OUTPUT` - Stream Claude output to logs (default `false`).
- `CLAUDE_LOG_PROMPT` - Log prompts sent to Claude (default `true`).
- `CLAUDE_TIMEOUT_MS` - Claude execution timeout (default `2700000` = 45min).
- `CLAUDE_EXTRA_PROMPT` - Additional prompt text appended to every task.
- `PORT` - Automation API port (default `3000`).
- `PANEL_PORT` - Panel server port (default `4100`).
- `PANEL_AUTO_OPEN` - Auto-open browser on panel start (default `true`).
- `PANEL_AUTO_START_API` - Auto-start API when panel starts (default `true`).
- `QUEUE_DEBOUNCE_MS` - Reconciliation debounce (default `1500`).
- `QUEUE_ORDER` - Task ordering: `created` or `priority_then_created`.
- `QUEUE_RUN_ON_STARTUP` - Run reconciliation on boot (default `true`).
- `QUEUE_POLL_INTERVAL_MS` - Fallback polling interval (default `60000`).
- `MAX_TASKS_PER_RUN` - Max tasks per reconciliation cycle (default `50`).
- `AUTO_RESET_FAILED_TASK` - Reset failed tasks to Not Started (default `false`).
- `MANUAL_RUN_TOKEN` - Auth token for the `/run` endpoint.

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
fix(orchestrator): prevent duplicate task execution on rapid webhooks
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
- `SUCCESS - Webhook received: moved to Done: "Task Name"`

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
│   ├── security.js         # Webhook signature validation
│   └── notion/             # Notion API integration
│       ├── client.js       # API wrapper
│       ├── mapper.js       # Page-to-task conversion
│       ├── markdown.js     # Blocks-to-markdown
│       └── webhookSummary.js
├── panel/                  # Visual control panel (React)
│   ├── vite.config.mjs     # Vite build config
│   ├── index.html          # HTML entry point
│   └── src/
│       ├── main.jsx        # React root
│       ├── App.jsx         # Main dashboard
│       ├── theme.css       # Tailwind + design tokens
│       └── components/     # UI component library
├── scripts/
│   ├── panelServer.js      # Panel Express backend
│   ├── claudeManual.js     # CLI chat/manual scripts
│   └── setupClaudeMd.js    # CLAUDE.md generator
├── .env                    # Runtime config (not committed)
├── .env.example            # Template
└── .data/runs.json         # Execution history (generated)
```

## If Something Is Missing
If required setup data is missing, ask directly and continue only after confirmation.
Do not guess secrets or IDs.
