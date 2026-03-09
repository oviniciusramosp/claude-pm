import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);
import { runClaudeTask } from './claudeRunner.js';
import { buildEpicReviewPrompt, buildEpicSummary, buildRetryPrompt, buildReviewPrompt, buildTaskCompletionNotes, buildTaskPrompt, formatDuration } from './promptBuilder.js';
import { allEpicChildrenAreDone, hasIncompleteEpic, isEpicTask, pickNextEpic, pickNextEpicChild, pickNextTask, sortCandidates } from './selectTask.js';
import { Watchdog } from './watchdog.js';
import { autoRecovery } from './autoRecovery.js';

function normalize(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

/**
 * Compute relative path from Claude's workdir to the task file.
 * Returns empty string if path cannot be resolved.
 */
function resolveTaskFilePath(task, workdir) {
  if (!task._filePath || !workdir) {
    return '';
  }
  try {
    return path.relative(workdir, task._filePath);
  } catch {
    return '';
  }
}

const OPUS_REVIEW_MODEL = 'claude-opus-4-6';

function extractTaskCode(task) {
  if (!task || !task.id) return null;
  if (task.parentId) {
    const fileName = task.id.split('/').pop() || '';
    const match = fileName.match(/^s(\d+)-(\d+)/i);
    if (match) return `S${match[1]}.${match[2]}`;
  }
  const id = task.id.split('/')[0];
  const match = id.match(/^(E\d+)/i);
  if (match) return match[1].toUpperCase();
  return null;
}

function taskLabel(task) {
  const code = extractTaskCode(task);
  return code ? `${code} - ${task.name}` : task.name;
}

function isOpusModel(modelName) {
  return normalize(modelName).includes('opus');
}

function getErrorText(error) {
  if (typeof error === 'string') return error.toLowerCase();
  return [
    String(error?.message || ''),
    String(error?.stderr || ''),
    String(error?.stdout || '')
  ].join(' ').toLowerCase();
}

function isClaudeLimitError(error) {
  const text = getErrorText(error);
  return (
    text.includes("you've hit your limit") ||
    text.includes('hit your limit') ||
    text.includes('quota') ||
    text.includes('usage limit')
  );
}

function isClaudeAuthError(error) {
  const text = getErrorText(error);
  return (
    text.includes('authentication_error') ||
    text.includes('invalid bearer token') ||
    text.includes('failed to authenticate') ||
    text.includes('api error: 401')
  );
}

/**
 * Parse the expected wait time (ms) from a Claude usage-limit error message.
 * Returns null if the reset time cannot be determined.
 */
function parseLimitResetMs(message) {
  const text = String(message || '');

  // "resets in X minutes" / "resets in X hours"
  const relMatch = text.match(/resets?\s+in\s+(\d+)\s+(minute|hour)/i);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    return relMatch[2].toLowerCase().startsWith('hour')
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
  }

  // "resets at HH:MM AM/PM UTC" or "resets at HH:MM UTC"
  const absMatch = text.match(/resets?\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:UTC)?/i);
  if (absMatch) {
    let hours = parseInt(absMatch[1], 10);
    const minutes = parseInt(absMatch[2], 10);
    const ampm = absMatch[3]?.toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    const now = new Date();
    const reset = new Date(now);
    reset.setUTCHours(hours, minutes, 0, 0);
    if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
    return reset.getTime() - now.getTime();
  }

  // "midnight UTC" / "midnight"
  if (/midnight/i.test(text)) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  return null;
}

async function getGitHead(workdir) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workdir });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function hasGitChanges(workdir, headBefore) {
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workdir });
    if (status.trim()) {
      return true;
    }

    if (headBefore) {
      const { stdout: headAfterOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workdir });
      if (headAfterOut.trim() !== headBefore) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

function declaredFilesExist(workdir, files) {
  if (!Array.isArray(files) || files.length === 0) {
    return false;
  }

  return files.some((f) => existsSync(path.resolve(workdir, String(f))));
}

async function validateExecution(workdir, headBefore, execution) {
  const gitChanged = await hasGitChanges(workdir, headBefore);
  if (gitChanged) {
    return { valid: true };
  }

  const filesExist = declaredFilesExist(workdir, execution.files);
  if (filesExist) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: 'No git changes detected and declared files do not exist on disk. Possible hallucination.'
  };
}

function buildContractJson(execution) {
  return JSON.stringify({
    status: execution.status || 'done',
    summary: execution.summary || '',
    notes: execution.notes || '',
    files: Array.isArray(execution.files) ? execution.files : [],
    tests: execution.tests || ''
  });
}

function formatContractForDisplay(execution) {
  const parts = [];
  if (execution.summary) parts.push(`Summary: ${execution.summary}`);
  if (execution.status && execution.status !== 'done') parts.push(`Status: ${execution.status}`);
  if (Array.isArray(execution.files) && execution.files.length > 0) {
    parts.push(`Files: ${execution.files.length} modified`);
  }
  if (execution.tests) parts.push(`Tests: ${execution.tests}`);
  if (execution.notes) parts.push(`Notes: ${execution.notes}`);
  return parts.length > 0 ? parts.join(' • ') : 'No details available';
}

async function checkActiveFixes(port = 4100) {
  try {
    const response = await fetch(`http://localhost:${port}/api/board/has-active-fixes`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      return false; // Fail open — proceed if panel is not reachable
    }

    const data = await response.json();
    return data.hasActiveFixes === true;
  } catch {
    return false; // Fail open — proceed if panel is not reachable
  }
}

export class Orchestrator extends EventEmitter {
  constructor({ config, logger, boardClient, runStore, usageStore }) {
    super();
    this.config = config;
    this.logger = logger;
    this.boardClient = boardClient;
    this.runStore = runStore;
    this.usageStore = usageStore;

    this.running = false;
    this.timer = null;
    this.pending = false;
    this.pendingReasons = [];
    this.pendingMode = 'normal';
    this.currentTaskId = null;
    this.currentTaskName = null;
    this.lastKnownStatusByTaskId = new Map();
    this.claudeCompletedTaskIds = new Map();
    this.watchdog = new Watchdog({ config, logger });
    this.halted = false;
    this.paused = true; // Start paused by default
    this.shutdownTimer = null; // Track pending shutdown
    this.explicitEpicMode = false; // Track if we're running an explicit "Run Epic" command

    // Usage-limit auto-resume state
    this.limitResumeTimer = null;  // setTimeout handle for scheduled auto-resume
    this.limitResumeAt = null;     // Date when auto-resume is scheduled
    this.limitRetryCount = 0;      // How many auto-retries have been attempted
    this.haltIgnoredCount = 0;     // Schedule requests suppressed since last halt
  }

