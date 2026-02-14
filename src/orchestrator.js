import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runClaudeTask } from './claudeRunner.js';
import { buildEpicReviewPrompt, buildEpicSummary, buildRetryPrompt, buildReviewPrompt, buildTaskCompletionNotes, buildTaskPrompt, formatDuration } from './promptBuilder.js';
import { allEpicChildrenAreDone, hasIncompleteEpic, isEpicTask, pickNextEpic, pickNextEpicChild, pickNextTask, sortCandidates } from './selectTask.js';
import { Watchdog } from './watchdog.js';

function normalize(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

const OPUS_REVIEW_MODEL = 'claude-opus-4-6';

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

export class Orchestrator {
  constructor({ config, logger, boardClient, runStore }) {
    this.config = config;
    this.logger = logger;
    this.boardClient = boardClient;
    this.runStore = runStore;

    this.running = false;
    this.timer = null;
    this.pending = false;
    this.pendingReasons = [];
    this.pendingMode = 'normal';
    this.currentTaskId = null;
    this.lastKnownStatusByTaskId = new Map();
    this.claudeCompletedTaskIds = new Map();
    this.watchdog = new Watchdog({ config, logger });
    this.halted = false;
  }

  schedule(reason, options = {}) {
    if (this.halted) {
      this.logger.warn('Orchestrator halted. Ignoring schedule request.');
      return;
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
          await this.reconcileEpic(reason);
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
      queuedReasons: this.pendingReasons,
      halted: this.halted
    };
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
    this.logger.info(`Starting board reconciliation (reason: ${reason})`);

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
        this.logger.warn(`Task "${task.name}" was already completed by Claude but is still on the board. Retrying status update.`);
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
          this.logger.success(`Board status update recovered for: "${task.name}"`);
        } catch (retryError) {
          this.logger.error(`Board status update retry failed for "${task.name}": ${retryError.message}`);
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
        this.logger.info(`Moved to In Progress: "${task.name}"`);
      } else {
        await this.runStore.markStarted(task);
        this.logger.info(`Resuming In Progress task: "${task.name}"`);
      }

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${task.name}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.logger.info(`Claude is working on: "${task.name}" | model: ${task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = getGitHead(this.config.claude.workdir);

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal });

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);
          this.logger.info(buildContractJson(execution));
          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${task.name}" (status: ${execution.status || 'unknown'})`);

          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
            break;
          }

          if (this.config.state.autoResetFailedTask) {
            await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${task.name}"`);
          }

          break;
        }

        this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);

        const validation = validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${task.name}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${task.name}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${task.name}"`, retryPrompt);
          }

          const retryHeadBefore = getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal });

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${task.name}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            this.logger.info(buildContractJson(execution));
            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${task.name}" (status: ${execution.status || 'unknown'})`);

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
            this.logger.error(`Hallucination persisted after retry for "${task.name}". Giving up.`);

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
        const shouldReview = this.config.claude.opusReviewEnabled && !isOpusModel(task.model);

        if (shouldReview) {
          try {
            finalExecution = await this.reviewWithOpus(task, markdown, execution);

            if (normalize(finalExecution.status) !== 'done') {
              const reviewNotes = buildTaskCompletionNotes(task, finalExecution);
              const header = `## Opus Review Feedback (${new Date().toISOString()})\nStatus: ${finalExecution.status || 'blocked'}\n`;
              await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
              await this.runStore.markFailed(task, `Opus review returned status=${finalExecution.status || 'blocked'}`);
              this.logger.warn(`Opus review blocked task: "${task.name}" (status: ${finalExecution.status || 'blocked'})`);
              break;
            }

            this.logger.success(`Opus review approved: "${task.name}"`);
          } catch (reviewError) {
            const errorNote = `## Opus Review Error (${new Date().toISOString()})\nReview failed: ${reviewError.message}\n`;
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

            this.logger.error(`Opus review failed for "${task.name}": ${reviewError.message}`);

            const shouldHaltReview = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHaltReview) {
              this.halted = true;
            }

            break;
          }
        }

        await this.boardClient.updateCheckboxes(task.id, finalExecution.completedAcs);
        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
        this.claudeCompletedTaskIds.delete(task.id);
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${task.name}"`);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
          );
          this.halted = true;
          break;
        }

        this.logger.error(`Failed to execute task "${task.name}": ${error.message}`);

        const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
        if (shouldHalt) {
          this.halted = true;
          break;
        }

        if (this.config.state.autoResetFailedTask) {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
          this.logger.warn(`Returned to Not Started after failure: "${task.name}"`);
        }

        break;
      } finally {
        this.currentTaskId = null;
      }
    }

    const finalTasks = await this.boardClient.listTasks();
    this.observeStatuses(finalTasks);
    await this.closeCompletedEpics(finalTasks);

    this.logger.success(`Reconciliation finished (processed: ${processed}, reason: ${reason})`);
  }

  async reconcileEpic(reason) {
    this.logger.info(`Starting epic reconciliation (reason: ${reason})`);

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
      this.logger.info(`Epic moved to In Progress: "${epic.name}"`);

      await this.stampEpicChildrenStatuses(epic, tasks);
    } else {
      this.logger.info(`Resuming In Progress epic: "${epic.name}"`);
    }

    let processed = 0;

    for (let iteration = 0; iteration < this.config.queue.maxTasksPerRun; iteration += 1) {
      const currentTasks = await this.boardClient.listTasks();
      this.observeStatuses(currentTasks);

      const childCandidate = pickNextEpicChild(currentTasks, this.config, epic.id);
      if (!childCandidate) {
        this.logger.info(`All children of epic "${epic.name}" are done or none remain.`);
        break;
      }

      const task = childCandidate.task;
      const source = childCandidate.source;

      if (this.claudeCompletedTaskIds.has(task.id)) {
        this.logger.warn(`Task "${task.name}" was already completed by Claude but is still on the board. Retrying status update.`);
        try {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
          this.claudeCompletedTaskIds.delete(task.id);
          this.logger.success(`Board status update recovered for: "${task.name}"`);
        } catch (retryError) {
          this.logger.error(`Board status update retry failed for "${task.name}": ${retryError.message}`);
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
        this.logger.info(`Moved to In Progress: "${task.name}" (epic child)`);
      } else {
        await this.runStore.markStarted(task);
        this.logger.info(`Resuming In Progress task: "${task.name}" (epic child)`);
      }

      const markdown = await this.boardClient.getTaskMarkdown(task.id);
      const prompt = buildTaskPrompt(task, markdown, {
        extraPrompt: this.config.claude.extraPrompt,
        forceTestCreation: this.config.claude.forceTestCreation,
        forceTestRun: this.config.claude.forceTestRun,
        forceCommit: this.config.claude.forceCommit
      });
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${task.name}"`, prompt);
      }

      this.currentTaskId = task.id;
      this.logger.info(`Claude is working on: "${task.name}" | model: ${task.model || 'default'}`);

      const { signal } = this.watchdog.start(task);
      const executionStartTime = Date.now();
      const headBefore = getGitHead(this.config.claude.workdir);

      try {
        let execution = await runClaudeTask(task, prompt, this.config, { signal });

        this.watchdog.stop();
        let executionElapsed = Date.now() - executionStartTime;

        if (normalize(execution.status) !== 'done') {
          this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);
          this.logger.info(buildContractJson(execution));
          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${task.name}" (status: ${execution.status || 'unknown'})`);

          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
            break;
          }

          if (this.config.state.autoResetFailedTask) {
            await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${task.name}"`);
          }

          break;
        }

        this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);

        const validation = validateExecution(this.config.claude.workdir, headBefore, execution);
        if (!validation.valid) {
          this.logger.warn(`Hallucination detected for "${task.name}": ${validation.reason}`);
          this.logger.warn(`Retrying task "${task.name}" with corrective prompt...`);

          const retryPrompt = buildRetryPrompt(task, prompt);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Retry prompt for "${task.name}"`, retryPrompt);
          }

          const retryHeadBefore = getGitHead(this.config.claude.workdir);
          const { signal: retrySignal } = this.watchdog.start(task);
          const retryStartTime = Date.now();

          execution = await runClaudeTask(task, retryPrompt, this.config, { signal: retrySignal });

          this.watchdog.stop();
          executionElapsed = Date.now() - retryStartTime;
          this.logger.info(`Claude retry finished: "${task.name}" (${formatDuration(executionElapsed)})`);

          if (normalize(execution.status) !== 'done') {
            this.logger.info(buildContractJson(execution));
            await this.runStore.markFailed(task, `Retry also returned status=${execution.status || 'unknown'}`);
            this.logger.warn(`Task blocked on retry: "${task.name}" (status: ${execution.status || 'unknown'})`);

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
            this.logger.error(`Hallucination persisted after retry for "${task.name}". Giving up.`);

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
        const shouldReview = this.config.claude.opusReviewEnabled && !isOpusModel(task.model);

        if (shouldReview) {
          try {
            finalExecution = await this.reviewWithOpus(task, markdown, execution);

            if (normalize(finalExecution.status) !== 'done') {
              const reviewNotes = buildTaskCompletionNotes(task, finalExecution);
              const header = `## Opus Review Feedback (${new Date().toISOString()})\nStatus: ${finalExecution.status || 'blocked'}\n`;
              await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
              await this.runStore.markFailed(task, `Opus review returned status=${finalExecution.status || 'blocked'}`);
              this.logger.warn(`Opus review blocked task: "${task.name}" (status: ${finalExecution.status || 'blocked'})`);
              break;
            }

            this.logger.success(`Opus review approved: "${task.name}"`);
          } catch (reviewError) {
            const errorNote = `## Opus Review Error (${new Date().toISOString()})\nReview failed: ${reviewError.message}\n`;
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

            this.logger.error(`Opus review failed for "${task.name}": ${reviewError.message}`);

            const shouldHaltReview = this.watchdog.recordFailure(task.id, task.name);
            if (shouldHaltReview) {
              this.halted = true;
            }

            break;
          }
        }

        await this.boardClient.updateCheckboxes(task.id, finalExecution.completedAcs);
        await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);
        this.claudeCompletedTaskIds.delete(task.id);
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.boardClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${task.name}" (epic child)`);
      } catch (error) {
        this.watchdog.stop();
        const executionElapsed = Date.now() - executionStartTime;
        this.logger.info(`Claude finished: "${task.name}" (${formatDuration(executionElapsed)})`);

        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
          );
          this.halted = true;
          break;
        }

        this.logger.error(`Failed to execute task "${task.name}": ${error.message}`);

        const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
        if (shouldHalt) {
          this.halted = true;
          break;
        }

        if (this.config.state.autoResetFailedTask) {
          await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.notStarted);
          this.logger.warn(`Returned to Not Started after failure: "${task.name}"`);
        }

        break;
      } finally {
        this.currentTaskId = null;
      }
    }

    const finalTasks = await this.boardClient.listTasks();
    this.observeStatuses(finalTasks);
    await this.closeCompletedEpics(finalTasks);

    this.logger.success(`Epic reconciliation finished (epic: "${epic.name}", processed: ${processed}, reason: ${reason})`);
  }

  async reviewWithOpus(task, markdown, executionResult) {
    this.logger.info(`Starting Opus review for: "${task.name}"`);

    const reviewPrompt = buildReviewPrompt(task, markdown, executionResult);
    if (this.config.claude.logPrompt) {
      this.logger.block(`Opus review prompt for "${task.name}"`, reviewPrompt);
    }

    this.logger.info(`Opus is reviewing: "${task.name}" | model: ${OPUS_REVIEW_MODEL}`);

    const reviewStartTime = Date.now();
    const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });
    const reviewElapsed = Date.now() - reviewStartTime;

    this.logger.info(`Opus review finished: "${task.name}" (${formatDuration(reviewElapsed)})`);
    this.logger.info(buildContractJson(reviewExecution));

    return reviewExecution;
  }

  async stampEpicChildrenStatuses(epic, previousTasks) {
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
      this.logger.info(`Stamped ${sorted.length} children for epic "${epic.name}" (first: In Progress, rest: Not Started)`);
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

      const summary = await this.runStore.getEpicSummary(epicResult.children);

      if (this.config.claude.epicReviewEnabled) {
        this.currentTaskId = task.id;

        try {
          this.logger.info(`Starting Epic review for: "${task.name}" (${epicResult.children.length} children)`);

          const reviewPrompt = buildEpicReviewPrompt(task, epicResult.children, summary);
          if (this.config.claude.logPrompt) {
            this.logger.block(`Epic review prompt for "${task.name}"`, reviewPrompt);
          }

          this.logger.info(`Opus is reviewing epic: "${task.name}" | model: ${OPUS_REVIEW_MODEL}`);

          const epicReviewStartTime = Date.now();
          const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });
          const epicReviewElapsed = Date.now() - epicReviewStartTime;

          this.logger.info(`Opus epic review finished: "${task.name}" (${formatDuration(epicReviewElapsed)})`);

          if (normalize(reviewExecution.status) !== 'done') {
            const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
            const header = `## Epic Review Feedback (${new Date().toISOString()})\nStatus: ${reviewExecution.status || 'blocked'}\n`;
            await this.boardClient.appendMarkdown(task.id, header + reviewNotes);
            this.logger.warn(`Epic review blocked: "${task.name}" (status: ${reviewExecution.status || 'blocked'})`);
            return;
          }

          this.logger.success(`Epic review approved: "${task.name}"`);

          const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
          await this.boardClient.appendMarkdown(task.id, `## Epic Review Approved (${new Date().toISOString()})\n` + reviewNotes);
        } catch (reviewError) {
          const errorNote = `## Epic Review Error (${new Date().toISOString()})\nReview failed: ${reviewError.message}\n`;
          await this.boardClient.appendMarkdown(task.id, errorNote);

          if (isClaudeLimitError(reviewError.message)) {
            const resetHint = extractResetHint(reviewError.message);
            this.logger.warn(
              `Claude usage limit reached during Epic review. Orchestrator halted until ${resetHint || 'unknown reset time'}.`
            );
            this.halted = true;
            return;
          }

          this.logger.error(`Epic review failed for "${task.name}": ${reviewError.message}`);

          const shouldHaltEpic = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHaltEpic) {
            this.halted = true;
          }

          return;
        } finally {
          this.currentTaskId = null;
        }
      }

      await this.boardClient.updateTaskStatus(task.id, this.config.board.statuses.done);

      const summaryMarkdown = buildEpicSummary(task, summary);
      await this.boardClient.appendMarkdown(task.id, summaryMarkdown);

      this.logger.success(`Epic moved to Done automatically: "${task.name}" (children: ${epicResult.children.length})`);
    }
  }
}
