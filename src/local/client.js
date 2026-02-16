import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, updateFrontmatterField } from './frontmatter.js';
import { titleFromSlug, parseArrayField } from './helpers.js';

export class LocalBoardClient {
  constructor(config) {
    this.config = config;
    this.boardDir = config.board.dir;
    this.statuses = config.board.statuses;
    this._taskIndex = null;
  }

  async initialize() {
    await fs.mkdir(this.boardDir, { recursive: true });
  }

  async listTasks() {
    const tasks = [];

    let entries;
    try {
      entries = await fs.readdir(this.boardDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return tasks;
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const task = await this._parseTaskFile(
          path.join(this.boardDir, entry.name),
          null
        );
        if (task) {
          tasks.push(task);
        }
      } else if (entry.isDirectory()) {
        const epicPath = path.join(this.boardDir, entry.name);
        const epicFile = path.join(epicPath, 'epic.md');

        // For epic.md, parentId is null (it's a top-level task)
        const epicTask = await this._parseTaskFile(epicFile, null);
        if (!epicTask) {
          continue;
        }

        epicTask.type = epicTask.type || 'Epic';
        tasks.push(epicTask);

        const children = await fs.readdir(epicPath, { withFileTypes: true });
        for (const child of children) {
          if (child.isFile() && child.name.endsWith('.md') && child.name !== 'epic.md') {
            const childTask = await this._parseTaskFile(
              path.join(epicPath, child.name),
              epicTask.id
            );
            if (childTask) {
              if (!childTask.status) {
                childTask.status = this.statuses.notStarted;
              }
              tasks.push(childTask);
            }
          }
        }
      }
    }

    this._taskIndex = new Map();
    for (const task of tasks) {
      this._taskIndex.set(task.id, task);
    }

    return tasks;
  }

  async updateTaskStatus(taskId, newStatus) {
    const task = await this._findTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const content = await fs.readFile(task._filePath, 'utf8');
    const updated = updateFrontmatterField(content, 'status', newStatus);
    await fs.writeFile(task._filePath, updated, 'utf8');
    this._invalidateIndex();
  }

  async getTaskMarkdown(taskId) {
    const task = await this._findTaskById(taskId);
    if (!task) {
      return '';
    }

    const content = await fs.readFile(task._filePath, 'utf8');
    const { body } = parseFrontmatter(content);
    return body;
  }

  async updateCheckboxes(taskId, completedAcs) {
    if (!Array.isArray(completedAcs) || completedAcs.length === 0) {
      return;
    }

    const task = await this._findTaskById(taskId);
    if (!task) {
      return;
    }

    let content = await fs.readFile(task._filePath, 'utf8');
    let updated = false;

    for (const acText of completedAcs) {
      const trimmed = (acText || '').trim();
      if (!trimmed) {
        continue;
      }

      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^(\\s*-\\s*)\\[ \\](\\s+${escaped})`, 'gm');

      const result = content.replace(pattern, '$1[x]$2');
      if (result !== content) {
        content = result;
        updated = true;
      }
    }

    if (updated) {
      await fs.writeFile(task._filePath, content, 'utf8');
    }
  }

  async updateCheckboxesByIndex(taskId, completedIndices) {
    if (!Array.isArray(completedIndices) || completedIndices.length === 0) {
      return;
    }

    const task = await this._findTaskById(taskId);
    if (!task) {
      return;
    }

    let content = await fs.readFile(task._filePath, 'utf8');
    const checkboxRegex = /^(\s*-\s*)\[([ xX])\](\s+.+)$/gm;
    let match;
    let currentIndex = 0;
    const replacements = [];

    while ((match = checkboxRegex.exec(content)) !== null) {
      currentIndex++;
      const isUnchecked = match[2] === ' ';
      if (isUnchecked && completedIndices.includes(currentIndex)) {
        replacements.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: `${match[1]}[x]${match[3]}`
        });
      }
    }

    if (replacements.length > 0) {
      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        content = content.slice(0, r.start) + r.replacement + content.slice(r.end);
      }
      await fs.writeFile(task._filePath, content, 'utf8');
    }
  }

  async appendMarkdown(taskId, markdown) {
    if (!markdown || !markdown.trim()) {
      return;
    }

    const task = await this._findTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const separator = '\n\n---\n\n';
    await fs.appendFile(task._filePath, separator + markdown.trim() + '\n');
  }

  async _findTaskById(taskId) {
    if (!this._taskIndex || !this._taskIndex.has(taskId)) {
      await this.listTasks();
    }

    return this._taskIndex?.get(taskId) || null;
  }

  _invalidateIndex() {
    this._taskIndex = null;
  }

  async _parseTaskFile(filePath, parentId) {
    let content;
    let stat;

    try {
      [content, stat] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath)
      ]);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    const { frontmatter } = parseFrontmatter(content);

    const fileName = path.basename(filePath, '.md');
    const isEpicFile = fileName === 'epic';
    const parentFolder = path.basename(path.dirname(filePath));

    let taskId;
    if (isEpicFile) {
      taskId = parentFolder;
    } else if (parentId) {
      // parentId is already the epic ID (just the folder name), so use it directly
      taskId = `${parentId}/${fileName}`;
    } else {
      taskId = fileName;
    }

    const status = frontmatter.status || this.statuses.notStarted;

    const { body } = parseFrontmatter(content);
    const unchecked = (body.match(/^\s*-\s*\[ \]\s+/gm) || []).length;
    const checked = (body.match(/^\s*-\s*\[x\]\s+/gim) || []).length;

    return {
      id: taskId,
      name: frontmatter.name || titleFromSlug(isEpicFile ? parentFolder : fileName),
      status,
      agents: parseArrayField(frontmatter.agents || frontmatter.agent),
      priority: frontmatter.priority || '',
      type: frontmatter.type || '',
      model: frontmatter.model || '',
      parentId: parentId,
      url: path.relative(process.cwd(), filePath),
      createdTime: frontmatter.created || stat.birthtime.toISOString(),
      lastEditedTime: stat.mtime.toISOString(),
      acTotal: unchecked + checked,
      acDone: checked,
      _filePath: filePath
    };
  }
}
