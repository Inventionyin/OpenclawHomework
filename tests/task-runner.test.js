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
  formatTokenFactoryTask,
  runRecoverableTokenFactoryTasks,
  runTokenFactoryTask,
  startTokenFactoryTask,
} = require('../scripts/task-runner');
const {
  parseCliArgs,
} = require('../scripts/token-factory-worker');

test('runTokenFactoryTask marks task completed with combined summary', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'token-factory-task-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    const { task } = startTokenFactoryTask({
      env,
      runner: async () => {},
    });
    await runTokenFactoryTask(task.id, {
      env,
      tokenLabRunner: async () => ({
        report: { totalJobs: 2, totalTokens: 30, estimatedTotalTokens: 40 },
        files: { report: '/tmp/token-report.md', items: '/tmp/token-items.json' },
      }),
      multiAgentLabRunner: async () => ({
        summary: { totalItems: 3, totalTokens: 70, estimatedTotalTokens: 80, winner: 'Hermes' },
        files: { report: '/tmp/multi-report.md', items: '/tmp/multi-items.json', summary: '/tmp/multi-summary.json' },
      }),
    });

    const saved = readTask(task.id, env);
    assert.equal(saved.status, 'completed');
    assert.equal(saved.summary.totalTokens, 100);
    assert.equal(saved.summary.estimatedTotalTokens, 120);
    assert.equal(saved.summary.winner, 'Hermes');
    assert.match(formatTokenFactoryTask(saved), /Hermes/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runRecoverableTokenFactoryTasks resumes queued and stale tasks once', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'token-factory-resume-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'queued-task', now: '2026-05-06T00:00:00.000Z', status: 'queued' }, env);
    createTask({ id: 'interrupted-task', now: '2026-05-06T00:01:00.000Z', status: 'interrupted' }, env);
    createTask({ id: 'stale-running-task', now: '2026-05-06T00:02:00.000Z', status: 'running' }, env);
    createTask({ id: 'fresh-running-task', now: '2026-05-06T00:09:00.000Z', status: 'running' }, env);

    const resumed = [];
    const result = await runRecoverableTokenFactoryTasks({
      env,
      now: new Date('2026-05-06T00:10:00.000Z'),
      staleMs: 5 * 60 * 1000,
      runner: async (taskId) => {
        resumed.push(taskId);
        if (taskId === 'interrupted-task') {
          throw new Error('still broken');
        }
        return readTask(taskId, env);
      },
    });

    assert.deepEqual(resumed, ['queued-task', 'interrupted-task', 'stale-running-task']);
    assert.equal(result.scanned, 3);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 1);
    assert.equal(readTask('queued-task', env).status, 'running');
    assert.equal(readTask('interrupted-task', env).status, 'failed');
    assert.match(readTask('interrupted-task', env).error, /still broken/);
    assert.equal(readTask('stale-running-task', env).status, 'running');
    assert.equal(readTask('fresh-running-task', env).status, 'running');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runRecoverableTokenFactoryTasks counts runner-returned failed tasks', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'token-factory-returned-fail-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    createTask({ id: 'queued-task', now: '2026-05-06T00:00:00.000Z', status: 'queued' }, env);

    const result = await runRecoverableTokenFactoryTasks({
      env,
      runner: async (taskId) => {
        return {
          ...readTask(taskId, env),
          status: 'failed',
          error: 'quota exhausted',
        };
      },
    });

    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runTokenFactoryTask marks task failed when a runner throws', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'token-factory-fail-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    const { task } = startTokenFactoryTask({
      env,
      runner: async () => {},
    });
    await runTokenFactoryTask(task.id, {
      env,
      tokenLabRunner: async () => {
        throw new Error('model quota exhausted');
      },
      multiAgentLabRunner: async () => ({}),
    });

    const saved = readTask(task.id, env);
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /quota/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('token factory worker parses once and stale options', () => {
  const config = parseCliArgs(['--once', '--stale-ms', '1000', '--interval-ms', '2000'], {});
  assert.equal(config.once, true);
  assert.equal(config.staleMs, 1000);
  assert.equal(config.intervalMs, 2000);
});
