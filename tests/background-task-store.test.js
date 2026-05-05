const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  createTask,
  getLatestTask,
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
