import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, updateFrontmatterField } from './frontmatter.js';
import { titleFromSlug, parseArrayField } from './helpers.js';

export class LocalBoardClient {
  constructor(config) {
    this.config = config;
    this.boardDir = config.board.dir;
    this.statuses = config.board.statuses;

    this.statusFolders = {
      [this.statuses.notStarted]: 'Not Started',
      [this.statuses.inProgress]: 'In Progress',
      [this.statuses.done]: 'Done'
    };

    this._taskIndex = null;
  }

  async initialize() {
    await fs.mkdir(this.boardDir, { recursive: true });

    for (const dirName of Object.values(this.statusFolders)) {
      await fs.mkdir(path.join(this.boardDir, dirName), { recursive: true });
    }
  }

  async listTasks() {
    const tasks = [];

    for (const [statusValue, dirName] of Object.entries(this.statusFolders)) {
      const statusPath = path.join(this.boardDir, dirName);

      let entries;
      try {
        entries = await fs.readdir(statusPath, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const task = await this._parseTaskFile(
            path.join(statusPath, entry.name),
            statusValue,
            null
          );
          if (task) {
            tasks.push(task);
          }
        } else if (entry.isDirectory()) {
          const epicPath = path.join(statusPath, entry.name);
          const epicFile = path.join(epicPath, 'epic.md');

          const epicTask = await this._parseTaskFile(epicFile, statusValue, null);
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
                null,
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

    if (task.parentId) {
      const content = await fs.readFile(task._filePath, 'utf8');
      const updated = updateFrontmatterField(content, 'status', newStatus);
      await fs.writeFile(task._filePath, updated, 'utf8');
      this._invalidateIndex();
      return;
    }

    const targetDirName = this.statusFolders[newStatus];
    if (!targetDirName) {
      throw new Error(`Unknown status: ${newStatus}`);
    }

    const targetDir = path.join(this.boardDir, targetDirName);
    const sourcePath = task._filePath;
    const isEpicFile = path.basename(sourcePath) === 'epic.md';

    if (isEpicFile) {
      const epicFolder = path.dirname(sourcePath);
      const folderName = path.basename(epicFolder);
      const targetPath = path.join(targetDir, folderName);
      await fs.rename(epicFolder, targetPath);
    } else {
      const fileName = path.basename(sourcePath);
      const targetPath = path.join(targetDir, fileName);
      await fs.rename(sourcePath, targetPath);
    }

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

  async _parseTaskFile(filePath, folderStatus, parentId) {
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
      taskId = `${parentFolder}/${fileName}`;
    } else {
      taskId = fileName;
    }

    const status = frontmatter.status || folderStatus || '';

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
      _filePath: filePath
    };
  }
}
