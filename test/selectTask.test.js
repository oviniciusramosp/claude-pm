import test from 'node:test';
import assert from 'node:assert/strict';
import { allEpicChildrenAreDone, pickNextTask } from '../src/selectTask.js';

const config = {
  notion: {
    statuses: {
      notStarted: 'Not Started',
      inProgress: 'In Progress',
      done: 'Done'
    },
    typeValues: {
      epic: 'Epic'
    }
  },
  queue: {
    order: 'created'
  }
};

test('pickNextTask prioriza card em In Progress', () => {
  const tasks = [
    {
      id: '1',
      name: 'Task 1',
      status: 'Not Started',
      type: 'UserStory',
      createdTime: '2026-01-01T00:00:00.000Z'
    },
    {
      id: '2',
      name: 'Task 2',
      status: 'In Progress',
      type: 'UserStory',
      createdTime: '2026-01-02T00:00:00.000Z'
    }
  ];

  const selected = pickNextTask(tasks, config);
  assert.equal(selected.task.id, '2');
  assert.equal(selected.source, 'in_progress');
});

test('pickNextTask ignora Epic e pega Not Started mais antigo', () => {
  const tasks = [
    {
      id: 'epic',
      name: 'Epic',
      status: 'Not Started',
      type: 'Epic',
      createdTime: '2026-01-01T00:00:00.000Z'
    },
    {
      id: '3',
      name: 'Task 3',
      status: 'Not Started',
      type: 'UserStory',
      createdTime: '2026-01-03T00:00:00.000Z'
    },
    {
      id: '2',
      name: 'Task 2',
      status: 'Not Started',
      type: 'Defect',
      createdTime: '2026-01-02T00:00:00.000Z'
    }
  ];

  const selected = pickNextTask(tasks, config);
  assert.equal(selected.task.id, '2');
  assert.equal(selected.source, 'not_started');
});

test('allEpicChildrenAreDone valida conclusao de filhos', () => {
  const tasks = [
    { id: 'epic-1', name: 'Epic', type: 'Epic', status: 'In Progress' },
    {
      id: 'child-1',
      name: 'Child 1',
      type: 'UserStory',
      status: 'Done',
      parentId: 'epic-1'
    },
    {
      id: 'child-2',
      name: 'Child 2',
      type: 'Defect',
      status: 'Done',
      parentId: 'epic-1'
    }
  ];

  const result = allEpicChildrenAreDone(tasks[0], tasks, config);
  assert.equal(result.allDone, true);
  assert.equal(result.children.length, 2);
});

test('pickNextTask ignora card pai com sub-tasks mesmo sem Type=Epic', () => {
  const tasks = [
    {
      id: 'parent-1',
      name: 'Parent Task',
      status: 'In Progress',
      type: '',
      createdTime: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'child-1',
      name: 'Child Task',
      status: 'Not Started',
      type: 'UserStory',
      parentId: 'parent-1',
      createdTime: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 'task-1',
      name: 'Regular Task',
      status: 'Not Started',
      type: 'Defect',
      createdTime: '2026-01-03T00:00:00.000Z'
    }
  ];

  const selected = pickNextTask(tasks, config);
  assert.equal(selected.task.id, 'child-1');
  assert.equal(selected.source, 'not_started');
});