  async _recordTaskUsage(task, execution) {
    if (this.usageStore && execution && execution.usage) {
      try {
        await this.usageStore.recordUsage(task.id, task.name, execution.usage);
      } catch (err) {
        // Log to console only (not to Live Feed - not critical)
        console.debug(`[orchestrator] Failed to record token usage: ${err.message}`);
      }
    }
  }

  schedule(reason, options = {}) {
    if (this.halted) {
      // Suppress repeated log noise — the halt message already explained the situation.
      // Just count suppressed requests; they will be reported when auto-resume fires.
      this.haltIgnoredCount = (this.haltIgnoredCount || 0) + 1;
      return;
    }

    if (this.paused) {
      return;
    }

    // Cancel pending shutdown if new work is scheduled
    if (this.shutdownTimer) {
      this.logger.info('Cancelling pending auto-shutdown (new work scheduled)');
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    this.pendingReasons.push(reason);

    if (options.mode) {
      this.pendingMode = options.mode;
    }

    if (this.running) {
      this.pending = true;
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.runQueued().catch((error) => {
        this.logger.error(`Automation loop failed: ${error.message}`);
      });
    }, this.config.queue.debounceMs);
  }

  async runQueued() {
    if (this.running) {
      this.pending = true;
      return;
    }

    this.running = true;

    try {
      do {
        this.pending = false;

        const reasons = this.pendingReasons.splice(0);
        const reason = reasons.length > 0 ? reasons.join(', ') : 'manual';
        const mode = this.pendingMode;
        this.pendingMode = 'normal';

        if (mode === 'epic') {
          this.explicitEpicMode = true; // Mark that we're in explicit "Run Epic" mode
          await this.reconcileEpic(reason);
          this.explicitEpicMode = false;
        } else if (mode === 'task') {
          await this.reconcile(reason, 1);
        } else {
          await this.reconcile(reason);
        }

        if (this.halted) {
          break;
        }
      } while (this.pending || this.pendingReasons.length > 0);
    } finally {
      this.running = false;
    }
  }

  isRunning() {
    return {
      active: this.running,
      currentTaskId: this.currentTaskId,
      currentTaskName: this.currentTaskName,
      queuedReasons: this.pendingReasons,
      halted: this.halted,
      paused: this.paused,
      mode: this.pendingMode,
      limitResumeAt: this.limitResumeAt ? this.limitResumeAt.toISOString() : null,
      limitRetryCount: this.limitRetryCount,
      limitMaxRetries: this.config.usageLimit.maxAutoRetries
    };
  }

  pause() {
    if (this.paused) {
      return false;
    }

    this.paused = true;
    this.logger.info('Orchestrator paused. Task execution will not start until resumed.');
    return true;
  }

  unpause() {
    if (!this.paused) {
      return false;
    }

    this.paused = false;
    this.logger.info('Orchestrator activated. Checking for tasks to execute...');

    // Trigger reconciliation via schedule() which handles debounce/guard properly
    this.schedule('unpause');

    return true;
  }

  resume() {
    if (!this.halted) {
      return false;
    }

    // Cancel pending auto-resume timer if the user intervened manually
    if (this.limitResumeTimer) {
      clearTimeout(this.limitResumeTimer);
      this.limitResumeTimer = null;
    }
    this.limitResumeAt = null;
    this.limitRetryCount = 0; // Manual resume resets the retry counter
    this.halted = false;
    this.haltIgnoredCount = 0;
    this.logger.info('Orchestrator resumed manually. Checking for tasks...');
    this.schedule('manual_resume');
    return true;
  }

  /**
   * Halt the orchestrator due to a Claude usage limit error and schedule an
   * automatic resume attempt after the expected reset time.
   *
   * If the error message contains a parsable reset time it is used directly;
   * otherwise an exponential backoff based on `limitRetryCount` is applied
   * (1h → 1h → 2h → 4h → permanent halt after maxAutoRetries attempts).
   */
  haltForUsageLimit(errorMessage, context = '') {
    // Cancel any pre-existing auto-resume timer before setting a new one
    if (this.limitResumeTimer) {
      clearTimeout(this.limitResumeTimer);
      this.limitResumeTimer = null;
    }

    this.halted = true;
    this.haltIgnoredCount = 0;

    const maxRetries = this.config.usageLimit.maxAutoRetries;
    const ctxStr = context ? ` ${context}` : '';

    if (this.limitRetryCount >= maxRetries) {
      this.limitResumeAt = null;
      this.logger.warn(
        `⏸ Claude usage limit reached${ctxStr}. ` +
        `Auto-retry exhausted (${maxRetries}/${maxRetries} attempts used). ` +
        `→ Wait for the limit to reset, then click "Resume" in the panel.`
      );
      return;
    }

    // Prefer the reset time from the error message; fall back to backoff schedule
    const parsedMs = parseLimitResetMs(errorMessage);
    const baseDelay = this.config.usageLimit.resumeDelayMs;
    const backoffFactor = this.limitRetryCount === 0 ? 1 : Math.pow(2, this.limitRetryCount - 1);
    const computedMs = Math.min(baseDelay * backoffFactor, 4 * 60 * 60 * 1000); // cap at 4 h
    const delayMs = parsedMs ?? computedMs;

    const resumeAt = new Date(Date.now() + delayMs);
    this.limitResumeAt = resumeAt;

    const attempt = this.limitRetryCount + 1;
    const timeStr = resumeAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationStr = formatDuration(delayMs);
    const sourceStr = parsedMs ? '(from error message)' : '(estimated)';

    this.logger.warn(
      `⏸ Claude usage limit reached${ctxStr}. ` +
      `Auto-resume scheduled at ${timeStr} in ${durationStr} ${sourceStr} — ` +
      `attempt ${attempt}/${maxRetries}. ` +
      `To resume now: click "Resume" in the panel.`
    );

    this.limitResumeTimer = setTimeout(() => {
      this.limitResumeTimer = null;
      this.limitRetryCount++;
      this.halted = false;
      this.limitResumeAt = null;

      const suppressedStr = this.haltIgnoredCount > 0
        ? ` (${this.haltIgnoredCount} schedule requests were suppressed while paused)`
        : '';
      this.haltIgnoredCount = 0;

      this.logger.info(
        `▶ Auto-resuming after usage limit wait${suppressedStr}. Checking for tasks...`
      );
      this.schedule('limit_auto_retry');
    }, delayMs);
  }

