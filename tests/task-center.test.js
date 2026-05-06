const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  createTask,
  readTask,
  updateTask,
} = require('../scripts/background-task-store');
const {
  listFailedTasks,
  listTodayTasks,
  recordTaskEvent,
  summarizeDailyPlan,
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

test('task center summarizes multiple proactive task types', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-multi-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'ui-today', type: 'ui-automation', now: '2026-05-06T01:00:00.000Z', status: 'running' }, env);
    createTask({ id: 'daily-today', type: 'daily-digest', now: '2026-05-06T01:10:00.000Z', status: 'completed' }, env);
    createTask({ id: 'news-fail', type: 'news-digest', now: '2026-05-06T01:20:00.000Z', status: 'failed', error: 'rss timeout' }, env);
    createTask({ id: 'token-old', type: 'token-factory', now: '2026-05-05T01:20:00.000Z', status: 'completed' }, env);

    const summary = summarizeTasks({
      env,
      now: new Date('2026-05-06T08:00:00.000Z'),
      timezoneOffsetMinutes: 480,
    });

    assert.equal(summary.counts.total, 4);
    assert.equal(summary.counts.today, 3);
    assert.equal(summary.counts.running, 1);
    assert.equal(summary.counts.completed, 2);
    assert.equal(summary.counts.failed, 1);
    assert.deepEqual(summary.byType.map((row) => row.type), [
      'news-digest',
      'ui-automation',
      'daily-digest',
      'token-factory',
    ]);
    assert.equal(summary.byType.find((row) => row.type === 'news-digest').failed, 1);

    const uiOnly = summarizeTasks({
      env,
      type: 'ui-automation',
      now: new Date('2026-05-06T08:00:00.000Z'),
      timezoneOffsetMinutes: 480,
    });
    assert.equal(uiOnly.counts.total, 1);
    assert.equal(uiOnly.latest.id, 'ui-today');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task center builds today summary and tomorrow plan from real task state', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-plan-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'ui-ok', type: 'ui-automation', now: '2026-05-06T01:00:00.000Z', status: 'completed' }, env);
    createTask({ id: 'news-fail', type: 'news-digest', now: '2026-05-06T01:10:00.000Z', status: 'failed', error: 'rss timeout' }, env);
    createTask({ id: 'token-stale', type: 'token-factory', now: '2026-05-06T01:20:00.000Z', status: 'running' }, env);
    updateTask('token-stale', { updatedAt: '2026-05-06T01:20:00.000Z' }, env);

    const plan = summarizeDailyPlan({
      env,
      now: new Date('2026-05-06T03:00:00.000Z'),
      staleMs: 30 * 60 * 1000,
      timezoneOffsetMinutes: 480,
    });

    assert.match(plan.todaySummaryText, /今天任务 3 个/);
    assert.match(plan.todaySummaryText, /完成 1/);
    assert.match(plan.todaySummaryText, /失败 1/);
    assert(plan.tomorrowPlan.some((item) => /优先复盘失败任务/.test(item)));
    assert(plan.tomorrowPlan.some((item) => /恢复中断/.test(item)));
    assert(plan.tomorrowPlan.some((item) => /日报/.test(item) || /UI 自动化/.test(item)));
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
