import { config } from './config.js';
import { logger } from './logger.js';
import { buildRecoveryPrompt } from './recoveryPromptBuilder.js';
import { runClaudeTask } from './claudeRunner.js';

/**
 * Auto-recovery system for failed tasks.
 * Attempts to analyze errors and fix underlying issues before retrying.
 */
export class AutoRecovery {
  constructor() {
    this.attemptMap = new Map(); // taskId -> attempt count
    this.epicAttemptMap = new Map(); // epicId -> attempt count
  }

  /**
   * Check if recovery should be attempted for a failed task
   */
  canRecover(taskId) {
    if (!config.autoRecovery.enabled) {
      return false;
    }

    const attempts = this.attemptMap.get(taskId) || 0;
    return attempts < config.autoRecovery.maxRetries;
  }

  /**
   * Check if recovery should be attempted for a failed epic
   * Epics have a separate counter with max 2 attempts per epic
   */
  canRecoverEpic(epicId) {
    if (!config.autoRecovery.enabled) {
      return false;
    }

    const attempts = this.epicAttemptMap.get(epicId) || 0;
    return attempts < config.autoRecovery.maxRetries;
  }

  /**
   * Attempt to recover from a task failure
   * Returns { recovered: boolean, attempt: number, reason?: string }
   */
  async tryRecover(taskId, error, taskContext) {
    if (!this.canRecover(taskId)) {
      const attempts = this.attemptMap.get(taskId) || 0;
      return {
        recovered: false,
        attempt: attempts,
        reason: 'max_retries_exceeded',
      };
    }

    // Increment attempt counter
    const attempts = (this.attemptMap.get(taskId) || 0) + 1;
    this.attemptMap.set(taskId, attempts);

    logger.warn(`RECOVERY - Attempting auto-recovery for task "${taskId}" (attempt ${attempts}/${config.autoRecovery.maxRetries})`);

    try {
      const result = await this.analyzeAndFix(taskId, error, taskContext);

      if (result.success) {
        logger.success(`RECOVERY - Auto-recovery succeeded for task "${taskId}": ${result.summary}`);
        return { recovered: true, attempt: attempts, result };
      } else {
        logger.error(`RECOVERY - Auto-recovery failed for task "${taskId}": ${result.summary}`);
        return { recovered: false, attempt: attempts, reason: result.summary };
      }
    } catch (err) {
      logger.error(`RECOVERY - Auto-recovery crashed for task "${taskId}": ${err.message}`);
      return { recovered: false, attempt: attempts, reason: err.message };
    }
  }

  /**
   * Attempt to recover from an epic failure
   */
  async tryRecoverEpic(epicId, error, taskContext) {
    if (!this.canRecoverEpic(epicId)) {
      const attempts = this.epicAttemptMap.get(epicId) || 0;
      return {
        recovered: false,
        attempt: attempts,
        reason: 'max_retries_exceeded',
      };
    }

    // Increment epic attempt counter
    const attempts = (this.epicAttemptMap.get(epicId) || 0) + 1;
    this.epicAttemptMap.set(epicId, attempts);

    logger.warn(`RECOVERY - Attempting auto-recovery for epic "${epicId}" (attempt ${attempts}/${config.autoRecovery.maxRetries})`);

    try {
      const result = await this.analyzeAndFix(epicId, error, taskContext);

      if (result.success) {
        logger.success(`RECOVERY - Auto-recovery succeeded for epic "${epicId}": ${result.summary}`);
        return { recovered: true, attempt: attempts, result };
      } else {
        logger.error(`RECOVERY - Auto-recovery failed for epic "${epicId}": ${result.summary}`);
        return { recovered: false, attempt: attempts, reason: result.summary };
      }
    } catch (err) {
      logger.error(`RECOVERY - Auto-recovery crashed for epic "${epicId}": ${err.message}`);
      return { recovered: false, attempt: attempts, reason: err.message };
    }
  }

  /**
   * Execute Claude with recovery prompt
   */
  async analyzeAndFix(taskId, error, taskContext) {
    const prompt = buildRecoveryPrompt(error, taskContext);

    // Determine recovery model
    let recoveryModel = config.autoRecovery.model;
    if (recoveryModel === 'auto') {
      recoveryModel = 'claude-opus-4-6'; // Use Opus for maximum intelligence
    }

    logger.info(`RECOVERY - Running recovery analysis with model: ${recoveryModel}`);

    // Create a minimal task object for runClaudeTask
    const recoveryTask = {
      id: taskId,
      name: `Recovery for ${taskId}`,
      type: 'Recovery',
      model: recoveryModel,
    };

    // Create config object for runClaudeTask
    const recoveryConfig = {
      claude: {
        oauthToken: config.claude.oauthToken,
        workdir: taskContext.workdir || config.claude.workdir,
        fullAccess: config.claude.fullAccess,
        streamOutput: false, // No streaming for recovery (cleaner logs)
        timeoutMs: config.autoRecovery.timeoutMs,
      }
    };

    // Execute Claude with recovery prompt
    const result = await runClaudeTask(
      recoveryTask,
      prompt,
      recoveryConfig,
      { overrideModel: recoveryModel }
    );

    // Parse recovery result
    if (result.status === 'done') {
      // Try to extract JSON response from stdout
      const jsonMatch = result.stdout.match(/\{[\s\S]*?"status"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const recoveryData = JSON.parse(jsonMatch[0]);
          return {
            success: recoveryData.status === 'fixed',
            summary: recoveryData.summary || 'Recovery completed',
            rootCause: recoveryData.root_cause,
            filesChanged: recoveryData.files_changed || [],
            nextSteps: recoveryData.next_steps,
          };
        } catch (parseErr) {
          logger.warn(`RECOVERY - Failed to parse recovery JSON: ${parseErr.message}`);
        }
      }

      // Fallback: assume success if Claude finished
      return {
        success: true,
        summary: 'Recovery completed (no JSON found, assuming success)',
        filesChanged: [],
      };
    }

    // Recovery execution failed
    return {
      success: false,
      summary: result.error || 'Recovery execution failed',
    };
  }

  /**
   * Reset recovery attempts for a task (called after successful completion)
   */
  reset(taskId) {
    this.attemptMap.delete(taskId);
    logger.info(`RECOVERY - Reset recovery counter for task "${taskId}"`);
  }

  /**
   * Reset recovery attempts for an epic (called after successful completion)
   */
  resetEpic(epicId) {
    this.epicAttemptMap.delete(epicId);
    logger.info(`RECOVERY - Reset recovery counter for epic "${epicId}"`);
  }

  /**
   * Get current attempt count for a task
   */
  getAttempts(taskId) {
    return this.attemptMap.get(taskId) || 0;
  }

  /**
   * Get current attempt count for an epic
   */
  getEpicAttempts(epicId) {
    return this.epicAttemptMap.get(epicId) || 0;
  }

  /**
   * Get recovery statistics
   */
  getStats() {
    return {
      enabled: config.autoRecovery.enabled,
      maxRetries: config.autoRecovery.maxRetries,
      model: config.autoRecovery.model,
      activeTasks: this.attemptMap.size,
      activeEpics: this.epicAttemptMap.size,
    };
  }
}

// Singleton instance
export const autoRecovery = new AutoRecovery();
