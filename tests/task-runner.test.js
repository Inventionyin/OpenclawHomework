const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  readTask,
} = require('../scripts/background-task-store');
const {
  formatTokenFactoryTask,
  runTokenFactoryTask,
  startTokenFactoryTask,
} = require('../scripts/task-runner');

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
