const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  createTask,
  readTask,
} = require('../scripts/background-task-store');
const {
  listFailedTasks,
  listTodayTasks,
  recordTaskEvent,
  summarizeTasks,
} = require('../scripts/task-center');

test('task center lists today tasks by local day and type', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-today-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'tf-today', type: 'token-factory', now: '2026-05-06T02:00:00.000Z' }, env);
    createTask({ id: 'tf-yesterday', type: 'token-factory', now: '2026-05-05T10:00:00.000Z' }, env);
    createTask({ id: 'other-today', type: 'other-task', now: '2026-05-06T03:00:00.000Z' }, env);

    const today = listTodayTasks({
      env,
      now: new Date('2026-05-06T08:00:00.000Z'),
      type: 'token-factory',
      timezoneOffsetMinutes: 480,
    });
    assert.deepEqual(today.map((task) => task.id), ['tf-today']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task center summarizes tasks and recoverable count', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-summary-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'queued-task', now: '2026-05-06T00:00:00.000Z', status: 'queued' }, env);
    createTask({ id: 'failed-task', now: '2026-05-06T00:01:00.000Z', status: 'failed' }, env);
    createTask({ id: 'completed-task', now: '2026-05-06T00:02:00.000Z', status: 'completed' }, env);
    createTask({ id: 'stale-running-task', now: '2026-05-06T00:03:00.000Z', status: 'running' }, env);

    const summary = summarizeTasks({
      env,
      now: new Date('2026-05-06T01:00:00.000Z'),
      staleMs: 5 * 60 * 1000,
      timezoneOffsetMinutes: 480,
    });
    assert.equal(summary.counts.total, 4);
    assert.equal(summary.counts.failed, 1);
    assert.equal(summary.counts.completed, 1);
    assert.equal(summary.counts.recoverable, 2);
    assert.equal(summary.latest.id, 'stale-running-task');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task center records task event without breaking existing task file', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-event-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'task-a', now: '2026-05-06T00:00:00.000Z' }, env);
    const updated = recordTaskEvent({
      taskId: 'task-a',
      event: 'failed',
      status: 'failed',
      error: 'quota exhausted',
      note: 'daily batch failed',
      summaryPatch: { totalTokens: 120 },
    }, {
      env,
      now: '2026-05-06T00:10:00.000Z',
    });
    assert.equal(updated.status, 'failed');
    assert.equal(updated.summary.totalTokens, 120);
    assert.equal(updated.events.length, 1);
    assert.equal(updated.events[0].event, 'failed');
    assert.match(readTask('task-a', env).error, /quota exhausted/);

    const failed = listFailedTasks({ env });
    assert.equal(failed[0].id, 'task-a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

