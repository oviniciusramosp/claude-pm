import { runClaudeTask } from './claudeRunner.js';
import { buildEpicSummary, buildTaskCompletionNotes, buildTaskPrompt } from './promptBuilder.js';
import { allEpicChildrenAreDone, isEpicTask, pickNextTask } from './selectTask.js';

function normalize(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
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
  }

  schedule(reason) {
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
      } while (this.pending || this.pendingReasons.length > 0);
    } finally {
      this.running = false;
    }
  }

  isRunning() {
    return {
      active: this.running,
      currentTaskId: this.currentTaskId,
      queuedReasons: this.pendingReasons
    };
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
      const prompt = buildTaskPrompt(task, markdown, this.config.claude.extraPrompt);
      if (this.config.claude.logPrompt) {
        this.logger.block(`Prompt sent to Claude Code for "${task.name}"`, prompt);
      }

      this.currentTaskId = task.id;

      try {
        const execution = await runClaudeTask(task, prompt, this.config);

        if (normalize(execution.status) !== 'done') {
          await this.runStore.markFailed(task, `Claude retornou status=${execution.status || 'desconhecido'}`);
          this.logger.warn(`Task blocked by Claude: "${task.name}" (status: ${execution.status || 'unknown'})`);

          if (this.config.state.autoResetFailedTask) {
            await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.notStarted);
            this.logger.warn(`Returned to Not Started after block: "${task.name}"`);
          }

          break;
        }

        await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.done);
        const completionNotes = buildTaskCompletionNotes(task, execution);
        await this.notionClient.appendMarkdown(task.id, completionNotes);
        await this.runStore.markDone(task, execution);
        processed += 1;

        this.logger.success(`Moved to Done: "${task.name}"`);
      } catch (error) {
        await this.runStore.markFailed(task, error.message);
        const resetHint = extractResetHint(error.message);

        if (isClaudeLimitError(error.message)) {
          this.logger.warn(
            `Claude usage limit reached. Queue paused until ${resetHint || 'unknown reset time'}.`
          );
        } else {
          this.logger.error(`Failed to execute task "${task.name}": ${error.message}`);
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

      await this.notionClient.updateTaskStatus(task.id, this.config.notion.statuses.done);

      const summary = await this.runStore.getEpicSummary(epicResult.children);
      const summaryMarkdown = buildEpicSummary(task, summary);
      await this.notionClient.appendMarkdown(task.id, summaryMarkdown);

      this.logger.success(`Epic moved to Done automatically: "${task.name}" (children: ${epicResult.children.length})`);
    }
  }
}