  observeStatuses(tasks) {
    if (this.lastKnownStatusByTaskId.size === 0) {
      for (const task of tasks) {
        this.lastKnownStatusByTaskId.set(task.id, task.status || '');
      }
      return;
    }

    this.lastKnownStatusByTaskId.clear();
    for (const task of tasks) {
      this.lastKnownStatusByTaskId.set(task.id, task.status || '');
    }
  }

  async reconcile(reason, maxTasks) {
    const limit = maxTasks || this.config.queue.maxTasksPerRun;

    // Check if any AC fix operation is running — block reconciliation until it completes
    const panelPort = Number(process.env.PANEL_PORT || 4100);
    const hasActiveFixes = await checkActiveFixes(panelPort);
    if (hasActiveFixes) {
      this.logger.warn('AC fix operation in progress. Skipping reconciliation to prevent conflicts.');
      return;
    }

    // Check for incomplete epics first — they must be finished before standalone tasks.
    const initialTasks = await this.boardClient.listTasks();
    this.observeStatuses(initialTasks);
    await this.closeCompletedEpics(initialTasks);

    if (hasIncompleteEpic(initialTasks, this.config)) {
      // Delegate to epic reconciliation (it will log its own initialization)
      await this.reconcileEpic(reason);
      return;
    }

    // Only log reconciliation start for standalone tasks
    const uniqueReasons = Array.from(new Set(reason.split(', '))).join(', ');
    this.logger.info(`Starting board reconciliation (reason: ${uniqueReasons})`);

    let processed = 0;

    for (let iteration = 0; iteration < limit; iteration += 1) {
      const tasks = await this.boardClient.listTasks();
      this.observeStatuses(tasks);
      await this.closeCompletedEpics(tasks);

      // Re-check after closing epics — a new epic may now be the next priority.
      if (hasIncompleteEpic(tasks, this.config)) {
        // Delegate to epic reconciliation (it will log its own initialization)
        await this.reconcileEpic(reason);
        break;
      }

      const candidate = pickNextTask(tasks, this.config);
      if (!candidate) {
        break;
      }

      const task = candidate.task;
      const source = candidate.source;

      if (this.claudeCompletedTaskIds.has(task.id)) {
        // Silently retry status update (only log if it fails)
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
        } catch (retryError) {
          this.logger.error(`Board status update retry failed for "${taskLabel(task)}": ${retryError.message}`);
          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
          }
          break;
        }
        continue;
      }

