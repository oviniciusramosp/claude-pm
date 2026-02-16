// test-board-client.js
import { LocalBoardClient } from './src/local/client.js';

const config = {
  board: {
    dir: '/Users/viniciusramos/Documents/Apps/DeservePizza/Board',
    statuses: {
      notStarted: 'Not Started',
      inProgress: 'In Progress',
      done: 'Done'
    },
    typeValues: { epic: 'Epic' }
  }
};

async function test() {
  const client = new LocalBoardClient(config);
  await client.initialize();
  const tasks = await client.listTasks();

  console.log('\n=== All Tasks ===');
  tasks.forEach(t => {
    console.log(`ID: ${t.id}, Name: ${t.name}, ParentID: ${t.parentId || 'none'}`);
  });

  console.log('\n=== Testing getTaskMarkdown ===');

  // Test epic
  const epic = tasks.find(t => t.id === 'E01-Project-Foundation' && !t.parentId);
  if (epic) {
    console.log(`\nEpic: ${epic.id}`);
    const markdown = await client.getTaskMarkdown(epic.id);
    console.log(`Markdown length: ${markdown.length}`);
    console.log(`First 100 chars: ${markdown.substring(0, 100)}`);
  }

  // Test child task
  const child = tasks.find(t => t.id === 'E01-Project-Foundation/s1-1-initialize-expo-project');
  if (child) {
    console.log(`\nChild: ${child.id}`);
    const markdown = await client.getTaskMarkdown(child.id);
    console.log(`Markdown length: ${markdown.length}`);
    console.log(`First 100 chars: ${markdown.substring(0, 100)}`);
  }
}

test().catch(console.error);
