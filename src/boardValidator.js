import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './local/frontmatter.js';

/**
 * Validates Board structure and task files
 * Returns validation result with errors and warnings
 */
export class BoardValidator {
  constructor(config) {
    this.boardDir = config.board.dir;
    this.validStatuses = [
      config.board.statuses.notStarted,
      config.board.statuses.inProgress,
      config.board.statuses.done
    ];
  }

  /**
   * Run full validation
   * Returns: { valid: boolean, errors: [], warnings: [], info: {} }
   */
  async validate() {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      info: {
        totalTasks: 0,
        totalEpics: 0,
        tasksWithoutStatus: 0,
        tasksWithInvalidStatus: 0,
        tasksWithoutDescription: 0,
        invalidFiles: []
      }
    };

    // Check if Board directory exists
    try {
      const stat = await fs.stat(this.boardDir);
      if (!stat.isDirectory()) {
        result.valid = false;
        result.errors.push({
          type: 'missing_board',
          message: `Board path exists but is not a directory: ${this.boardDir}`,
          severity: 'critical'
        });
        return result;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        result.valid = false;
        result.errors.push({
          type: 'missing_board',
          message: `Board directory not found: ${this.boardDir}`,
          severity: 'critical',
          suggestion: `Create the Board directory at: ${this.boardDir}`
        });
        return result;
      }
      throw error;
    }

