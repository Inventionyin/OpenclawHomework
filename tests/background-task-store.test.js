const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  createTask,
  getLatestTask,
  listRecoverableTasks,
  readTask,
  updateTask,
} = require('../scripts/background-task-store');

test('background task store creates updates and reads latest task', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-store-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    const task = createTask({ id: 'task-a', now: '2026-05-06T00:00:00.000Z' }, env);
    assert.equal(task.status, 'queued');

    updateTask('task-a', {
      status: 'completed',
      summary: { totalTokens: 42 },
      updatedAt: '2026-05-06T00:01:00.000Z',
    }, env);

    assert.equal(readTask('task-a', env).status, 'completed');
    assert.equal(getLatestTask(env).id, 'task-a');
    assert.equal(getLatestTask(env).summary.totalTokens, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('background task store lists queued interrupted and stale running tasks', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-store-recoverable-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'queued-task', now: '2026-05-06T00:00:00.000Z', status: 'queued' }, env);
    createTask({ id: 'interrupted-task', now: '2026-05-06T00:01:00.000Z', status: 'interrupted' }, env);
    createTask({ id: 'fresh-running-task', now: '2026-05-06T00:02:00.000Z', status: 'running' }, env);
    updateTask('fresh-running-task', { updatedAt: '2026-05-06T00:09:30.000Z' }, env);
    createTask({ id: 'stale-running-task', now: '2026-05-06T00:03:00.000Z', status: 'running' }, env);
    updateTask('stale-running-task', { updatedAt: '2026-05-06T00:00:00.000Z' }, env);
    createTask({ id: 'completed-task', now: '2026-05-06T00:04:00.000Z', status: 'completed' }, env);

    const tasks = listRecoverableTasks(env, {
      now: new Date('2026-05-06T00:10:00.000Z'),
      staleMs: 5 * 60 * 1000,
    });

    assert.deepEqual(tasks.map((task) => task.id), [
      'queued-task',
      'interrupted-task',
      'stale-running-task',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('background task store can list recoverable tasks for selected task types', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-store-recoverable-types-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'token-queued', type: 'token-factory', now: '2026-05-06T00:00:00.000Z', status: 'queued' }, env);
    createTask({ id: 'ui-queued', type: 'ui-automation', now: '2026-05-06T00:01:00.000Z', status: 'queued' }, env);
    createTask({ id: 'news-interrupted', type: 'news-digest', now: '2026-05-06T00:02:00.000Z', status: 'interrupted' }, env);
    createTask({ id: 'daily-stale', type: 'daily-pipeline', now: '2026-05-06T00:03:00.000Z', status: 'running' }, env);
    updateTask('daily-stale', { updatedAt: '2026-05-06T00:00:00.000Z' }, env);

    const defaultTasks = listRecoverableTasks(env, {
      now: new Date('2026-05-06T00:10:00.000Z'),
      staleMs: 5 * 60 * 1000,
    });
    assert.deepEqual(defaultTasks.map((task) => task.id), ['token-queued']);

    const proactiveTasks = listRecoverableTasks(env, {
      now: new Date('2026-05-06T00:10:00.000Z'),
      staleMs: 5 * 60 * 1000,
      types: ['token-factory', 'ui-automation', 'news-digest', 'daily-pipeline'],
    });
    assert.deepEqual(proactiveTasks.map((task) => task.id), [
      'token-queued',
      'ui-queued',
      'news-interrupted',
      'daily-stale',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
