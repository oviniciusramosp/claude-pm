import { runClaudeTask } from './claudeRunner.js';
import { buildEpicReviewPrompt, buildEpicSummary, buildReviewPrompt, buildTaskCompletionNotes, buildTaskPrompt } from './promptBuilder.js';
import { allEpicChildrenAreDone, isEpicTask, pickNextTask } from './selectTask.js';
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

export class Orchestrator {
  constructor({ config, logger, notionClient, runStore }) {
    this.config = config;
    this.logger = logger;
    this.notionClient = notionClient;
    this.runStore = runStore;

    this.running = false;
    this.timer = null;
    this.pending = false;
    this.pendingReasons = [];
    this.currentTaskId = null;
    this.lastKnownStatusByTaskId = new Map();
    this.watchdog = new Watchdog({ config, logger });
    this.halted = false;
  }

  schedule(reason) {
    if (this.halted) {
      this.logger.warn('Orchestrator halted. Ignoring schedule request.');
      return;
    }

    this.pendingReasons.push(reason);

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
        await this.reconcile(reason);
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

  async reconcile(reason) {
    this.logger.info(`Starting board reconciliation (reason: ${reason})`);

    let processed = 0;

    for (let iteration = 0; iteration < this.config.queue.maxTasksPerRun; iteration += 1) {
      const tasks = await this.notionClient.listTasks();
      this.observeStatuses(tasks);
      await this.closeCompletedEpics(tasks);

      const candidate = pickNextTask(tasks, this.config);
      if (!candidate) {
        break;
      }

      const task = candidate.task;
      const source = candidate.source;

      if (source === 'not_started') {
        await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.inProgress);
        await this.runStore.markStarted(task);
        this.logger.info(`Moved to In Progress: "${task.name}"`);
      } else {
        await this.runStore.markStarted(task);
        this.logger.info(`Resuming In Progress task: "${task.name}"`);
      }

      const markdown = await this.notionClient.getTaskMarkdown(task.id);
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

      if (task.model) {
        this.logger.info(`Using model: ${task.model}`);
      }

      const { signal } = this.watchdog.start(task);

      try {
        const execution = await runClaudeTask(task, prompt, this.config, { signal });

        this.watchdog.stop();

        if (normalize(execution.status) !== 'done') {
          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${task.name}" (status: ${execution.status || 'unknown'})`);

          const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
          if (shouldHalt) {
            this.halted = true;
            break;
          }

          if (this.config.state.autoResetFailedTask) {
            await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${task.name}"`);
          }

          break;
        }

        this.watchdog.recordSuccess(task.id);

        let finalExecution = execution;
        const shouldReview = this.config.claude.opusReviewEnabled && !isOpusModel(task.model);

        if (shouldReview) {
          try {
            finalExecution = await this.reviewWithOpus(task, markdown, execution);

            if (normalize(finalExecution.status) !== 'done') {
              const reviewNotes = buildTaskCompletionNotes(task, finalExecution);
              const header = `## Opus Review Feedback (${new Date().toISOString()})\nStatus: ${finalExecution.status || 'blocked'}\n`;
              await this.notionClient.appendMarkdown(task.id, header + reviewNotes);
              await this.runStore.markFailed(task, `Opus review returned status=${finalExecution.status || 'blocked'}`);
              this.logger.warn(`Opus review blocked task: "${task.name}" (status: ${finalExecution.status || 'blocked'})`);
              break;
            }

            this.logger.success(`Opus review approved: "${task.name}"`);
          } catch (reviewError) {
            const errorNote = `## Opus Review Error (${new Date().toISOString()})\nReview failed: ${reviewError.message}\n`;
            await this.notionClient.appendMarkdown(task.id, errorNote);
            await this.runStore.markFailed(task, `Opus review error: ${reviewError.message}`);

            if (isClaudeLimitError(reviewError.message)) {
              const resetHint = extractResetHint(reviewError.message);
              this.logger.warn(
                `Claude usage limit reached during Opus review. Queue paused until ${resetHint || 'unknown reset time'}.`
              );
            } else {
              this.logger.error(`Opus review failed for "${task.name}": ${reviewError.message}`);
            }

            break;
          }
        }

        await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.done);
        const completionNotes = buildTaskCompletionNotes(task, finalExecution);
        await this.notionClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, finalExecution);
        processed += 1;

        this.logger.success(`Moved to Done: "${task.name}"`);
      } catch (error) {
        this.watchdog.stop();

        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Queue paused until ${resetHint || 'unknown reset time'}.`
          );
        } else {
          this.logger.error(`Failed to execute task "${task.name}": ${error.message}`);
        }

        const shouldHalt = this.watchdog.recordFailure(task.id, task.name);
        if (shouldHalt) {
          this.halted = true;
          break;
        }

        if (this.config.state.autoResetFailedTask) {
          await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.notStarted);
          this.logger.warn(`Returned to Not Started after failure: "${task.name}"`);
        }

        break;
      } finally {
        this.currentTaskId = null;
      }
    }

    const finalTasks = await this.notionClient.listTasks();
    this.observeStatuses(finalTasks);
    await this.closeCompletedEpics(finalTasks);

    this.logger.success(`Reconciliation finished (processed: ${processed}, reason: ${reason})`);
  }

  async reviewWithOpus(task, markdown, executionResult) {
    this.logger.info(`Starting Opus review for: "${task.name}"`);

    const reviewPrompt = buildReviewPrompt(task, markdown, executionResult);
    if (this.config.claude.logPrompt) {
      this.logger.block(`Opus review prompt for "${task.name}"`, reviewPrompt);
    }

    this.logger.info(`Review model: ${OPUS_REVIEW_MODEL}`);

    const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });

    return reviewExecution;
  }

  async closeCompletedEpics(tasks) {
    const doneStatus = normalize(this.config.notion.statuses.done);

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

          this.logger.info(`Epic review model: ${OPUS_REVIEW_MODEL}`);
          const reviewExecution = await runClaudeTask(task, reviewPrompt, this.config, { overrideModel: OPUS_REVIEW_MODEL });

          if (normalize(reviewExecution.status) !== 'done') {
            const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
            const header = `## Epic Review Feedback (${new Date().toISOString()})\nStatus: ${reviewExecution.status || 'blocked'}\n`;
            await this.notionClient.appendMarkdown(task.id, header + reviewNotes);
            this.logger.warn(`Epic review blocked: "${task.name}" (status: ${reviewExecution.status || 'blocked'})`);
            return;
          }

          this.logger.success(`Epic review approved: "${task.name}"`);

          const reviewNotes = buildTaskCompletionNotes(task, reviewExecution);
          await this.notionClient.appendMarkdown(task.id, `## Epic Review Approved (${new Date().toISOString()})\n` + reviewNotes);
        } catch (reviewError) {
          const errorNote = `## Epic Review Error (${new Date().toISOString()})\nReview failed: ${reviewError.message}\n`;
          await this.notionClient.appendMarkdown(task.id, errorNote);

          if (isClaudeLimitError(reviewError.message)) {
            const resetHint = extractResetHint(reviewError.message);
            this.logger.warn(
              `Claude usage limit reached during Epic review. Queue paused until ${resetHint || 'unknown reset time'}.`
            );
          } else {
            this.logger.error(`Epic review failed for "${task.name}": ${reviewError.message}`);
          }

          return;
        } finally {
          this.currentTaskId = null;
        }
      }

      await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.done);

      const summaryMarkdown = buildEpicSummary(task, summary);
      await this.notionClient.appendMarkdown(task.id, summaryMarkdown);

      this.logger.success(`Epic moved to Done automatically: "${task.name}" (children: ${epicResult.children.length})`);
    }
  }
}