    // Read Board contents
    let entries;
    try {
      entries = await fs.readdir(this.boardDir, { withFileTypes: true });
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'read_error',
        message: `Failed to read Board directory: ${error.message}`,
        severity: 'critical'
      });
      return result;
    }

    // Validate standalone tasks
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(this.boardDir, entry.name);
        const validation = await this._validateTaskFile(filePath, null);

        result.info.totalTasks++;

        if (!validation.valid) {
          result.valid = false;
          result.errors.push(...validation.errors);
        }

        result.warnings.push(...validation.warnings);

        if (validation.missingStatus) {
          result.info.tasksWithoutStatus++;
        }
        if (validation.invalidStatus) {
          result.info.tasksWithInvalidStatus++;
        }
        if (validation.missingDescription) {
          result.info.tasksWithoutDescription++;
        }
      } else if (entry.isDirectory()) {
        // Validate Epic
        const epicValidation = await this._validateEpic(entry.name);

        if (epicValidation.isEpic) {
          result.info.totalEpics++;

          if (!epicValidation.valid) {
            result.valid = false;
            result.errors.push(...epicValidation.errors);
          }

          result.warnings.push(...epicValidation.warnings);

          result.info.totalTasks += epicValidation.childCount;
          result.info.tasksWithoutStatus += epicValidation.childrenWithoutStatus;
          result.info.tasksWithInvalidStatus += epicValidation.childrenWithInvalidStatus;
          result.info.tasksWithoutDescription += epicValidation.childrenWithoutDescription;
        } else {
          // Directory that is not an Epic
          result.warnings.push({
            type: 'unexpected_directory',
            message: `Unexpected directory found: ${entry.name}`,
            path: path.join(this.boardDir, entry.name),
            suggestion: 'Only Epic folders (containing epic.md) are supported in Board root'
          });
        }
      }
    }

    // Check for legacy status folders
    const legacyFolders = ['Not Started', 'In Progress', 'Done'];
    for (const folderName of legacyFolders) {
      const folderPath = path.join(this.boardDir, folderName);
      try {
        const stat = await fs.stat(folderPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(folderPath);
          if (files.length > 0) {
            result.warnings.push({
              type: 'legacy_structure',
              message: `Legacy status folder found with files: ${folderName}/`,
              path: folderPath,
              fileCount: files.length,
              severity: 'high',
              suggestion: 'Tasks should be in Board root with status in frontmatter. Run migration script to update.'
            });
          } else {
            result.warnings.push({
              type: 'empty_legacy_folder',
              message: `Empty legacy status folder: ${folderName}/`,
              path: folderPath,
              severity: 'low',
              suggestion: 'Safe to delete this empty folder'
            });
          }
        }
      } catch (error) {
        // Folder doesn't exist - this is good
      }
    }

    return result;
  }

  async _validateEpic(epicFolderName) {
    const epicPath = path.join(this.boardDir, epicFolderName);
    const epicFilePath = path.join(epicPath, 'epic.md');

    const result = {
      isEpic: false,
      valid: true,
      errors: [],
      warnings: [],
      childCount: 0,
      childrenWithoutStatus: 0,
      childrenWithInvalidStatus: 0,
      childrenWithoutDescription: 0
    };

    // Check if epic.md exists
    try {
      await fs.stat(epicFilePath);
      result.isEpic = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Not an epic folder
        return result;
      }
      throw error;
    }

    // Validate epic.md
    const epicValidation = await this._validateTaskFile(epicFilePath, epicPath);
    if (!epicValidation.valid) {
      result.valid = false;
      result.errors.push(...epicValidation.errors);
    }
    result.warnings.push(...epicValidation.warnings);

    // Validate children
    const children = await fs.readdir(epicPath, { withFileTypes: true });
    for (const child of children) {
      if (child.isFile() && child.name.endsWith('.md') && child.name !== 'epic.md') {
        const childFilePath = path.join(epicPath, child.name);
        const childValidation = await this._validateTaskFile(childFilePath, epicPath);

        result.childCount++;

        if (!childValidation.valid) {
          result.valid = false;
          result.errors.push(...childValidation.errors);
        }

        result.warnings.push(...childValidation.warnings);

        if (childValidation.missingStatus) {
          result.childrenWithoutStatus++;
        }
        if (childValidation.invalidStatus) {
          result.childrenWithInvalidStatus++;
        }
        if (childValidation.missingDescription) {
          result.childrenWithoutDescription++;
        }
      } else if (child.isDirectory()) {
        result.warnings.push({
          type: 'nested_directory',
          message: `Nested directory found inside Epic: ${epicFolderName}/${child.name}`,
          path: path.join(epicPath, child.name),
          suggestion: 'Nested directories are not supported. Only .md files should be inside Epic folders.'
        });
      }
    }

    return result;
  }

  async _validateTaskFile(filePath, parentPath) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      missingStatus: false,
      invalidStatus: false,
      missingDescription: false
    };

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'read_error',
        message: `Failed to read file: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'high',
        details: error.message
      });
      return result;
    }

    // Parse frontmatter
    let frontmatter;
    let body;
    try {
      const parsed = parseFrontmatter(content);
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'invalid_frontmatter',
        message: `Invalid YAML frontmatter: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'high',
        details: error.message,
        suggestion: 'Ensure frontmatter is valid YAML between --- delimiters'
      });
      return result;
    }

    // Check if body content exists after frontmatter
    const trimmedBody = body.trim();
    if (!trimmedBody || trimmedBody.length === 0) {
      result.valid = false;
      result.missingDescription = true;
      result.errors.push({
        type: 'empty_body',
        message: `No description content after frontmatter: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'high',
        suggestion: 'Add task description, acceptance criteria, and instructions after the frontmatter'
      });
    }

    // Check required fields
    if (!frontmatter.name) {
      result.warnings.push({
        type: 'missing_name',
        message: `Missing 'name' field: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'medium',
        suggestion: 'Add a name field to the frontmatter'
      });
    }

    // Check status field
    if (!frontmatter.status) {
      result.valid = false;
      result.missingStatus = true;
      result.errors.push({
        type: 'missing_status',
        message: `Missing 'status' field: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'critical',
        suggestion: `Add status field with one of: ${this.validStatuses.join(', ')}`
      });
    } else {
      // Validate status value
      const normalizedStatus = String(frontmatter.status).trim();
      if (!this.validStatuses.includes(normalizedStatus)) {
        result.valid = false;
        result.invalidStatus = true;
        result.errors.push({
          type: 'invalid_status',
          message: `Invalid status value: "${frontmatter.status}" in ${path.basename(filePath)}`,
          path: filePath,
          severity: 'critical',
          suggestion: `Status must be one of: ${this.validStatuses.join(', ')}`
        });
      }
    }

    // Check type field (recommended)
    if (!frontmatter.type) {
      result.warnings.push({
        type: 'missing_type',
        message: `Missing 'type' field: ${path.basename(filePath)}`,
        path: filePath,
        severity: 'low',
        suggestion: 'Consider adding a type field (e.g., UserStory, Bug, Chore, Epic)'
      });
    }

    return result;
  }

  /**
   * Get a human-readable summary of validation results
   */
  formatSummary(validationResult) {
    const lines = [];

    if (validationResult.valid) {
      lines.push('✅ Board structure is valid');
    } else {
      lines.push('❌ Board structure has errors');
    }

    lines.push('');
    lines.push(`📊 Summary:`);
    lines.push(`  - Total tasks: ${validationResult.info.totalTasks}`);
    lines.push(`  - Total epics: ${validationResult.info.totalEpics}`);

    if (validationResult.errors.length > 0) {
      lines.push('');
      lines.push(`🚨 Errors (${validationResult.errors.length}):`);
      for (const error of validationResult.errors.slice(0, 5)) {
        lines.push(`  - ${error.message}`);
        if (error.suggestion) {
          lines.push(`    💡 ${error.suggestion}`);
        }
      }
      if (validationResult.errors.length > 5) {
        lines.push(`  ... and ${validationResult.errors.length - 5} more`);
      }
    }

    if (validationResult.warnings.length > 0) {
      lines.push('');
      lines.push(`⚠️  Warnings (${validationResult.warnings.length}):`);
      for (const warning of validationResult.warnings.slice(0, 3)) {
        lines.push(`  - ${warning.message}`);
      }
      if (validationResult.warnings.length > 3) {
        lines.push(`  ... and ${validationResult.warnings.length - 3} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format validation results as a structured JSON for the Feed
   */
  formatForFeed(validationResult) {
    return JSON.stringify({
      type: 'validation_report',
      valid: validationResult.valid,
      summary: {
        totalTasks: validationResult.info.totalTasks,
        totalEpics: validationResult.info.totalEpics
      },
      errors: validationResult.errors.slice(0, 10).map(e => ({
        message: e.message,
        suggestion: e.suggestion
      })),
      warnings: validationResult.warnings.slice(0, 5).map(w => ({
        message: w.message
      })),
      hasMoreErrors: validationResult.errors.length > 10,
      hasMoreWarnings: validationResult.warnings.length > 5,
      totalErrors: validationResult.errors.length,
      totalWarnings: validationResult.warnings.length
    });
  }
}
