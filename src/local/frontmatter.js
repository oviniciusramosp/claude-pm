/**
 * Lightweight YAML frontmatter parser and serializer.
 * Handles the `---\nkey: value\n---` block at the top of .md files.
 */

export function parseFrontmatter(content) {
  const text = String(content || '');

  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: text };
  }

  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: text };
  }

  const yamlBlock = text.slice(4, endIndex).trim();
  const body = text.slice(endIndex + 4).trim();
  const frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

export function serializeFrontmatter(fields) {
  const lines = ['---'];

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    lines.push(`${key}: ${value}`);
  }

  lines.push('---');
  return lines.join('\n');
}

export function updateFrontmatterField(content, key, newValue) {
  const { frontmatter, body } = parseFrontmatter(content);
  frontmatter[key] = newValue;
  return serializeFrontmatter(frontmatter) + '\n\n' + body;
}
