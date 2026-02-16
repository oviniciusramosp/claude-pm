/**
 * AC (Acceptance Criteria) parser and utilities.
 *
 * Extracts numbered ACs from task markdown and provides helpers
 * for prompt formatting and reference resolution.
 */

const CHECKBOX_REGEX = /^(\s*-\s*)\[([ xX])\](\s+.+)$/gm;

/**
 * Parse all checkbox-style ACs from a markdown body.
 * Returns a 1-based indexed list of ACs in document order.
 *
 * @param {string} markdownBody - The markdown content (without frontmatter).
 * @returns {Array<{ index: number, text: string, checked: boolean }>}
 */
export function parseAcs(markdownBody) {
  if (!markdownBody) {
    return [];
  }

  const results = [];
  let match;
  const regex = new RegExp(CHECKBOX_REGEX.source, CHECKBOX_REGEX.flags);

  while ((match = regex.exec(markdownBody)) !== null) {
    const checkChar = match[2];
    const text = match[3].trim();

    results.push({
      index: results.length + 1,
      text,
      checked: checkChar.toLowerCase() === 'x'
    });
  }

  return results;
}

/**
 * Format a numbered AC reference table for inclusion in prompts.
 *
 * @param {Array<{ index: number, text: string, checked: boolean }>} acList
 * @returns {string}
 */
export function formatAcsForPrompt(acList) {
  if (!acList || acList.length === 0) {
    return '';
  }

  const lines = [
    '='.repeat(80),
    `ACCEPTANCE CRITERIA REFERENCE TABLE (${acList.length} ACs)`,
    '='.repeat(80),
    '',
    'Use these AC numbers for tracking. Do NOT paraphrase — reference by number only.',
    ''
  ];

  for (const ac of acList) {
    const status = ac.checked ? '[DONE]' : '';
    lines.push(`  AC-${ac.index}: ${ac.text}${status ? ' ' + status : ''}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Parse an AC reference string into a structured object.
 * Handles both numbered ("AC-3") and text fallback formats.
 *
 * @param {string} ref - The raw AC reference (e.g. "AC-3", "AC-3: some text", "Login page renders")
 * @returns {{ type: 'numbered', index: number } | { type: 'text', text: string }}
 */
export function resolveAcRef(ref) {
  const trimmed = (ref || '').trim();
  if (!trimmed) {
    return { type: 'text', text: '' };
  }

  const numMatch = trimmed.match(/^AC-(\d+)/i);
  if (numMatch) {
    return { type: 'numbered', index: parseInt(numMatch[1], 10) };
  }

  return { type: 'text', text: trimmed };
}

