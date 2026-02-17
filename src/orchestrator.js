import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
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

function isClaudeLimitError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes("you've hit your limit") ||
    text.includes('hit your limit') ||
    text.includes('quota') ||
    text.includes('usage limit')
  );
}

function extractResetHint(message) {
  const text = String(message || '');
  const match = text.match(/resets?[^)\n]*\)?/i);
  return match ? match[0] : null;
}

function getGitHead(workdir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function hasGitChanges(workdir, headBefore) {
  try {
    const status = execSync('git status --porcelain', { cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (status) {
      return true;
    }

    if (headBefore) {
      const headAfter = execSync('git rev-parse HEAD', { cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (headAfter !== headBefore) {
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

function validateExecution(workdir, headBefore, execution) {
  const gitChanged = hasGitChanges(workdir, headBefore);
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

export class Orchestrator {
  constructor({ config, logger, boardClient, runStore, usageStore }) {
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
  }

  async _recordTaskUsage(task, execution) {
    if (this.usageStore && execution && execution.usage) {
      try {
        await this.usageStore.recordUsage(task.id, task.name, execution.usage);
      } catch (err) {
        this.logger.warn(`Failed to record token usage: ${err.message}`);
      }
    }
  }

  schedule(reason, options = {}) {
    if (this.halted) {
      this.logger.warn('Orchestrator halted. Ignoring schedule request.');
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
      mode: this.pendingMode
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
    this.logger.info('Orchestrator resumed. Task execution can now proceed.');
    return true;
  }

  resume() {
    if (!this.halted) {
      return false;
    }

    this.halted = false;
    this.logger.info('Orchestrator resumed from halted state.');
    return true;
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

    // Deduplicate reasons for cleaner logs
    const uniqueReasons = Array.from(new Set(reason.split(', '))).join(', ');
    this.logger.info(`Starting board reconciliation (reason: ${uniqueReasons})`);

    // Check for incomplete epics first — they must be finished before standalone tasks.
    const initialTasks = await this.boardClient.listTasks();
    this.observeStatuses(initialTasks);
    await this.closeCompletedEpics(initialTasks);

    if (hasIncompleteEpic(initialTasks, this.config)) {
      this.logger.info('Incomplete epic detected — delegating to epic reconciliation.');
      await this.reconcileEpic(reason);
      return;
    }

    let processed = 0;

    for (let iteration = 0; iteration < limit; iteration += 1) {
      const tasks = await this.boardClient.listTasks();
      this.observeStatuses(tasks);
      await this.closeCompletedEpics(tasks);

      // Re-check after closing epics — a new epic may now be the next priority.
      if (hasIncompleteEpic(tasks, this.config)) {
        this.logger.info('Incomplete epic detected mid-reconciliation — delegating to epic reconciliation.');
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
        this.logger.warn(`Task "${taskLabel(task)}" was already completed by Claude but is still on the board. Retrying status update.`);
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
          this.logger.success(`Board status update recovered for: "${taskLabel(task)}"`);
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
        await this.runStore.markStarted(task);
        this.logger.info(`Moved to In Progress: "${taskLabel(task)}"`);
      } else {
        await this.runStore.markStarted(task);
        this.logger.info(`Resuming In Progress Task: "${taskLabel(task)}"`);
      }

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${taskLabel(task)}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.currentTaskName = taskLabel(task);
      this.logger.info(`Claude is working on: "${taskLabel(task)}" | model: ${this.config.claude.modelOverride || task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = getGitHead(this.config.claude.workdir);

      const onAcComplete = (acRef) => {
        this.logger.info(`[DEBUG] onAcComplete called with: ${JSON.stringify(acRef)}`);
        if (acRef.type === 'numbered') {
          this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]).then(() => {
            this.logger.success(`AC completed: AC-${acRef.index}`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox: ${err.message}`);
          });
        } else {
          this.boardClient.updateCheckboxes(task.id, [acRef.text]).then(() => {
            this.logger.success(`AC completed: "${acRef.text}"`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox: ${err.message}`);
          });
        }
      };

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal, onAcComplete });
        await this._recordTaskUsage(task, execution);

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);
          this.logger.info(buildContractJson(execution));

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

        const validation = validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${taskLabel(task)}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${taskLabel(task)}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${taskLabel(task)}"`, retryPrompt);
          }

          const retryHeadBefore = getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal, onAcComplete });
          await this._recordTaskUsage(task, execution);

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            this.logger.info(buildContractJson(execution));
            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          const retryValidation = validateExecution(this.config.claude.workdir, retryHeadBefore, execution);
          if (!retryValidation.valid) {
            this.logger.info(buildContractJson(execution));
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

            if (isClaudeLimitError(reviewError.message)) {
              const resetHint = extractResetHint(reviewError.message);
              this.logger.warn(
                `Claude usage limit reached during Opus review. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
              );
              this.halted = true;
              break;
            }

            // Log concise message to Live Feed
            this.logger.error(`Opus review failed for "${taskLabel(task)}": ${reviewError.message}`);

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
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${taskLabel(task)}"`);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
          );
          this.halted = true;
          break;
        }

        this.logger.error(`Failed to execute task "${taskLabel(task)}": ${error.message}`);

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

    // Deduplicate reasons for cleaner logs
    const uniqueReasons = Array.from(new Set(reason.split(', '))).join(', ');
    this.logger.info(`Starting epic reconciliation (reason: ${uniqueReasons})`);

    const tasks = await this.boardClient.listTasks();
    this.observeStatuses(tasks);

    const epicCandidate = pickNextEpic(tasks, this.config);
    if (!epicCandidate) {
      this.logger.info('No epic found to run.');
      return;
    }

    const epic = epicCandidate.task;

    if (epicCandidate.source === 'not_started') {
      await this.boardClient.updateTaskStatus(epic.id, this.config.board.statuses.inProgress);
      this.logger.info(`Epic moved to In Progress: "${taskLabel(epic)}"`);

      await this.stampEpicChildrenStatuses(epic);
    } else {
      this.logger.info(`Resuming In Progress Epic: "${taskLabel(epic)}"`);
    }

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
        this.logger.warn(`Task "${taskLabel(task)}" was already completed by Claude but is still on the board. Retrying status update.`);
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
          this.logger.success(`Board status update recovered for: "${taskLabel(task)}"`);
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
        await this.runStore.markStarted(task);
        this.logger.info(`Moved to In Progress: "${taskLabel(task)}"`);
      } else {
        await this.runStore.markStarted(task);
        this.logger.info(`Resuming In Progress Task: "${taskLabel(task)}"`);
      }

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${taskLabel(task)}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.currentTaskName = taskLabel(task);
      this.logger.info(`Claude is working on: "${taskLabel(task)}" | model: ${this.config.claude.modelOverride || task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = getGitHead(this.config.claude.workdir);

      const onAcComplete = (acRef) => {
        this.logger.info(`[DEBUG] onAcComplete called with: ${JSON.stringify(acRef)}`);
        if (acRef.type === 'numbered') {
          this.boardClient.updateCheckboxesByIndex(task.id, [acRef.index]).then(() => {
            this.logger.success(`AC completed: AC-${acRef.index}`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox: ${err.message}`);
          });
        } else {
          this.boardClient.updateCheckboxes(task.id, [acRef.text]).then(() => {
            this.logger.success(`AC completed: "${acRef.text}"`);
          }).catch((err) => {
            this.logger.warn(`Failed to update AC checkbox: ${err.message}`);
          });
        }
      };

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal, onAcComplete });
        await this._recordTaskUsage(task, execution);

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);
          this.logger.info(buildContractJson(execution));
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

        const validation = validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${taskLabel(task)}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${taskLabel(task)}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${taskLabel(task)}"`, retryPrompt);
          }

          const retryHeadBefore = getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal, onAcComplete });
          await this._recordTaskUsage(task, execution);

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            this.logger.info(buildContractJson(execution));
            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${taskLabel(task)}" (status: ${execution.status || 'unknown'})`);

            const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHalt) {
              this.halted = true;
            }
            break;
          }

          const retryValidation = validateExecution(this.config.claude.workdir, retryHeadBefore, execution);
          if (!retryValidation.valid) {
            this.logger.info(buildContractJson(execution));
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

            if (isClaudeLimitError(reviewError.message)) {
              const resetHint = extractResetHint(reviewError.message);
              this.logger.warn(
                `Claude usage limit reached during Opus review. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
              );
              this.halted = true;
              break;
            }

            // Log concise message to Live Feed
            this.logger.error(`Opus review failed for "${taskLabel(task)}": ${reviewError.message}`);

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
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${taskLabel(task)}"`);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${taskLabel(task)}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
          );
          this.halted = true;
          break;
        }

        this.logger.error(`Failed to execute task "${taskLabel(task)}": ${error.message}`);

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
          process.exit(0);
        }, 3000); // 3 seconds grace period (increased from 1.5s for better safety)
      } else {
        this.logger.success(`Epic "${taskLabel(epic)}" completed successfully.`);
      }
    }
  }

  async reviewWithOpus(task, markdown, executionResult) {
    this.logger.info(`Starting Opus review for: "${taskLabel(task)}"`);

    const reviewPrompt = buildReviewPrompt(task, markdown, executionResult);
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

    if (sorted.length > 0) {
      this.logger.info(`Stamped ${sorted.length} children for epic "${taskLabel(epic)}" (first: In Progress, rest: Not Started)`);
    }
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
            this.config.claude.logPrompt ? reviewPrompt : null
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
            }
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

          if (isClaudeLimitError(reviewError.message)) {
            const resetHint = extractResetHint(reviewError.message);
            this.logger.warn(
              `Claude usage limit reached during Epic review. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
            );
            this.halted = true;
            return;
          }

          // Log concise message to Live Feed
          this.logger.error(`Epic review failed for "${taskLabel(task)}": ${reviewError.message}`);

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

      const summaryMarkdown = buildEpicSummary(task, summary);
      await this.boardClient.appendMarkdown(task.id, summaryMarkdown);

      this.logger.success(`Epic moved to Done automatically: "${taskLabel(task)}" (children: ${epicResult.children.length})`);
    }
  }
}
