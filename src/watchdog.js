export class Watchdog {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;

    this.timer = null;
    this.warningCount = 0;
    this.abortController = null;
    this.taskId = null;
    this.taskName = null;

    this.consecutiveFailures = new Map();
    this.globalConsecutiveFailures = 0;
  }

  start(task) {
    this.stop();

    if (!this.config.watchdog.enabled) {
      return { signal: undefined };
    }

    this.taskId = task.id;
    this.taskName = task.name;
    this.warningCount = 0;
    this.abortController = new AbortController();

    this.timer = setInterval(() => {
      this.check();
    }, this.config.watchdog.intervalMs);

    return { signal: this.abortController.signal };
  }

  check() {
    this.warningCount += 1;

    const maxWarnings = this.config.watchdog.maxWarnings;
    const intervalMin = Math.round(this.config.watchdog.intervalMs / 60000);
    const elapsedMin = this.warningCount * intervalMin;

    if (this.warningCount >= maxWarnings) {
      this.logger.error(
        `Watchdog: task "${this.taskName}" exceeded ${elapsedMin}min (${this.warningCount}/${maxWarnings} warnings). Killing process.`,
        { taskId: this.taskId }
      );
      this.abortController.abort();
      this.clearTimer();
    } else {
      this.logger.warn(
        `Watchdog: task "${this.taskName}" running for ${elapsedMin}min (warning ${this.warningCount}/${maxWarnings}).`,
        { taskId: this.taskId }
      );
    }
  }

  stop() {
    this.clearTimer();
    this.abortController = null;
    this.warningCount = 0;
    this.taskId = null;
    this.taskName = null;
  }

  recordFailure(taskId, taskName) {
    const current = (this.consecutiveFailures.get(taskId) || 0) + 1;
    this.consecutiveFailures.set(taskId, current);
    this.globalConsecutiveFailures += 1;

    const maxFailures = this.config.watchdog.maxConsecutiveFailures;
    const maxGlobal = this.config.watchdog.maxGlobalConsecutiveFailures;

    if (current >= maxFailures) {
      this.logger.error(
        `Watchdog: task "${taskName}" has failed ${current} consecutive times. Orchestrator halted. Manual intervention required.`,
        { taskId, consecutiveFailures: current, maxFailures }
      );
      return true;
    }

    if (this.globalConsecutiveFailures >= maxGlobal) {
      this.logger.error(
        `Watchdog: ${this.globalConsecutiveFailures} consecutive failures across all tasks. Orchestrator halted. Manual intervention required.`,
        { globalConsecutiveFailures: this.globalConsecutiveFailures, maxGlobal }
      );
      return true;
    }

    this.logger.warn(
      `Watchdog: task "${taskName}" failed (task: ${current}/${maxFailures}, global: ${this.globalConsecutiveFailures}/${maxGlobal}).`,
      { taskId }
    );

    return false;
  }

  recordSuccess(taskId) {
    this.consecutiveFailures.delete(taskId);
    this.globalConsecutiveFailures = 0;
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
