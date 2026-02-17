import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, serializeFrontmatter, updateFrontmatterField } from './frontmatter.js';
import { titleFromSlug, slugFromTitle, parseArrayField } from './helpers.js';

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
    return content;
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

  async writeTaskMarkdown(taskId, content) {
    const task = await this._findTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    await fs.writeFile(task._filePath, content, 'utf8');
    this._invalidateIndex();
  }

  async deleteTask(taskId, { deleteEpicFolder = false } = {}) {
    const task = await this._findTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const deleted = [];
    const taskIsEpic = task.type?.toLowerCase() === 'epic' ||
      (this._taskIndex && [...this._taskIndex.values()].some((t) => t.parentId === task.id));

    if (taskIsEpic && deleteEpicFolder) {
      const epicDir = path.dirname(task._filePath);
      await fs.rm(epicDir, { recursive: true });
      deleted.push(epicDir);
    } else {
      await fs.unlink(task._filePath);
      deleted.push(task._filePath);
    }

    this._invalidateIndex();
    return deleted;
  }

  async createTask(fields, body = '', { epicId = null, fileName = null } = {}) {
    const name = fields.name;
    if (!name) throw new Error('Task name is required');

    const isEpic = (fields.type || '').toLowerCase() === 'epic' && !epicId;
    const slug = fileName || slugFromTitle(name);
    const cleanSlug = slug.replace(/\.md$/, '');

    const frontmatterFields = {
      name: fields.name,
      priority: fields.priority || 'P1',
      type: fields.type || 'UserStory',
      status: fields.status || this.statuses.notStarted
    };
    if (fields.model) frontmatterFields.model = fields.model;
    if (fields.agents) frontmatterFields.agents = fields.agents;

    const header = serializeFrontmatter(frontmatterFields);
    const content = header + '\n\n' + (body || `# ${fields.name}\n`);

    if (isEpic) {
      const epicDir = path.join(this.boardDir, cleanSlug);
      try {
        await fs.access(epicDir);
        throw new Error(`Epic folder already exists: ${cleanSlug}`);
      } catch (err) {
        if (err.message.startsWith('Epic folder already exists')) throw err;
      }

      await fs.mkdir(epicDir, { recursive: true });
      const epicFilePath = path.join(epicDir, 'epic.md');
      await fs.writeFile(epicFilePath, content, 'utf8');
      this._invalidateIndex();

      return { taskId: cleanSlug, filePath: epicFilePath };
    }

    const targetFileName = `${cleanSlug}.md`;
    let targetDir = this.boardDir;
    let taskId = cleanSlug;

    if (epicId) {
      targetDir = path.join(this.boardDir, epicId);
      taskId = `${epicId}/${taskId}`;
      try {
        await fs.access(targetDir);
      } catch {
        throw new Error(`Epic folder not found: ${epicId}`);
      }
    }

    const targetPath = path.join(targetDir, targetFileName);

    try {
      await fs.access(targetPath);
      throw new Error(`File already exists: ${targetFileName}`);
    } catch (err) {
      if (err.message.startsWith('File already exists')) throw err;
    }

    await fs.writeFile(targetPath, content, 'utf8');
    this._invalidateIndex();

    return { taskId, filePath: targetPath };
  }

  async getNextNumbers() {
    let entries;
    try {
      entries = await fs.readdir(this.boardDir, { withFileTypes: true });
    } catch {
      return { nextStandalone: 1, nextEpic: 1, epicChildNext: {} };
    }

    let maxStandaloneNum = 0;
    let maxEpicNum = 0;
    const epicChildNext = {};

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const m = entry.name.match(/^t(\d+)-/i);
        if (m) maxStandaloneNum = Math.max(maxStandaloneNum, parseInt(m[1], 10));
      } else if (entry.isDirectory()) {
        const epicMatch = entry.name.match(/^E(\d+)/i);
        if (epicMatch) maxEpicNum = Math.max(maxEpicNum, parseInt(epicMatch[1], 10));

        let children;
        try {
          children = await fs.readdir(path.join(this.boardDir, entry.name), { withFileTypes: true });
        } catch {
          continue;
        }

        let maxChildNum = 0;
        for (const child of children) {
          if (child.isFile() && child.name !== 'epic.md' && child.name.endsWith('.md')) {
            const cm = child.name.match(/^s\d+-(\d+)/i);
            if (cm) maxChildNum = Math.max(maxChildNum, parseInt(cm[1], 10));
          }
        }
        epicChildNext[entry.name] = maxChildNum + 1;
      }
    }

    return {
      nextStandalone: maxStandaloneNum + 1,
      nextEpic: maxEpicNum + 1,
      epicChildNext
    };
  }

  async listEpicFolders() {
    let entries;
    try {
      entries = await fs.readdir(this.boardDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const epics = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const epicFile = path.join(this.boardDir, entry.name, 'epic.md');
        try {
          await fs.access(epicFile);
          epics.push(entry.name);
        } catch {
          // Directory without epic.md — skip
        }
      }
    }
    return epics;
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
