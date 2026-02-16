import fs from 'node:fs/promises';
import path from 'node:path';

async function ensureDir(filePath) {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
}

function getISOWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export class UsageStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.loaded = false;
    this.state = { weeks: {} };
  }

  async load() {
    if (this.loaded) {
      return;
    }

    await ensureDir(this.filePath);

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.state = JSON.parse(content);
      if (!this.state.weeks || typeof this.state.weeks !== 'object') {
        this.state.weeks = {};
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await this.save();
    }

    this.loaded = true;
  }

  async save() {
    await ensureDir(this.filePath);
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  async recordUsage(taskId, taskName, usage) {
    if (!usage) {
      return;
    }

    await this.load();
    const weekKey = getISOWeekKey(new Date());

    if (!this.state.weeks[weekKey]) {
      this.state.weeks[weekKey] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        taskCount: 0,
        tasks: {}
      };
    }

    const week = this.state.weeks[weekKey];
    const inTokens = usage.inputTokens || 0;
    const outTokens = usage.outputTokens || 0;

    week.inputTokens += inTokens;
    week.outputTokens += outTokens;
    week.cacheCreationInputTokens += usage.cacheCreationInputTokens || 0;
    week.cacheReadInputTokens += usage.cacheReadInputTokens || 0;
    week.totalTokens += inTokens + outTokens;
    week.totalCostUsd += usage.totalCostUsd || 0;
    week.taskCount += 1;

    const existing = week.tasks[taskId] || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0
    };

    existing.inputTokens += inTokens;
    existing.outputTokens += outTokens;
    existing.totalTokens += inTokens + outTokens;
    existing.totalCostUsd += usage.totalCostUsd || 0;
    existing.taskName = taskName;
    existing.timestamp = new Date().toISOString();

    week.tasks[taskId] = existing;

    await this.save();
  }

  async getWeeklySummary(weekKey) {
    await this.load();
    const key = weekKey || getISOWeekKey(new Date());
    const week = this.state.weeks[key];

    if (!week) {
      return {
        weekKey: key,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        taskCount: 0,
        tasks: {}
      };
    }

    return { weekKey: key, ...week };
  }
}
