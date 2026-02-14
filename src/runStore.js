import fs from 'node:fs/promises';
import path from 'node:path';

async function ensureDir(filePath) {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
}

export class RunStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.loaded = false;
    this.state = {
      tasks: {}
    };
  }

  async load() {
    if (this.loaded) {
      return;
    }

    await ensureDir(this.filePath);

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.state = JSON.parse(content);
      if (!this.state.tasks || typeof this.state.tasks !== 'object') {
        this.state.tasks = {};
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

  async markStarted(task) {
    await this.load();

    const previous = this.state.tasks[task.id] || {};
    this.state.tasks[task.id] = {
      ...previous,
      taskId: task.id,
      taskName: task.name,
      parentId: task.parentId || null,
      startedAt: previous.startedAt || new Date().toISOString(),
      status: 'running'
    };

    await this.save();
  }

  async markDone(task, execution) {
    await this.load();

    const now = new Date().toISOString();
    const previous = this.state.tasks[task.id] || {};
    const startedAt = previous.startedAt || now;
    const durationMs = new Date(now).getTime() - new Date(startedAt).getTime();

    this.state.tasks[task.id] = {
      ...previous,
      taskId: task.id,
      taskName: task.name,
      parentId: task.parentId || null,
      startedAt,
      completedAt: now,
      durationMs,
      status: 'done',
      result: {
        summary: execution.summary || '',
        notes: execution.notes || '',
        files: execution.files || [],
        tests: execution.tests || '',
        stdout: execution.stdout || '',
        stderr: execution.stderr || ''
      }
    };

    await this.save();
  }

  async markFailed(task, errorMessage) {
    await this.load();

    const now = new Date().toISOString();
    const previous = this.state.tasks[task.id] || {};

    this.state.tasks[task.id] = {
      ...previous,
      taskId: task.id,
      taskName: task.name,
      parentId: task.parentId || null,
      failedAt: now,
      status: 'failed',
      error: errorMessage
    };

    await this.save();
  }

  async getEpicSummary(children) {
    await this.load();

    const rows = [];
    let earliest = null;
    let latest = null;
    let totalDuration = 0;

    for (const child of children) {
      const run = this.state.tasks[child.id] || null;
      const startedAt = run?.startedAt || child.createdTime || null;
      const completedAt = run?.completedAt || null;
      const durationMs = run?.durationMs || null;

      if (startedAt) {
        if (!earliest || new Date(startedAt).getTime() < new Date(earliest).getTime()) {
          earliest = startedAt;
        }
      }

      if (completedAt) {
        if (!latest || new Date(completedAt).getTime() > new Date(latest).getTime()) {
          latest = completedAt;
        }
      }

      if (durationMs) {
        totalDuration += durationMs;
      }

      rows.push({
        id: child.id,
        name: child.name,
        status: child.status,
        durationMs
      });
    }

    return {
      rows,
      earliest,
      latest,
      totalDurationMs: totalDuration
    };
  }
}
