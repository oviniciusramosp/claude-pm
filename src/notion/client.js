import { Client } from '@notionhq/client';
import { mapNotionPageToTask } from './mapper.js';
import { pageToMarkdown } from './markdown.js';

function textObject(content) {
  return {
    type: 'text',
    text: {
      content
    }
  };
}

function lineToBlock(line) {
  if (line.startsWith('## ')) {
    const content = line.slice(3).trim() || ' ';
    return {
      heading_2: {
        rich_text: [textObject(content)]
      }
    };
  }

  if (line.startsWith('# ')) {
    const content = line.slice(2).trim() || ' ';
    return {
      heading_1: {
        rich_text: [textObject(content)]
      }
    };
  }

  if (line.startsWith('- ')) {
    const content = line.slice(2).trim() || ' ';
    return {
      bulleted_list_item: {
        rich_text: [textObject(content)]
      }
    };
  }

  return {
    paragraph: {
      rich_text: [textObject(line.trim() || ' ')]
    }
  };
}

function markdownToBlocks(markdown) {
  const lines = String(markdown || '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  const blocks = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    blocks.push(lineToBlock(line));
  }

  return blocks;
}

export class NotionBoardClient {
  constructor(config) {
    this.config = config;
    this.client = new Client({
      auth: config.notion.token,
      notionVersion: config.notion.version
    });
  }

  async listTasks() {
    const pages = [];
    let cursor = undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.config.notion.databaseId,
        start_cursor: cursor,
        page_size: 100
      });

      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return pages
      .map((page) => mapNotionPageToTask(page, this.config))
      .filter((task) => task !== null);
  }

  async updateTaskStatus(taskId, status) {
    await this.client.pages.update({
      page_id: taskId,
      properties: {
        [this.config.notion.properties.status]: {
          status: {
            name: status
          }
        }
      }
    });
  }

  async listBlockChildren(blockId) {
    const blocks = [];
    let cursor = undefined;

    do {
      const response = await this.client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      });

      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }

  async getTaskMarkdown(taskId) {
    return pageToMarkdown((blockId) => this.listBlockChildren(blockId), taskId);
  }

  async appendMarkdown(pageId, markdown) {
    const blocks = markdownToBlocks(markdown);
    if (blocks.length === 0) {
      return;
    }

    for (let index = 0; index < blocks.length; index += 100) {
      const chunk = blocks.slice(index, index + 100);
      await this.client.blocks.children.append({
        block_id: pageId,
        children: chunk
      });
    }
  }
}
