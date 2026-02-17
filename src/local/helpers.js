/**
 * Utility functions for the local file-based board.
 */

export function titleFromSlug(slug) {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function slugFromTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function parseArrayField(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract the numeric part from an Epic ID.
 * Examples:
 *   "Epic-1" -> 1
 *   "E01-Foundation" -> 1
 *   "Epic-Auth" -> null (no number found)
 * @param {string} epicId - The Epic ID or folder name
 * @returns {number|null} The extracted number or null if not found
 */
export function extractEpicNumber(epicId) {
  // Try patterns like "Epic-1", "E01", "Epic-123"
  const match = epicId.match(/(?:Epic-?|E)(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Generate a numbered story filename with pattern S{epic}-{story}-{slug}.md
 * @param {string} epicId - The Epic ID (e.g., "Epic-1", "E01-Auth")
 * @param {number} storyIndex - The story index (0-based)
 * @param {string} title - The story title
 * @returns {string} Filename like "S1-1-implement-login.md"
 */
export function generateStoryFileName(epicId, storyIndex, title) {
  const epicNum = extractEpicNumber(epicId);
  const storyNum = storyIndex + 1; // Convert to 1-based
  const slug = slugFromTitle(title);

  if (epicNum !== null) {
    return `S${epicNum}-${storyNum}-${slug}`;
  }

  // Fallback: if Epic has no number, just use story number
  return `S${storyNum}-${slug}`;
}
