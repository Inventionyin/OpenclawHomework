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
  summarizeDailyPipeline,
  summarizeTaskCenterDigest,
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

test('task center digest supports today/tomorrow and proactive types with bad tasks tolerated', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-digest-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'proactive-daily-ok', type: 'daily-digest', now: '2026-05-06T01:00:00.000Z', status: 'completed' }, env);
    createTask({ id: 'proactive-news-fail', type: 'news-digest', now: '2026-05-06T01:05:00.000Z', status: 'failed', error: 'api timeout' }, env);
    createTask({ id: 'proactive-ui-run', type: 'ui-automation', now: '2026-05-06T01:10:00.000Z', status: 'running' }, env);
    createTask({ id: 'proactive-token-queued', type: 'token-factory', now: '2026-05-06T01:15:00.000Z', status: 'queued' }, env);
    createTask({ id: 'broken-shape', type: '', now: '2026-05-06T01:20:00.000Z', status: '' }, env);

    const digest = summarizeTaskCenterDigest({
      env,
      now: new Date('2026-05-06T03:00:00.000Z'),
      staleMs: 30 * 60 * 1000,
      timezoneOffsetMinutes: 480,
      proactiveTypes: ['proactive', 'news', 'ui', 'token', 'daily'],
    });

    assert.match(digest.todaySummary, /今天任务/);
    assert.equal(digest.activeTypes.includes('news-digest'), true);
    assert.equal(digest.activeTypes.includes('ui-automation'), true);
    assert.equal(digest.failedItems.some((item) => item.id === 'proactive-news-fail'), true);
    assert.equal(digest.recoverableItems.some((item) => item.id === 'proactive-token-queued'), true);
    assert.equal(Array.isArray(digest.nextSuggestedActions), true);
    assert.equal(digest.nextSuggestedActions.length > 0, true);
    assert.equal(Array.isArray(digest.tomorrowPlan), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task center summarizes daily pipeline from task and state file', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-daily-pipeline-'));
  const stateFile = join(tempDir, 'pipeline-state.json');
  const env = {
    TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
    DAILY_AGENT_PIPELINE_STATE_FILE: stateFile,
  };
  try {
    createTask({
      id: 'daily-pipeline-2026-05-06',
      type: 'daily-pipeline',
      now: '2026-05-06T01:00:00.000Z',
      status: 'failed',
      summary: {
        day: '2026-05-06',
        totalStages: 4,
        completedStages: 3,
        failedStages: 1,
        failedStageIds: 'scheduled-ui',
      },
      error: 'scheduled-ui: GitHub Actions timeout',
    }, env);
    require('node:fs').writeFileSync(stateFile, `${JSON.stringify({
      lastRunDay: '2026-05-06',
      lastRunAt: '2026-05-06T01:08:00.000Z',
      totalStages: 4,
      completedStages: 3,
      failedStages: 1,
      stageStatuses: [
        { id: 'news-digest', status: 'completed' },
        { id: 'scheduled-ui', status: 'failed', reason: 'runner_failed' },
        { id: 'scheduled-token-lab', status: 'completed' },
        { id: 'proactive-daily-digest', status: 'completed' },
      ],
    })}\n`, 'utf8');

    const summary = summarizeDailyPipeline({
      env,
      now: new Date('2026-05-06T03:00:00.000Z'),
    });

    assert.equal(summary.day, '2026-05-06');
    assert.equal(summary.taskId, 'daily-pipeline-2026-05-06');
    assert.equal(summary.totalStages, 4);
    assert.equal(summary.completedStages, 3);
    assert.equal(summary.failedStages, 1);
    assert.deepEqual(summary.failedStageIds, ['scheduled-ui']);
    assert.equal(summary.stageStatuses.find((stage) => stage.id === 'scheduled-ui').status, 'failed');
    assert.match(summary.failureDiagnosis, /scheduled-ui/);
    assert.match(summary.nextAction, /重跑|修复/);
    assert.deepEqual(summary.source, { task: true, state: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task center daily pipeline summary degrades when only state file exists', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'task-center-daily-pipeline-state-only-'));
  const stateFile = join(tempDir, 'pipeline-state.json');
  const env = {
    TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
    DAILY_AGENT_PIPELINE_STATE_FILE: stateFile,
  };
  try {
    require('node:fs').writeFileSync(stateFile, `${JSON.stringify({
      lastRunDay: '2026-05-06',
      lastRunAt: '2026-05-06T01:08:00.000Z',
      totalStages: 4,
      completedStages: 4,
      failedStages: 0,
      stageStatuses: [
        { id: 'news-digest', status: 'completed' },
        { id: 'scheduled-ui', status: 'completed' },
      ],
    })}\n`, 'utf8');

    const summary = summarizeDailyPipeline({
      env,
      now: new Date('2026-05-06T03:00:00.000Z'),
    });

    assert.equal(summary.day, '2026-05-06');
    assert.equal(summary.taskId, null);
    assert.equal(summary.completedStages, 4);
    assert.equal(summary.failedStages, 0);
    assert.match(summary.nextAction, /明天|定时|继续/);
    assert.deepEqual(summary.source, { task: false, state: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