      if (source === 'not_started') {
        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.inProgress);
      }
      await this.runStore.markStarted(task);

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const taskFilePath = resolveTaskFilePath(task, this.config.claude.workdir);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit,
        enableMultiAgents: this.config.claude.enableMultiAgents,
        taskFilePath
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${taskLabel(task)}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.currentTaskName = taskLabel(task);
      this.logger.info(`Claude is working on: "${taskLabel(task)}" | model: ${this.config.claude.modelOverride || task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = await getGitHead(this.config.claude.workdir);

      const failedAcUpdates = [];
      const onAcComplete = (acRef) => {
        if (acRef.type === 'numbered') {
          this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]).then(() => {
            this.logger.success(`AC completed: AC-${acRef.index}`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox AC-${acRef.index}: ${err.message}`);
            failedAcUpdates.push(acRef);
          });
        } else {
          this.boardClient.updateCheckboxes(task.id, [acRef.text]).then(() => {
            this.logger.success(`AC completed: "${acRef.text}"`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox "${acRef.text}": ${err.message}`);
            failedAcUpdates.push(acRef);
          });
        }
      };

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal, onAcComplete });

        // Retry any AC checkbox updates that failed during streaming
        if (failedAcUpdates.length > 0) {
          this.logger.info(`Retrying ${failedAcUpdates.length} failed AC update(s)...`);
          for (const acRef of failedAcUpdates) {
            try {
              if (acRef.type === 'numbered') {
                await this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]);
              } else {
                await this.boardClient.updateCheckboxes(task.id, [acRef.text]);
              }
              this.logger.success(`AC retry succeeded: AC-${acRef.index || acRef.text}`);
            } catch (retryErr) {
              this.logger.error(`AC retry failed: AC-${acRef.index || acRef.text}: ${retryErr.message}`);
            }
          }
        }

        await this._recordTaskUsage(task, execution);

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          // Emit consolidated completion bubble for failed execution
          const failGroupId = `task-exec-fail-${task.id}`;
          this.logger.progressive(
            'warn',
            failGroupId,
            'complete',
            `Claude finished with issues: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`,
            { status: execution.status || 'unknown', details: formatContractForDisplay(execution) },
            buildContractJson(execution),
            true // feedEnabled
          );

          // Try auto-recovery before marking as failed
          if (autoRecovery.canRecover(task.id)) {
            this.logger.warn(`Task failed: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

            const recovery = await autoRecovery.tryRecover(task.id, {
              message: `Task returned status: ${execution.status || 'unknown'}`,
              timedOut: false,
            }, {
              task: {
                id: task.id,
                name: task.name,
                content: markdown,
                acceptanceCriteria: task.acceptanceCriteria || [],
              },
              logs: execution.stdout || '',
              workdir: this.config.claude.workdir,
              exitCode: execution.exitCode,
            });

            if (recovery.recovered) {
              this.logger.success(`Auto-recovery succeeded, retrying task: "${taskLabel(task)}"`);
              // Don't break - let the loop retry this task
              continue;
            }

            this.logger.error(`Auto-recovery exhausted for "${taskLabel(task)}" after ${recovery.attempt} attempt(s)`);
          }

          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
            break;
          }

          if (this.config.state.autoResetFailedTask) {
            await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${taskLabel(task)}"`);
          }

          break;
        }

        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        const validation = await validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${taskLabel(task)}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${taskLabel(task)}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${taskLabel(task)}"`, retryPrompt);
          }

          const retryHeadBefore = await getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal, onAcComplete });
          await this._recordTaskUsage(task, execution);

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            // Log contract to console only (details available in task markdown)
            console.debug('[orchestrator] Retry execution contract:', buildContractJson(execution));

            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          const retryValidation = await validateExecution(this.config.claude.workdir, retryHeadBefore, execution);
          if (!retryValidation.valid) {
            // Log contract to console only (details available in task markdown)
            console.debug('[orchestrator] Hallucination retry contract:', buildContractJson(execution));

            await this.runStore.markFailed(task, 'Hallucination persisted after retry. No artifacts produced.');
            this.logger.error(`Hallucination persisted after retry for "${taskLabel(task)}". Giving up.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }
        }

        // Log contract to console only (task completed successfully)
        console.debug('[orchestrator] Task execution contract:', buildContractJson(execution));

        this.watchdog.recordSuccess(task.id);
        this.claudeCompletedTaskIds.set(task.id, Date.now());

        let finalExecution = execution;
        const effectiveModel = this.config.claude.modelOverride || task.model;
        const shouldReview = this.config.claude.opusReviewEnabled && !isOpusModel(effectiveModel);

        if (shouldReview) {
          try {
            finalExecution = await this.reviewWithOpus(task, markdown, execution);

            if (normalize(finalExecution.status) !== 'done') {
              const reviewNotes = buildTaskCompletionNotes(task, finalExecution);
              const header = `## Opus Review Feedback (${new Date().toISOString()})\nStatus: ${finalExecution.status || 'blocked'}\n`;
              await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
              await this.runStore.markFailed(task, `Opus review returned status=${finalExecution.status || 'blocked'}`);
              this.logger.warn(`Opus review blocked task: "${taskLabel(task)}" (status: ${finalExecution.status || 'blocked'})`);
              break;
            }

            this.logger.success(`Opus review approved: "${taskLabel(task)}"`);
          } catch (reviewError) {
            // Build detailed error note for task markdown
            const errorDetails = [];
            errorDetails.push(`**Error**: ${reviewError.message}`);
            if (reviewError.exitCode !== undefined) {
              errorDetails.push(`**Exit Code**: ${reviewError.exitCode}`);
            }
            if (reviewError.signal) {
              errorDetails.push(`**Signal**: ${reviewError.signal}`);
            }
            if (reviewError.stderr) {
              const stderrPreview = reviewError.stderr.slice(0, 500);
              errorDetails.push(`**Stderr**:\n\`\`\`\n${stderrPreview}${reviewError.stderr.length > 500 ? '\n...(truncated)' : ''}\n\`\`\``);
            }
            const errorNote = `## Opus Review Error (${new Date().toISOString()})\n${errorDetails.join('\n\n')}\n`;
            await this.boardClient.appendMarkdown(task.id, errorNote);
            await this.runStore.markFailed(task, `Opus review error: ${reviewError.message}`);

            if (isClaudeAuthError(reviewError)) {
              this.logger.error(
                'Claude authentication failed — token may be expired. Run `claude setup-token` to refresh credentials, then restart the API.',
                { expandableContent: { stderr: reviewError.stderr || null, exitCode: reviewError.exitCode ?? null } }
              );
              this.halted = true;
              break;
            }

            if (isClaudeLimitError(reviewError)) {
              this.haltForUsageLimit(reviewError.message, 'during Opus review');
              break;
            }

            // Log concise message to Live Feed; pass technical details for Debug Errors modal
            this.logger.error(`Opus review failed for "${taskLabel(task)}": ${reviewError.message}`, {
              expandableContent: {
                stderr: reviewError.stderr || null,
                stdout: reviewError.stdout || null,
                exitCode: reviewError.exitCode ?? null,
                signal: reviewError.signal || null
              }
            });

            const shouldHaltReview = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHaltReview) {
              this.halted = true;
            }

            break;
          }
        }

        // Apply collected per-AC completions from stdout as fallback
        // (in streaming mode, these were already applied in real-time via onAcComplete)
        if (Array.isArray(finalExecution.collectedAcIndices) && finalExecution.collectedAcIndices.length > 0) {
          await this.boardClient.updateCheckboxesByIndex(task.id, finalExecution.collectedAcIndices);
        }

        // Verify all ACs are checked before moving to Done
        const postCheckMarkdown = await this.boardClient.getTaskMarkdown(task.id);
        const remainingUnchecked = (postCheckMarkdown.match(/^\s*-\s*\[ \]\s+/gm) || []).length;

        if (remainingUnchecked > 0) {
          this.logger.warn(
            `Task "${taskLabel(task)}" has ${remainingUnchecked} unchecked Acceptance Criteria. Triggering automatic AC fix.`
          );

          // Automatically trigger AC fix
          const fixSuccess = await this.triggerAcFix(task);

          if (!fixSuccess) {
            // Fix failed or timed out — mark task as failed and halt
            await this.runStore.markFailed(task, `${remainingUnchecked} Acceptance Criteria still unchecked after execution. AC fix failed.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          // Fix succeeded — verify ACs again
          const postFixMarkdown = await this.boardClient.getTaskMarkdown(task.id);
          const postFixUnchecked = (postFixMarkdown.match(/^\s*-\s*\[ \]\s+/gm) || []).length;

          if (postFixUnchecked > 0) {
            this.logger.warn(
              `Task "${taskLabel(task)}" still has ${postFixUnchecked} unchecked ACs after fix. Keeping in In Progress.`
            );
            await this.runStore.markFailed(task, `${postFixUnchecked} Acceptance Criteria still unchecked after AC fix.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          // All ACs now checked — proceed to Done
          this.logger.success(`AC fix completed successfully for "${taskLabel(task)}". All ACs now checked.`);
        }

        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
        this.claudeCompletedTaskIds.delete(task.id);
        autoRecovery.reset(task.id); // Reset recovery counter on success
        this.limitRetryCount = 0;   // Reset usage-limit retry counter on success
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${taskLabel(task)}"`, undefined, true);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);

        if (isClaudeAuthError(error)) {
          this.logger.error(
            'Claude authentication failed — token may be expired. Run `claude setup-token` to refresh credentials, then restart the API.',
            { expandableContent: { stderr: error.stderr || null, exitCode: error.exitCode ?? null } }
          );
          this.halted = true;
          break;
        }

        if (isClaudeLimitError(error)) {
          this.haltForUsageLimit(error.message);
          break;
        }

        this.logger.error(`Failed to execute task "${taskLabel(task)}": ${error.message}`, {
          expandableContent: {
            stderr: error.stderr || null,
            stdout: error.stdout || null,
            exitCode: error.exitCode ?? null,
            signal: error.signal || null,
            stack: error.stack || null
          }
        });

        const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
        if (shouldHalt) {
          this.halted = true;
          break;
        }

        if (this.config.state.autoResetFailedTask) {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
          this.logger.warn(`Returned to Not Started after failure: "${taskLabel(task)}"`);
        }

        break;
      } finally {
        this.currentTaskId = null;
        this.currentTaskName = null;
      }
    }

    const finalTasks = await this.boardClient.listTasks();
    this.observeStatuses(finalTasks);
    await this.closeCompletedEpics(finalTasks);

    const finalReasons = Array.from(new Set(reason.split(', '))).join(', ');
    this.logger.success(`Reconciliation finished (processed: ${processed}, reason: ${finalReasons})`);
  }

  async reconcileEpic(reason) {
    // Check if any AC fix operation is running — block reconciliation until it completes
    const panelPort = Number(process.env.PANEL_PORT || 4100);
    const hasActiveFixes = await checkActiveFixes(panelPort);
    if (hasActiveFixes) {
      this.logger.warn('AC fix operation in progress. Skipping epic reconciliation to prevent conflicts.');
      return;
    }

    const tasks = await this.boardClient.listTasks();
    this.observeStatuses(tasks);

    const epicCandidate = pickNextEpic(tasks, this.config);
    if (!epicCandidate) {
      this.logger.info('No epic found to run.');
      return;
    }

    const epic = epicCandidate.task;
    const groupId = `epic-init-${epic.id}`;

    // Build initialization details
    const initDetails = [];
    const uniqueReasons = Array.from(new Set(reason.split(', '))).join(', ');
    initDetails.push(`Reason: ${uniqueReasons}`);

    if (epicCandidate.source === 'not_started') {
      await this.boardClient.updateTaskStatus(epic.id, this.config.board.statuses.inProgress);
      initDetails.push(`Status: Moved to In Progress`);

      const childrenInfo = await this.stampEpicChildrenStatuses(epic);
      if (childrenInfo) {
        initDetails.push(`Children: Initialized ${childrenInfo.count} tasks`);
        if (childrenInfo.firstTask) {
          initDetails.push(`First task: "${childrenInfo.firstTask}"`);
        }
      }
    } else {
      initDetails.push(`Status: Resuming In Progress`);
    }

    // Emit consolidated bubble
    this.logger.progressive(
      'info',
      groupId,
      'complete',
      `Epic initialized: "${taskLabel(epic)}"`,
      { details: initDetails.join(' • ') },
      null, // no expandableContent
      true // feedEnabled
    );

    let processed = 0;

    for (let iteration = 0; iteration < this.config.queue.maxTasksPerRun; iteration += 1) {
      const currentTasks = await this.boardClient.listTasks();
      this.observeStatuses(currentTasks);

      const childCandidate = pickNextEpicChild(currentTasks, this.config, epic.id);
      if (!childCandidate) {
        this.logger.info(`All children of epic "${taskLabel(epic)}" are done or none remain.`);
        break;
      }

      const task = childCandidate.task;
      const source = childCandidate.source;

      if (this.claudeCompletedTaskIds.has(task.id)) {
        // Silently retry status update (only log if it fails)
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
        } catch (retryError) {
          this.logger.error(`Board status update retry failed for "${taskLabel(task)}": ${retryError.message}`);
          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
          }
          break;
        }
        continue;
      }

      if (source === 'not_started') {
        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.inProgress);
      }
      await this.runStore.markStarted(task);

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const taskFilePath = resolveTaskFilePath(task, this.config.claude.workdir);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit,
        enableMultiAgents: this.config.claude.enableMultiAgents,
        taskFilePath
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${taskLabel(task)}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.currentTaskName = taskLabel(task);
      this.logger.info(`Claude is working on: "${taskLabel(task)}" | model: ${this.config.claude.modelOverride || task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = await getGitHead(this.config.claude.workdir);

      const failedAcUpdates = [];
      const onAcComplete = (acRef) => {
        if (acRef.type === 'numbered') {
          this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]).then(() => {
            this.logger.success(`AC completed: AC-${acRef.index}`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox AC-${acRef.index}: ${err.message}`);
            failedAcUpdates.push(acRef);
          });
        } else {
          this.boardClient.updateCheckboxes(task.id, [acRef.text]).then(() => {
            this.logger.success(`AC completed: "${acRef.text}"`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox "${acRef.text}": ${err.message}`);
            failedAcUpdates.push(acRef);
          });
        }
      };

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal, onAcComplete });

        // Retry any AC checkbox updates that failed during streaming
        if (failedAcUpdates.length > 0) {
          this.logger.info(`Retrying ${failedAcUpdates.length} failed AC update(s)...`);
          for (const acRef of failedAcUpdates) {
            try {
              if (acRef.type === 'numbered') {
                await this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]);
              } else {
                await this.boardClient.updateCheckboxes(task.id, [acRef.text]);
              }
              this.logger.success(`AC retry succeeded: AC-${acRef.index || acRef.text}`);
            } catch (retryErr) {
              this.logger.error(`AC retry failed: AC-${acRef.index || acRef.text}: ${retryErr.message}`);
            }
          }
        }

        await this._recordTaskUsage(task, execution);

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          // Emit consolidated completion bubble for failed execution
          const epicFailGroupId = `epic-task-exec-fail-${task.id}`;
          this.logger.progressive(
            'warn',
            epicFailGroupId,
            'complete',
            `Claude finished with issues: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`,
            { status: execution.status || 'unknown', details: formatContractForDisplay(execution) },
            buildContractJson(execution),
            true // feedEnabled
          );

          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
            break;
          }

          if (this.config.state.autoResetFailedTask) {
            await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${taskLabel(task)}"`);
          }

          break;
        }

        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        const validation = await validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${taskLabel(task)}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${taskLabel(task)}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${taskLabel(task)}"`, retryPrompt);
          }

          const retryHeadBefore = await getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal, onAcComplete });
          await this._recordTaskUsage(task, execution);

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            // Log contract to console only (details available in task markdown)
            console.debug('[orchestrator] Retry execution contract:', buildContractJson(execution));

            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          const retryValidation = await validateExecution(this.config.claude.workdir, retryHeadBefore, execution);
          if (!retryValidation.valid) {
            // Log contract to console only (details available in task markdown)
            console.debug('[orchestrator] Hallucination retry contract:', buildContractJson(execution));

            await this.runStore.markFailed(task, 'Hallucination persisted after retry. No artifacts produced.');
            this.logger.error(`Hallucination persisted after retry for "${taskLabel(task)}". Giving up.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }
        }

        this.logger.info(buildContractJson(execution));
        this.watchdog.recordSuccess(task.id);
        this.claudeCompletedTaskIds.set(task.id, Date.now());

        let finalExecution = execution;
        const effectiveChildModel = this.config.claude.modelOverride || task.model;
        const shouldReview = this.config.claude.opusReviewEnabled && !isOpusModel(effectiveChildModel);

        if (shouldReview) {
          try {
            finalExecution = await this.reviewWithOpus(task, markdown, execution);

            if (normalize(finalExecution.status) !== 'done') {
              const reviewNotes = buildTaskCompletionNotes(task, finalExecution);
              const header = `## Opus Review Feedback (${new Date().toISOString()})\nStatus: ${finalExecution.status || 'blocked'}\n`;
              await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
              await this.runStore.markFailed(task, `Opus review returned status=${finalExecution.status || 'blocked'}`);
              this.logger.warn(`Opus review blocked task: "${taskLabel(task)}" (status: ${finalExecution.status || 'blocked'})`);
              break;
            }

            this.logger.success(`Opus review approved: "${taskLabel(task)}"`);
          } catch (reviewError) {
            // Build detailed error note for task markdown
            const errorDetails = [];
            errorDetails.push(`**Error**: ${reviewError.message}`);
            if (reviewError.exitCode !== undefined) {
              errorDetails.push(`**Exit Code**: ${reviewError.exitCode}`);
            }
            if (reviewError.signal) {
              errorDetails.push(`**Signal**: ${reviewError.signal}`);
            }
            if (reviewError.stderr) {
              const stderrPreview = reviewError.stderr.slice(0, 500);
              errorDetails.push(`**Stderr**:\n\`\`\`\n${stderrPreview}${reviewError.stderr.length > 500 ? '\n...(truncated)' : ''}\n\`\`\``);
            }
            const errorNote = `## Opus Review Error (${new Date().toISOString()})\n${errorDetails.join('\n\n')}\n`;
            await this.boardClient.appendMarkdown(task.id, errorNote);
            await this.runStore.markFailed(task, `Opus review error: ${reviewError.message}`);

            if (isClaudeAuthError(reviewError)) {
              this.logger.error(
                'Claude authentication failed — token may be expired. Run `claude setup-token` to refresh credentials, then restart the API.',
                { expandableContent: { stderr: reviewError.stderr || null, exitCode: reviewError.exitCode ?? null } }
              );
              this.halted = true;
              break;
            }

            if (isClaudeLimitError(reviewError)) {
              this.haltForUsageLimit(reviewError.message, 'during Opus review');
              break;
            }

            // Log concise message to Live Feed; pass technical details for Debug Errors modal
            this.logger.error(`Opus review failed for "${taskLabel(task)}": ${reviewError.message}`, {
              expandableContent: {
                stderr: reviewError.stderr || null,
                stdout: reviewError.stdout || null,
                exitCode: reviewError.exitCode ?? null,
                signal: reviewError.signal || null
              }
            });

            const shouldHaltReview = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHaltReview) {
              this.halted = true;
            }

            break;
          }
        }

        // Apply collected per-AC completions from stdout as fallback
        // (in streaming mode, these were already applied in real-time via onAcComplete)
        if (Array.isArray(finalExecution.collectedAcIndices) && finalExecution.collectedAcIndices.length > 0) {
          await this.boardClient.updateCheckboxesByIndex(task.id, finalExecution.collectedAcIndices);
        }

        // Verify all ACs are checked before moving to Done
        const epicPostCheckMarkdown = await this.boardClient.getTaskMarkdown(task.id);
        const epicRemainingUnchecked = (epicPostCheckMarkdown.match(/^\s*-\s*\[ \]\s+/gm) || []).length;

        if (epicRemainingUnchecked > 0) {
          this.logger.warn(
            `Task "${taskLabel(task)}" has ${epicRemainingUnchecked} unchecked Acceptance Criteria. Triggering automatic AC fix.`
          );

          // Automatically trigger AC fix
          const fixSuccess = await this.triggerAcFix(task);

          if (!fixSuccess) {
            // Fix failed or timed out — mark task as failed and halt
            await this.runStore.markFailed(task, `${epicRemainingUnchecked} Acceptance Criteria still unchecked after execution. AC fix failed.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          // Fix succeeded — verify ACs again
          const postFixMarkdown = await this.boardClient.getTaskMarkdown(task.id);
          const postFixUnchecked = (postFixMarkdown.match(/^\s*-\s*\[ \]\s+/gm) || []).length;

          if (postFixUnchecked > 0) {
            this.logger.warn(
              `Task "${taskLabel(task)}" still has ${postFixUnchecked} unchecked ACs after fix. Keeping in In Progress.`
            );
            await this.runStore.markFailed(task, `${postFixUnchecked} Acceptance Criteria still unchecked after AC fix.`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          // All ACs now checked — proceed to Done
          this.logger.success(`AC fix completed successfully for "${taskLabel(task)}". All ACs now checked.`);
        }

        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
        this.claudeCompletedTaskIds.delete(task.id);
        autoRecovery.reset(task.id); // Reset recovery counter on success
        this.limitRetryCount = 0;   // Reset usage-limit retry counter on success
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${taskLabel(task)}"`, undefined, true);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);

        if (isClaudeAuthError(error)) {
          this.logger.error(
            'Claude authentication failed — token may be expired. Run `claude setup-token` to refresh credentials, then restart the API.',
            { expandableContent: { stderr: error.stderr || null, exitCode: error.exitCode ?? null } }
          );
          this.halted = true;
          break;
        }

        if (isClaudeLimitError(error)) {
          this.haltForUsageLimit(error.message);
          break;
        }

        this.logger.error(`Failed to execute task "${taskLabel(task)}": ${error.message}`, {
          expandableContent: {
            stderr: error.stderr || null,
            stdout: error.stdout || null,
            exitCode: error.exitCode ?? null,
            signal: error.signal || null,
            stack: error.stack || null
          }
        });

        const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
        if (shouldHalt) {
          this.halted = true;
          break;
        }

        if (this.config.state.autoResetFailedTask) {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
          this.logger.warn(`Returned to Not Started after failure: "${taskLabel(task)}"`);
        }

        break;
      } finally {
        this.currentTaskId = null;
        this.currentTaskName = null;
      }
    }

    const finalTasks = await this.boardClient.listTasks();
    this.observeStatuses(finalTasks);
    await this.closeCompletedEpics(finalTasks);

    const finalEpicReasons = Array.from(new Set(reason.split(', '))).join(', ');
    this.logger.success(`Epic reconciliation finished (epic: "${taskLabel(epic)}", processed: ${processed}, reason: ${finalEpicReasons})`);

    // If the epic was completed and moved to Done, schedule shutdown — but ONLY if this was an explicit "Run Epic" command
    const postCloseTasks = await this.boardClient.listTasks();
    const completedEpic = postCloseTasks.find(t => t.id === epic.id);
    if (completedEpic && normalize(completedEpic.status) === normalize(this.config.board.statuses.done)) {
      if (this.explicitEpicMode) {
        this.logger.success(`Epic "${taskLabel(epic)}" completed successfully. Scheduling auto-shutdown.`);

        // Schedule shutdown with a grace period to allow cancellation if new work arrives
        this.shutdownTimer = setTimeout(() => {
          // Final check: verify no work is running or pending
          if (this.running || this.pending || this.currentTaskId) {
            this.logger.info('Auto-shutdown cancelled (work in progress)');
            this.shutdownTimer = null;
            return;
          }

          this.logger.info(`Auto-shutdown triggered by: epic-completion (epic: "${taskLabel(epic)}")`);
          this.emit('shutdown-requested', { reason: 'epic-completion', epic: taskLabel(epic) });
        }, 3000); // 3 seconds grace period (increased from 1.5s for better safety)
      } else {
        this.logger.success(`Epic "${taskLabel(epic)}" completed successfully.`);
      }
    }
  }

  async reviewWithOpus(task, markdown, executionResult) {
    this.logger.info(`Starting Opus review for: "${taskLabel(task)}"`);

    const reviewPrompt = await buildReviewPrompt(task, markdown, executionResult);
    if (this.config.claude.logPrompt) {
      this.logger.block(`Opus review prompt for "${taskLabel(task)}"`, reviewPrompt);
    }

    this.logger.info(`Opus is reviewing: "${taskLabel(task)}" | model: ${OPUS_REVIEW_MODEL}`);

    const reviewStartTime = Date.now();
    const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });
    await this._recordTaskUsage(task, reviewExecution);
    const reviewElapsed = Date.now() - reviewStartTime;

    this.logger.info(`Opus review finished: "${taskLabel(task)}" (${formatDuration(reviewElapsed)})`);
    this.logger.info(buildContractJson(reviewExecution));

    return reviewExecution;
  }

  async triggerAcFix(task) {
    const panelPort = Number(process.env.PANEL_PORT || 4100);
    const apiBaseUrl = `http://localhost:${panelPort}`;

    this.logger.info(`Triggering AC fix for "${taskLabel(task)}" via panel API...`);

    try {
      // Step 1: Trigger the fix
      const response = await fetch(`${apiBaseUrl}/api/board/fix-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        this.logger.error(`AC fix request failed: ${payload?.message || response.statusText}`);
        return false;
      }

      // Step 2: Poll until fix completes or times out
      const MAX_WAIT_MS = 360000; // 6 minutes (AC_FIX_TIMEOUT_MS is 5 min in panelServer)
      const POLL_INTERVAL_MS = 2000; // Check every 2 seconds
      const startTime = Date.now();

      this.logger.info(`Waiting for AC fix to complete for "${taskLabel(task)}"...`);

      while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > MAX_WAIT_MS) {
          this.logger.error(`AC fix timed out after ${MAX_WAIT_MS / 1000}s for "${taskLabel(task)}"`);
          return false;
        }

        // Check if fix is still running
        const hasActiveFixes = await checkActiveFixes(panelPort);
        if (!hasActiveFixes) {
          // Fix completed — check final status
          const statusResponse = await fetch(`${apiBaseUrl}/api/board/fix-status`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });

          if (statusResponse.ok) {
            const statusData = await statusResponse.json().catch(() => ({}));
            const taskFixStatus = statusData.fixStatus?.[task.id];

            if (taskFixStatus?.status === 'success') {
              this.logger.success(`AC fix completed successfully for "${taskLabel(task)}"`);
              return true;
            }

            if (taskFixStatus?.status === 'failed') {
              this.logger.error(`AC fix failed for "${taskLabel(task)}": ${taskFixStatus.error || 'unknown error'}`);
              return false;
            }
          }

          // If we can't get status but no active fixes, assume success
          this.logger.success(`AC fix completed for "${taskLabel(task)}" (status unavailable, assuming success)`);
          return true;
        }

        // Fix still running — wait and poll again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      this.logger.error(`Failed to trigger AC fix: ${error.message}`);
      return false;
    }
  }

  async stampEpicChildrenStatuses(epic) {
    const freshTasks = await this.boardClient.listTasks();
    const children = freshTasks.filter(
      (t) => t.parentId === epic.id && !isEpicTask(t, freshTasks, this.config)
    );

    const sorted = sortCandidates(children, this.config.queue.order);

    for (let i = 0; i < sorted.length; i++) {
      const childStatus = i === 0
        ? this.config.board.statuses.inProgress
        : this.config.board.statuses.notStarted;
      await this.boardClient.updateTaskStatus(sorted[i].id, childStatus);
    }

    // Return info instead of logging (will be included in epic init bubble)
    if (sorted.length > 0) {
      return {
        count: sorted.length,
        firstTask: sorted.length > 0 ? taskLabel(sorted[0]) : null
      };
    }
    return null;
  }

  async closeCompletedEpics(tasks) {
    const doneStatus = normalize(this.config.board.statuses.done);

    for (const task of tasks) {
      if (!isEpicTask(task, tasks, this.config)) {
        continue;
      }

      if (normalize(task.status) === doneStatus) {
        continue;
      }

      const epicResult = allEpicChildrenAreDone(task, tasks, this.config);
      if (!epicResult.allDone) {
        continue;
      }

      // Verify all children's ACs are actually checked before closing the Epic
      const childrenWithUncheckedAcs = [];
      for (const child of epicResult.children) {
        const childMarkdown = await this.boardClient.getTaskMarkdown(child.id);
        const uncheckedCount = (childMarkdown.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
        if (uncheckedCount > 0) {
          childrenWithUncheckedAcs.push({
            name: child.name,
            id: child.id,
            unchecked: uncheckedCount
          });
        }
      }

      if (childrenWithUncheckedAcs.length > 0) {
        const details = childrenWithUncheckedAcs
          .map(c => `"${c.name}" (${c.unchecked} unchecked)`)
          .join(', ');
        this.logger.warn(
          `Epic "${taskLabel(task)}" has children with unchecked ACs: ${details}. Resetting to In Progress.`
        );

        // Reset these children back to In Progress so they can be re-executed
        for (const child of childrenWithUncheckedAcs) {
          await this.boardClient.updateTaskStatus(child.id, this.config.board.statuses.inProgress);
          this.logger.info(`Reset "${child.name}" from Done to In Progress (${child.unchecked} ACs unchecked)`);
        }

        continue;
      }

      const summary = await this.runStore.getEpicSummary(epicResult.children);

      if (this.config.claude.epicReviewEnabled) {
        this.currentTaskId = task.id;
        this.currentTaskName = taskLabel(task);

        try {
          const reviewPrompt = buildEpicReviewPrompt(task, epicResult.children, summary);
          const groupId = `epic-review-${task.id}`;

          // Emit consolidated start log with expandable prompt
          this.logger.progressive(
            'info',
            groupId,
            'start',
            `Epic review for: "${taskLabel(task)}" (${epicResult.children.length} children)`,
            { model: OPUS_REVIEW_MODEL },
            this.config.claude.logPrompt ? reviewPrompt : null,
            true // feedEnabled
          );

          const epicReviewStartTime = Date.now();
          const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });
          await this._recordTaskUsage(task, reviewExecution);
          const epicReviewElapsed = Date.now() - epicReviewStartTime;

          // Emit completion update for the same group
          this.logger.progressive(
            'info',
            groupId,
            'complete',
            `Epic review for: "${taskLabel(task)}" (${epicResult.children.length} children)`,
            {
              model: OPUS_REVIEW_MODEL,
              duration: formatDuration(epicReviewElapsed)
            },
            null, // no expandableContent
            true // feedEnabled
          );

          if (normalize(reviewExecution.status) !== 'done') {
            const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
            const header = `## Epic Review Feedback (${new Date().toISOString()})\nStatus: ${reviewExecution.status || 'blocked'}\n`;
            await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
            this.logger.warn(`Epic review blocked: "${taskLabel(task)}" (status: ${reviewExecution.status || 'blocked'})`);
            return;
          }

          // Don't log approval here - we'll consolidate it with the children update below

          const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
          await this.boardClient.appendMarkdown(task.id, `## Epic Review Approved (${new Date().toISOString()})\n` + reviewNotes);
        } catch (reviewError) {
          // Build detailed error note for task markdown
          const errorDetails = [];
          errorDetails.push(`**Error**: ${reviewError.message}`);
          if (reviewError.exitCode !== undefined) {
            errorDetails.push(`**Exit Code**: ${reviewError.exitCode}`);
          }
          if (reviewError.signal) {
            errorDetails.push(`**Signal**: ${reviewError.signal}`);
          }
          if (reviewError.stderr) {
            const stderrPreview = reviewError.stderr.slice(0, 500);
            errorDetails.push(`**Stderr**:\n\`\`\`\n${stderrPreview}${reviewError.stderr.length > 500 ? '\n...(truncated)' : ''}\n\`\`\``);
          }
          const errorNote = `## Epic Review Error (${new Date().toISOString()})\n${errorDetails.join('\n\n')}\n`;
          await this.boardClient.appendMarkdown(task.id, errorNote);

          if (isClaudeAuthError(reviewError)) {
            this.logger.error(
              'Claude authentication failed — token may be expired. Run `claude setup-token` to refresh credentials, then restart the API.',
              { expandableContent: { stderr: reviewError.stderr || null, exitCode: reviewError.exitCode ?? null } }
            );
            this.halted = true;
            return;
          }

          if (isClaudeLimitError(reviewError)) {
            this.haltForUsageLimit(reviewError.message, 'during Epic review');
            return;
          }

          // Log concise message to Live Feed; pass technical details for Debug Errors modal
          this.logger.error(`Epic review failed for "${taskLabel(task)}": ${reviewError.message}`, {
            expandableContent: {
              stderr: reviewError.stderr || null,
              stdout: reviewError.stdout || null,
              exitCode: reviewError.exitCode ?? null,
              signal: reviewError.signal || null
            }
          });

          const shouldHaltEpic = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHaltEpic) {
            this.halted = true;
          }

          return;
        } finally {
          this.currentTaskId = null;
          this.currentTaskName = null;
        }
      }

      // Update all children to status: Done in frontmatter before moving the Epic folder
      for (const child of epicResult.children) {
        await this.boardClient.updateTaskStatus(child.id, this.config.board.statuses.done);
      }

      // Log consolidated success message with children update info
      this.logger.success(
        `Epic review approved: "${taskLabel(task)}" — Updated ${epicResult.children.length} ${epicResult.children.length === 1 ? 'child' : 'children'} to Done status`
      );

      await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
      autoRecovery.resetEpic(task.id); // Reset epic recovery counter on success
      this.limitRetryCount = 0;        // Reset usage-limit retry counter on success

      const summaryMarkdown = buildEpicSummary(task, summary);
      await this.boardClient.appendMarkdown(task.id, summaryMarkdown);

      this.logger.success(`Epic moved to Done automatically: "${taskLabel(task)}" (children: ${epicResult.children.length})`);
    }
  }
}
