# Product Manager Automation (Notion + Claude Code)

A Node.js service that orchestrates a Notion Kanban board and executes cards automatically through Claude Code.

## What It Does

- Reads cards from a Notion database with these properties:
  - `Name`, `Status`, `Agent`, `Priority`, `Type`, `Parent item` (sub-task)
- Ensures continuous flow:
  - If there is a card in `In Progress` (non-`Epic`), it executes that card.
  - If `In Progress` is empty, it moves the first card from `Not Started` to `In Progress` (ignoring `Epic`).
  - Parent cards with sub-tasks are also treated as `Epic` even if `Type` is empty/misconfigured.
- For each card, it starts a separate execution of the command configured in `CLAUDE_COMMAND`.
- When execution finishes successfully (`status=done`), it moves the card to `Done`.
- When all children of an `Epic` are in `Done`, it automatically moves the `Epic` to `Done`.
- Appends an automation summary with estimated duration to the Epic card.
- Receives Notion webhooks to trigger reconciliation, with optional fallback polling.

## Requirements

- Node.js 20+
- Notion integration with access to the database
- `claude` command (or equivalent) available in the environment

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

3. Update `.env`:
- `NOTION_API_TOKEN`
- `NOTION_DATABASE_ID`
- (Optional) `CLAUDE_COMMAND` (defaults to `claude --print`)
- `CLAUDE_CODE_OAUTH_TOKEN` (generate via `claude setup-token`)
- `CLAUDE_WORKDIR` (folder where Claude will execute)
- `CLAUDE_STREAM_OUTPUT=true` if you want to watch Claude output live
- `CLAUDE_LOG_PROMPT=true` to print the exact prompt sent to Claude
- `CLAUDE_FULL_ACCESS=true` to skip Claude permission prompts during task execution
- (Optional) property/status names if they differ in your Notion
- (Optional) `NOTION_WEBHOOK_SECRET`

4. Start the service:

```bash
npm run dev
```

5. (Optional) Generate a project `CLAUDE.md` playbook via Claude:

```bash
npm run setup:claude-md
```

This command asks Claude to edit `CLAUDE.md` in-place (or create it if missing), instead of replacing it directly from a template.

## Base UI Setup Panel (Recommended for Team)

This project includes a local Base UI-based control panel to avoid manual terminal setup.

Start panel:

```bash
npm run panel
```

Open:

```text
http://localhost:4100
```

By default the panel tries to open the browser automatically.
Disable it with `PANEL_AUTO_OPEN=false` in `.env`.

By default the panel also auto-starts the automation app (`npm run dev`).
Disable it with `PANEL_AUTO_START_API=false` in `.env`.

UI development (hot reload):

```bash
npm run panel:dev
```

From the panel you can:
- Configure `.env` fields
- Open contextual help (`?`) for each setup field
- Validate key fields before saving
- Switch between light and dark theme
- Open the Notion database directly from the `Notion Database ID` field
- Pick `CLAUDE_WORKDIR` with a native folder picker
- Start/stop the automation app (`npm run dev`)
- Start/stop tunnel (ngrok by default)
- Copy webhook URL
- Trigger manual run
- Send one-shot chat messages to Claude from the panel at any time
- Toggle `Show Claude Live Output` and `Log Prompt Sent to Claude` at runtime (without editing `.env`)
- Watch live process logs in a feed
- Save config with optional app restart confirmation (to apply changes immediately)

Panel behavior note:
- Starting the automation app from the panel forces `QUEUE_RUN_ON_STARTUP=false`, so queue execution starts when you click `Run Queue Now`, when a webhook arrives, or by periodic fallback (`QUEUE_POLL_INTERVAL_MS`).

Panel implementation note:
- The panel is built with `@base-ui/react` + Tailwind CSS, uses `Ionicons`, and is compiled with Vite into `panel/dist`.

## Endpoints

- `GET /health`
- `POST /run` (manual trigger)
  - If `MANUAL_RUN_TOKEN` is configured: `Authorization: Bearer <token>`
- `POST /webhooks/notion`

## Notion Webhook

Configure the webhook in Notion to call `POST /webhooks/notion`.

- When `NOTION_WEBHOOK_SECRET` is configured, the `x-notion-signature` header signature is validated.
- If Notion sends a `verification_token`, the service logs it to simplify setup.

### Team Tunnel Standard

- Primary tunnel provider: `ngrok` (recommended for team consistency and webhook reliability).
- Fallback provider: `localtunnel` (quick temporary testing when ngrok is unavailable).
- Token policy:
  - `ngrok` authtoken is per-user credential.
  - Keep it in global ngrok config, not in project `.env`.
  - Do not commit or share personal authtokens in repository files.

Install and configure ngrok once per machine:

```bash
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken <YOUR_NGROK_TOKEN>
```

Start tunnel (team standard):

```bash
npm run tunnel
```

Fallback tunnel:

```bash
npm run tunnel:localtunnel
```

### Webhook Quick Setup (Local)

1. Start the app:

```bash
npm run dev
```

2. Expose your local server (team standard with ngrok):

```bash
npm run tunnel
```

3. In Notion webhook settings, use:

```text
https://<YOUR_NGROK_DOMAIN>/webhooks/notion
```

If using localtunnel fallback, replace `<YOUR_NGROK_DOMAIN>` with the `loca.lt` URL.

4. If the app logs a verification token, copy it into `.env`:

```bash
NOTION_WEBHOOK_SECRET=<verification_token>
```

5. Restart the app:

```bash
npm run dev
```

## Claude Response Contract

The orchestrator sends the card to the configured command and expects a one-line JSON response:

```json
{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}
```

- `status=done`: card moves to `Done`.
- `status=blocked` or command failure: card remains as-is (or returns to `Not Started` if `AUTO_RESET_FAILED_TASK=true`).
- On success, the automation also appends an execution summary (`summary`, `notes`, `tests`, `files`) to the task card in Notion.

## Claude Auth (Non-interactive)

Generate a long-lived token:

```bash
/opt/homebrew/bin/claude setup-token
```

Then set it in `.env`:

```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...
CLAUDE_FULL_ACCESS=true
```

Quick validation:

```bash
printf 'Return only ok' | /opt/homebrew/bin/claude --print
```

## Manual Claude Interaction

Start an interactive Claude session at any time:

```bash
npm run claude:chat
```

Run a one-shot prompt at any time:

```bash
npm run claude:manual -- "Summarize current pending tasks"
```

## Important Notes

- The Notion API does not reliably expose the board's visual order. The "first card" is approximated by creation order (`QUEUE_ORDER=created`) or priority+creation (`priority_then_created`).
- `QUEUE_RUN_ON_STARTUP=true` triggers one reconciliation cycle right after API boot. The panel overrides this to `false` when it starts/restarts the app.
- `QUEUE_POLL_INTERVAL_MS=60000` enables periodic fallback reconciliation every 60s (set `0` to disable).
- The service is designed to run as a single process. For high availability, add a distributed lock.
- Epic durations are based on local timestamps stored in `.data/runs.json`.
- The automation identifies Epic children through sub-task relation (`Parent item`) and also falls back to `page.parent.page_id`.
- `npm run dev` and `npm start` suppress only Node warning `DEP0040` to keep logs clean on Node v23+.
- The terminal logs now show webhook reception, status transitions, and (optionally) full prompts sent to Claude (`CLAUDE_LOG_PROMPT=true`).

## Tests

```bash
npm test
```
