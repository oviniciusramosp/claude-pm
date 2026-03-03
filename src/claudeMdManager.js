import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTemplate } from './templateLoader.js';
import { config } from './config.js';

const START_MARKER = '<!-- PRODUCT-MANAGER:START -->';
const END_MARKER = '<!-- PRODUCT-MANAGER:END -->';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VALID_PLATFORM_PRESETS = new Set(['ios']);

export async function generateManagedContent() {
  const parts = [await loadTemplate('managed-claude.md')];

  if (config.claude.autoVersionEnabled) {
    parts.push(await loadTemplate('versioning-rules.md'));
  }

  const preset = config.claude.platformPreset;
  if (preset && VALID_PLATFORM_PRESETS.has(preset)) {
    parts.push(await loadTemplate(`platform-${preset}.md`));
  }

  return parts.join('\n\n');
}

export async function syncClaudeMd(config, logger) {
  const targetDir = config.claude.workdir;
  const targetPath = path.join(targetDir, 'CLAUDE.md');
  const newContent = await generateManagedContent();
  const fullSection = `${START_MARKER}\n${newContent}\n${END_MARKER}`;

  let existingContent = '';
  let fileExists = false;

  try {
    existingContent = await fs.readFile(targetPath, 'utf8');
    fileExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!fileExists) {
    await fs.writeFile(targetPath, fullSection + '\n', 'utf8');
    return { action: 'created' };
  }

  const markerRegex = new RegExp(
    `${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`,
    'm'
  );
  const match = existingContent.match(markerRegex);

  if (match) {
    if (match[0] === fullSection) {
      return { action: 'unchanged' };
    }

    const updated = existingContent.replace(markerRegex, fullSection);
    await fs.writeFile(targetPath, updated, 'utf8');
    return { action: 'updated' };
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  await fs.writeFile(targetPath, existingContent + separator + fullSection + '\n', 'utf8');
  return { action: 'appended' };
}
