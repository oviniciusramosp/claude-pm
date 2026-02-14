import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeNotionWebhookEvent } from '../src/notion/webhookSummary.js';

test('summarizeNotionWebhookEvent extrai campos diretos', () => {
  const payload = {
    type: 'page.properties_updated',
    entity: {
      id: 'task-1'
    },
    property_value: {
      status: {
        name: 'Done'
      }
    }
  };

  const summary = summarizeNotionWebhookEvent(payload, 'Status');
  assert.deepEqual(summary, {
    eventType: 'page.properties_updated',
    taskId: 'task-1',
    status: 'Done'
  });
});

test('summarizeNotionWebhookEvent le status na propriedade configurada', () => {
  const payload = {
    event: {
      type: 'page.updated'
    },
    data: {
      page: {
        id: 'task-2',
        properties: {
          Status: {
            type: 'status',
            status: {
              name: 'In progress'
            }
          }
        }
      }
    }
  };

  const summary = summarizeNotionWebhookEvent(payload, 'Status');
  assert.deepEqual(summary, {
    eventType: 'page.updated',
    taskId: 'task-2',
    status: 'In progress'
  });
});

test('summarizeNotionWebhookEvent encontra status em propriedade nao padrao', () => {
  const payload = {
    type: 'page.updated',
    data: {
      properties: {
        Estado: {
          type: 'status',
          status: {
            name: 'Done'
          }
        }
      }
    }
  };

  const summary = summarizeNotionWebhookEvent(payload, 'Status');
  assert.deepEqual(summary, {
    eventType: 'page.updated',
    taskId: 'n/a',
    status: 'Done'
  });
});

test('summarizeNotionWebhookEvent retorna fallback para payload incompleto', () => {
  const summary = summarizeNotionWebhookEvent({}, 'Status');
  assert.deepEqual(summary, {
    eventType: 'unknown',
    taskId: 'n/a',
    status: 'n/a'
  });
});
