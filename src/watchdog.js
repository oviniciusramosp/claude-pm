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

    const maxFailures = this.config.watchdog.maxConsecutiveFailures;

    if (current >= maxFailures) {
      this.logger.error(
        `Watchdog: task "${taskName}" has failed ${current} consecutive times. Orchestrator halted. Manual intervention required.`,
        { taskId, consecutiveFailures: current, maxFailures }
      );
      return true;
    }

    this.logger.warn(
      `Watchdog: task "${taskName}" failed (${current}/${maxFailures} consecutive failures).`,
      { taskId }
    );

    return false;
  }

  recordSuccess(taskId) {
    this.consecutiveFailures.delete(taskId);
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
