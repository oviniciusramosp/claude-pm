import { richTextToPlainTextForBlocks } from './mapper.js';

function lineOrEmpty(value) {
  return value && value.trim().length > 0 ? value : '';
}

function flattenLines(lines) {
  const flattened = [];
  let previousWasEmpty = false;

  for (const rawLine of lines) {
    const line = rawLine === null || rawLine === undefined ? '' : String(rawLine);
    const isEmpty = line.trim().length === 0;

    if (isEmpty) {
      if (!previousWasEmpty) {
        flattened.push('');
      }
      previousWasEmpty = true;
      continue;
    }

    flattened.push(line);
    previousWasEmpty = false;
  }

  return flattened.join('\n').trim();
}

function fallbackText(block) {
  const blockData = block[block.type];
  if (!blockData || !Array.isArray(blockData.rich_text)) {
    return '';
  }

  return richTextToPlainTextForBlocks(blockData.rich_text);
}

async function blockToLines(fetchChildren, block, depth) {
  const indent = '  '.repeat(depth);
  const lines = [];
  const pushChildren = async () => {
    if (!block.has_children) {
      return;
    }

    const childLines = await childrenToLines(fetchChildren, block.id, depth + 1);
    if (childLines.length > 0) {
      lines.push(...childLines);
    }
  };

  switch (block.type) {
    case 'heading_1': {
      lines.push(`# ${lineOrEmpty(richTextToPlainTextForBlocks(block.heading_1.rich_text))}`);
      break;
    }

    case 'heading_2': {
      lines.push(`## ${lineOrEmpty(richTextToPlainTextForBlocks(block.heading_2.rich_text))}`);
      break;
    }

    case 'heading_3': {
      lines.push(`### ${lineOrEmpty(richTextToPlainTextForBlocks(block.heading_3.rich_text))}`);
      break;
    }

    case 'paragraph': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.paragraph.rich_text));
      lines.push(content);
      break;
    }

    case 'bulleted_list_item': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.bulleted_list_item.rich_text));
      lines.push(`${indent}- ${content}`);
      await pushChildren();
      break;
    }

    case 'numbered_list_item': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.numbered_list_item.rich_text));
      lines.push(`${indent}- ${content}`);
      await pushChildren();
      break;
    }

    case 'to_do': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.to_do.rich_text));
      const checked = block.to_do.checked ? 'x' : ' ';
      lines.push(`${indent}- [${checked}] ${content}`);
      await pushChildren();
      break;
    }

    case 'quote': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.quote.rich_text));
      lines.push(`> ${content}`);
      break;
    }

    case 'code': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.code.rich_text));
      const lang = block.code.language || '';
      lines.push(`\`\`\`${lang}`);
      lines.push(content);
      lines.push('```');
      break;
    }

    case 'divider': {
      lines.push('---');
      break;
    }

    case 'callout': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.callout.rich_text));
      lines.push(`> ${content}`);
      break;
    }

    case 'toggle': {
      const content = lineOrEmpty(richTextToPlainTextForBlocks(block.toggle.rich_text));
      lines.push(`${indent}- ${content}`);
      await pushChildren();
      break;
    }

    default: {
      const content = lineOrEmpty(fallbackText(block));
      if (content) {
        lines.push(content);
      }
      break;
    }
  }

  return lines;
}

async function childrenToLines(fetchChildren, blockId, depth) {
  const children = await fetchChildren(blockId);
  const lines = [];

  for (const child of children) {
    const childLines = await blockToLines(fetchChildren, child, depth);
    lines.push(...childLines);
  }

  return lines;
}

export async function pageToMarkdown(fetchChildren, pageId) {
  const lines = await childrenToLines(fetchChildren, pageId, 0);
  return flattenLines(lines);
}
