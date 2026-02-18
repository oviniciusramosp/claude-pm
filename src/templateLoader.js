import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates');

/**
 * Load a template file and substitute {{PLACEHOLDER}} variables.
 * @param {string} templateName - Filename inside templates/ (e.g. 'recovery.md')
 * @param {Record<string, string>} variables - Key-value pairs for substitution
 * @returns {Promise<string>} Rendered template
 */
export async function loadTemplate(templateName, variables = {}) {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  let content = await fs.readFile(templatePath, 'utf8');

  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value ?? '');
  }

  return content;
}
